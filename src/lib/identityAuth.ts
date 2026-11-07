/**
 * Identity Authentication Library for SSP Relay
 *
 * Provides cryptographic verification of Bitcoin signatures for authenticating
 * identities (wkIdentity, walletIdentity, keyIdentity) on relay endpoints.
 *
 * Supports both single-sig (P2PKH) and multisig (P2WSH) addresses.
 */

import utxolib from '@runonflux/utxo-lib';
import bitcoinMessage from 'bitcoinjs-message';
import crypto from 'crypto';
import log from './log';
import {
  SignaturePayload,
  AuthFields,
  VerificationResult,
  ParsedWitnessScript,
  BitcoinNetwork,
} from '../types/auth';

// Constants
export const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000; // 10 minutes
/**
 * Upper bound on remembered (spent) nonces. A nonce must be remembered for as
 * long as its signed payload can still pass the timestamp check, so entries
 * are never evicted early: when the cache is full, new signed requests are
 * refused (503) until expired entries are swept. Overridable with
 * RELAY_NONCE_CACHE_MAX_ENTRIES. ~250 bytes per entry.
 */
const DEFAULT_NONCE_CACHE_MAX_ENTRIES = 250_000;
const NONCE_CACHE_SWEEP_INTERVAL_MS = 60 * 1000;
// A full cache triggers an immediate sweep, but at most this often (a sweep
// is O(n), so it must not run on every refused request).
const NONCE_CACHE_FORCED_SWEEP_MIN_INTERVAL_MS = 5 * 1000;

/**
 * Actions accepted by the body-signed (POST / socket) verifiers. 'read' is
 * deliberately absent: it is only valid for header-signed GET reads (see
 * READ_ACTIONS and requireReadAuth), so a read signature cannot authorise a
 * write.
 */
export const DEFAULT_ALLOWED_ACTIONS: readonly SignaturePayload['action'][] = [
  'sync',
  'action',
  'token',
  'join',
];
/** Actions accepted by header-signed GET reads. */
export const READ_ACTIONS: readonly SignaturePayload['action'][] = ['read'];

// Nonce cache to prevent replay attacks (in-process; see README deploy notes:
// the relay runs as ONE process, so this cache is authoritative).
// Map<nonce, { expiresAt, fingerprint }> — expiresAt is the moment the signed
// payload can no longer pass the timestamp check (max(now, payload.timestamp)
// + MAX_TIMESTAMP_DRIFT_MS); the fingerprint identifies the exact signed
// request that spent the nonce, so an honest client's resend of the identical
// request can be told apart from a forged reuse of the nonce.
const nonceCache = new Map<
  string,
  { expiresAt: number; fingerprint: string }
>();

// Periodic cleanup interval reference
let cleanupInterval: ReturnType<typeof setInterval> | null = null;
let lastForcedSweepAt = 0;
let lastCacheFullLogAt = 0;

function nonceCacheMaxEntries(): number {
  const raw = Number(process.env.RELAY_NONCE_CACHE_MAX_ENTRIES);
  return Number.isSafeInteger(raw) && raw > 0
    ? raw
    : DEFAULT_NONCE_CACHE_MAX_ENTRIES;
}

/**
 * Get the Bitcoin network object based on network name.
 */
function getNetwork(network: BitcoinNetwork): typeof utxolib.networks.bitcoin {
  return network === 'testnet'
    ? utxolib.networks.testnet
    : utxolib.networks.bitcoin;
}

/**
 * Verify a Bitcoin signed message.
 *
 * @param message - The message that was signed
 * @param signature - Base64-encoded signature
 * @param address - Bitcoin address to verify against
 * @param messagePrefix - Optional message prefix (defaults to Bitcoin prefix)
 * @returns Whether the signature is valid
 */
export function verifyBitcoinSignature(
  message: string,
  signature: string,
  address: string,
  messagePrefix?: string,
): boolean {
  try {
    // bitcoinjs-message.verify handles the recovery and verification
    return bitcoinMessage.verify(
      message,
      address,
      signature,
      messagePrefix || '\x18Bitcoin Signed Message:\n',
    );
  } catch (error) {
    log.warn(`Signature verification failed: ${error}`);
    return false;
  }
}

/**
 * Derive P2PKH address from a compressed public key.
 *
 * @param publicKeyHex - 33-byte compressed public key in hex format
 * @param network - Bitcoin network (mainnet or testnet)
 * @returns The derived P2PKH address
 */
export function deriveP2PKHAddress(
  publicKeyHex: string,
  network: BitcoinNetwork = 'mainnet',
): string {
  const networkObj = getNetwork(network);
  const pubKeyBuffer = Buffer.from(publicKeyHex, 'hex');

  // Validate public key length (33 bytes for compressed)
  if (pubKeyBuffer.length !== 33) {
    throw new Error(
      `Invalid public key length: expected 33 bytes, got ${pubKeyBuffer.length}`,
    );
  }
  if (!isValidCompressedPubKey(publicKeyHex)) {
    throw new Error(
      'Invalid public key: not a valid compressed secp256k1 point',
    );
  }

  const keyPair = utxolib.ECPair.fromPublicKeyBuffer(pubKeyBuffer, networkObj);
  return keyPair.getAddress();
}

/**
 * Derive P2WSH (native segwit) address from a witness script.
 *
 * @param witnessScriptHex - Hex-encoded witness script
 * @param network - Bitcoin network (mainnet or testnet)
 * @returns The derived P2WSH address (bc1q... or tb1q...)
 */
export function deriveP2WSHAddress(
  witnessScriptHex: string,
  network: BitcoinNetwork = 'mainnet',
): string {
  const networkObj = getNetwork(network);
  const witnessScript = Buffer.from(witnessScriptHex, 'hex');

  // Create the scriptPubKey: OP_0 <32-byte-sha256-hash>
  const scriptPubKey = utxolib.script.witnessScriptHash.output.encode(
    utxolib.crypto.sha256(witnessScript),
  );

  return utxolib.address.fromOutputScript(scriptPubKey, networkObj);
}

/**
 * Whether a hex string is a valid compressed secp256k1 public key: 33 bytes,
 * 0x02/0x03 prefix, and an x coordinate that is actually on the curve.
 * OpenSSL's point decoding (via ECDH.convertKey) rejects off-curve points.
 */
export function isValidCompressedPubKey(publicKeyHex: string): boolean {
  if (
    typeof publicKeyHex !== 'string' ||
    !/^0[23][0-9a-fA-F]{64}$/.test(publicKeyHex)
  ) {
    return false;
  }
  try {
    crypto.ECDH.convertKey(
      publicKeyHex,
      'secp256k1',
      'hex',
      'hex',
      'uncompressed',
    );
    return true;
  } catch {
    return false;
  }
}

// Exact byte layout of an SSP WK identity witness script:
//   OP_2 <0x21 + 33-byte key> <0x21 + 33-byte key> OP_2 OP_CHECKMULTISIG
const WK_WITNESS_SCRIPT_LENGTH = 71;
const OP_2 = 0x52;
const OP_CHECKMULTISIG = 0xae;
const PUSH_33 = 0x21;

/**
 * Parse an SSP WK identity witness script and extract its public keys.
 *
 * Only the exact canonical 2-of-2 layout is accepted (71 bytes):
 * OP_2 <33-byte pubkey> <33-byte pubkey> OP_2 OP_CHECKMULTISIG
 * Both keys must be valid compressed points and must differ. Anything else
 * (other m/n, interleaved opcodes, non-minimal pushes, duplicate keys,
 * uncompressed or off-curve keys) is refused: every caller uses this for WK
 * identities, which are always this shape.
 *
 * @param witnessScriptHex - Hex-encoded witness script
 * @returns Parsed witness script with m, n, and public keys
 */
export function parseWitnessScript(
  witnessScriptHex: string,
): ParsedWitnessScript {
  if (
    typeof witnessScriptHex !== 'string' ||
    !/^[0-9a-fA-F]*$/.test(witnessScriptHex) ||
    witnessScriptHex.length % 2 !== 0
  ) {
    throw new Error('Invalid witness script: not a hex string');
  }
  const script = Buffer.from(witnessScriptHex, 'hex');
  if (script.length !== WK_WITNESS_SCRIPT_LENGTH) {
    throw new Error(
      `Invalid witness script: expected ${WK_WITNESS_SCRIPT_LENGTH} bytes (2-of-2), got ${script.length}`,
    );
  }
  if (
    script[0] !== OP_2 ||
    script[1] !== PUSH_33 ||
    script[35] !== PUSH_33 ||
    script[69] !== OP_2 ||
    script[70] !== OP_CHECKMULTISIG
  ) {
    throw new Error(
      'Invalid witness script: not OP_2 <33> <33> OP_2 OP_CHECKMULTISIG',
    );
  }
  const publicKeys = [
    script.subarray(2, 35).toString('hex'),
    script.subarray(36, 69).toString('hex'),
  ];
  for (const pk of publicKeys) {
    if (!isValidCompressedPubKey(pk)) {
      throw new Error(
        'Invalid witness script: public key is not a valid compressed secp256k1 point',
      );
    }
  }
  if (publicKeys[0] === publicKeys[1]) {
    throw new Error('Invalid witness script: public keys must be distinct');
  }

  return { m: 2, n: 2, publicKeys };
}

/**
 * Compute the fingerprint of a signed request: a hash over the signature and
 * the signed message. Two requests share a fingerprint only when they are the
 * same signed payload — used to recognise an honest client (or its transport
 * layer) resending a request whose response was lost.
 */
export function requestFingerprint(authData: AuthFields): string {
  return crypto
    .createHash('sha256')
    .update(`${authData.signature}\n${authData.message}`)
    .digest('hex');
}

/**
 * Validate the signature payload (timestamp, nonce, etc.).
 *
 * @param payload - The parsed signature payload
 * @param fingerprint - Optional fingerprint of the signed request. When given
 *   and the nonce was already spent by a request with the SAME fingerprint,
 *   the payload validates with `duplicate: true` instead of failing — the
 *   caller decides whether an identical resend is acceptable. Without it a
 *   spent nonce always fails (strict at-most-once, e.g. socket join).
 * @returns Validation result
 */
export function validateSignaturePayload(
  payload: SignaturePayload,
  fingerprint?: string,
  allowedActions: readonly string[] = DEFAULT_ALLOWED_ACTIONS,
): {
  valid: boolean;
  error?: string;
  duplicate?: boolean;
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Invalid signed payload: not an object' };
  }

  // Validate timestamp: a finite integer number of milliseconds within the
  // allowed drift. A non-number (string, null, missing) would turn the drift
  // check into NaN > MAX, which is false, i.e. it would silently pass.
  if (
    typeof payload.timestamp !== 'number' ||
    !Number.isSafeInteger(payload.timestamp) ||
    payload.timestamp <= 0
  ) {
    return {
      valid: false,
      error: 'Invalid timestamp: expected an integer number of milliseconds',
    };
  }
  const now = Date.now();
  const drift = Math.abs(now - payload.timestamp);
  if (!(drift <= MAX_TIMESTAMP_DRIFT_MS)) {
    return {
      valid: false,
      error: `Timestamp too far from server time: ${drift}ms drift (max ${MAX_TIMESTAMP_DRIFT_MS}ms)`,
    };
  }

  // Validate nonce format (should be 64 hex characters = 32 bytes)
  if (
    typeof payload.nonce !== 'string' ||
    !/^[a-fA-F0-9]{64}$/.test(payload.nonce)
  ) {
    return {
      valid: false,
      error: 'Invalid nonce format: expected 64 hex characters',
    };
  }

  // Check nonce uniqueness (replay prevention). The nonce is only CONSUMED
  // once the whole request has verified — see consumeNonce. Burning it here
  // would mean a request that fails any later check (identity mismatch, bad
  // signature, clock skew) poisons its own nonce, so an honest client
  // retrying the identical signed payload would be told it was a replay.
  const spent = nonceCache.get(payload.nonce);
  if (spent) {
    // A byte-identical resend of the accepted request (mobile transport
    // layers re-send a POST when the connection dies before the response
    // arrives) is flagged rather than failed — but only when the caller
    // supplied a fingerprint to compare, and it matches the one that spent
    // the nonce. Any other reuse is a replay.
    if (fingerprint && spent.fingerprint && spent.fingerprint === fingerprint) {
      return { valid: true, duplicate: true };
    }
    return {
      valid: false,
      error: 'Nonce already used (potential replay attack)',
    };
  }

  // Validate action type. Each verifier states which actions it accepts, so
  // a signature made for one purpose (e.g. a header-signed GET 'read') can
  // never be spent on another (e.g. a POST write).
  if (
    typeof payload.action !== 'string' ||
    !allowedActions.includes(payload.action)
  ) {
    return {
      valid: false,
      error: `Invalid action: ${payload.action}`,
    };
  }

  // Validate identity is present
  if (!payload.identity || typeof payload.identity !== 'string') {
    return {
      valid: false,
      error: 'Missing or invalid identity in payload',
    };
  }

  return { valid: true };
}

/**
 * Mark a nonce as spent. Called only after a request has fully verified, so
 * exactly one accepted request may ever carry a given nonce while failed
 * attempts leave it usable. The fingerprint of the spending request is kept
 * so a byte-identical resend can later be recognised as a duplicate rather
 * than a replay (see validateSignaturePayload).
 *
 * The entry lives until the payload itself expires: a payload stamped up to
 * MAX_TIMESTAMP_DRIFT_MS in the future stays valid until timestamp + drift,
 * so the nonce is remembered until max(now, payloadTimestamp) + drift.
 *
 * Returns false — and records nothing — when the cache is full of unexpired
 * nonces. The caller must then refuse the request (fail closed): evicting a
 * live nonce would re-open it for replay.
 */
export function consumeNonce(
  nonce: string,
  fingerprint = '',
  payloadTimestamp: number = Date.now(),
): boolean {
  const now = Date.now();
  const max = nonceCacheMaxEntries();
  if (!nonceCache.has(nonce) && nonceCache.size >= max) {
    if (now - lastForcedSweepAt >= NONCE_CACHE_FORCED_SWEEP_MIN_INTERVAL_MS) {
      lastForcedSweepAt = now;
      cleanupNonceCache();
    }
    if (nonceCache.size >= max) {
      if (now - lastCacheFullLogAt >= 60 * 1000) {
        lastCacheFullLogAt = now;
        log.error(
          `[AUTH] Replay-protection nonce cache is full (${nonceCache.size} unexpired entries, max ${max}) — refusing signed requests until entries expire. Raise RELAY_NONCE_CACHE_MAX_ENTRIES if this is legitimate load.`,
        );
      }
      return false;
    }
  }
  const anchor = Number.isFinite(payloadTimestamp)
    ? Math.max(now, payloadTimestamp)
    : now;
  nonceCache.set(nonce, {
    expiresAt: anchor + MAX_TIMESTAMP_DRIFT_MS,
    fingerprint,
  });
  return true;
}

/** Drop every nonce whose payload can no longer pass the timestamp check. */
export function cleanupNonceCache(): void {
  const now = Date.now();
  // Use forEach to avoid iterator issues with older ES targets
  nonceCache.forEach((entry, nonce) => {
    if (entry.expiresAt <= now) {
      nonceCache.delete(nonce);
    }
  });
}

/** Number of remembered nonces (tests / diagnostics). */
export function nonceCacheSize(): number {
  return nonceCache.size;
}

/** Test helper: forget every nonce. */
export function resetNonceCache(): void {
  nonceCache.clear();
  lastForcedSweepAt = 0;
  lastCacheFullLogAt = 0;
}

/**
 * Start the periodic nonce cache sweep (once a minute). The timer is unref'd
 * so it never keeps the process (or a test run) alive on its own.
 */
export function startNonceCacheCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(
    cleanupNonceCache,
    NONCE_CACHE_SWEEP_INTERVAL_MS,
  );
  cleanupInterval.unref?.();
}

/**
 * Stop periodic nonce cache cleanup.
 */
export function stopNonceCacheCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

/**
 * Verify authentication for a single-sig identity (P2PKH).
 *
 * @param authData - Authentication fields from the request
 * @param expectedIdentity - The identity being authenticated
 * @param network - Bitcoin network
 * @param options - allowIdenticalReplay: a byte-identical resend of an
 *   already-accepted request verifies with `duplicate: true` instead of
 *   failing on its spent nonce. Callers that must stay strictly at-most-once
 *   (socket join) leave it off. allowedActions: the payload actions this
 *   caller accepts (defaults to DEFAULT_ALLOWED_ACTIONS, which excludes 'read').
 * @returns Verification result
 */
export function verifySingleSigAuth(
  authData: AuthFields,
  expectedIdentity: string,
  network: BitcoinNetwork = 'mainnet',
  options: {
    allowIdenticalReplay?: boolean;
    allowedActions?: readonly string[];
  } = {},
): VerificationResult {
  try {
    // Parse the message payload
    let payload: SignaturePayload;
    try {
      payload = JSON.parse(authData.message);
    } catch {
      return {
        valid: false,
        error: 'Invalid message format: not valid JSON',
      };
    }

    // Validate the payload
    const fingerprint = requestFingerprint(authData);
    const payloadValidation = validateSignaturePayload(
      payload,
      options.allowIdenticalReplay ? fingerprint : undefined,
      options.allowedActions,
    );
    if (!payloadValidation.valid) {
      return {
        valid: false,
        error: payloadValidation.error,
      };
    }

    // Verify identity in payload matches expected identity
    if (payload.identity !== expectedIdentity) {
      return {
        valid: false,
        error: `Identity mismatch: payload has ${payload.identity}, expected ${expectedIdentity}`,
      };
    }

    // Derive address from public key
    const derivedAddress = deriveP2PKHAddress(authData.publicKey, network);

    // Verify the derived address matches the expected identity
    if (derivedAddress !== expectedIdentity) {
      return {
        valid: false,
        error: `Address mismatch: derived ${derivedAddress}, expected ${expectedIdentity}`,
      };
    }

    // Verify the signature
    const signatureValid = verifyBitcoinSignature(
      authData.message,
      authData.signature,
      derivedAddress,
    );

    if (!signatureValid) {
      return {
        valid: false,
        error: 'Invalid signature',
      };
    }

    // Verified — spend the nonce now, so a replay of this exact request is
    // refused while a failed attempt above left it usable. A recognised
    // duplicate already spent it (with this very fingerprint).
    if (
      !payloadValidation.duplicate &&
      !consumeNonce(payload.nonce, fingerprint, payload.timestamp)
    ) {
      return {
        valid: false,
        unavailable: true,
        error: 'Replay protection is temporarily saturated; retry shortly',
      };
    }

    return {
      valid: true,
      identity: expectedIdentity,
      signerPublicKey: authData.publicKey,
      ...(payloadValidation.duplicate && { duplicate: true }),
    };
  } catch (err) {
    log.error(
      `Single-sig auth verification error: ${err instanceof Error ? err.message : err}`,
    );
    return {
      valid: false,
      error: `Verification error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Verify authentication for a multisig identity (P2WSH).
 *
 * The signature must be from one of the public keys in the witness script,
 * and the witness script must derive to the expected wkIdentity address.
 *
 * @param authData - Authentication fields from the request
 * @param expectedWkIdentity - The wkIdentity being authenticated
 * @param network - Bitcoin network
 * @param options - allowIdenticalReplay: a byte-identical resend of an
 *   already-accepted request verifies with `duplicate: true` instead of
 *   failing on its spent nonce. Callers that must stay strictly at-most-once
 *   (socket join) leave it off. allowedActions: the payload actions this
 *   caller accepts (defaults to DEFAULT_ALLOWED_ACTIONS, which excludes 'read').
 * @returns Verification result
 */
export function verifyMultisigAuth(
  authData: AuthFields,
  expectedWkIdentity: string,
  network: BitcoinNetwork = 'mainnet',
  options: {
    allowIdenticalReplay?: boolean;
    allowedActions?: readonly string[];
  } = {},
): VerificationResult {
  try {
    // Require witness script for multisig
    if (!authData.witnessScript) {
      return {
        valid: false,
        error: 'Witness script required for multisig authentication',
      };
    }

    // Parse the message payload
    let payload: SignaturePayload;
    try {
      payload = JSON.parse(authData.message);
    } catch {
      return {
        valid: false,
        error: 'Invalid message format: not valid JSON',
      };
    }

    // Validate the payload
    const fingerprint = requestFingerprint(authData);
    const payloadValidation = validateSignaturePayload(
      payload,
      options.allowIdenticalReplay ? fingerprint : undefined,
      options.allowedActions,
    );
    if (!payloadValidation.valid) {
      return {
        valid: false,
        error: payloadValidation.error,
      };
    }

    // Verify identity in payload matches expected identity
    if (payload.identity !== expectedWkIdentity) {
      return {
        valid: false,
        error: `Identity mismatch: payload has ${payload.identity}, expected ${expectedWkIdentity}`,
      };
    }

    // Parse the witness script
    let parsedScript: ParsedWitnessScript;
    try {
      parsedScript = parseWitnessScript(authData.witnessScript);
    } catch (error) {
      return {
        valid: false,
        error: `Invalid witness script: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    // Verify this is a 2-of-2 multisig (as expected for SSP)
    if (parsedScript.m !== 2 || parsedScript.n !== 2) {
      return {
        valid: false,
        error: `Unexpected multisig type: ${parsedScript.m}-of-${parsedScript.n}, expected 2-of-2`,
      };
    }

    // Verify the public key is one of the keys in the witness script
    const signerPubKeyNormalized = authData.publicKey.toLowerCase();
    const isValidSigner = parsedScript.publicKeys.some(
      (pk) => pk.toLowerCase() === signerPubKeyNormalized,
    );

    if (!isValidSigner) {
      return {
        valid: false,
        error: 'Signer public key is not part of the multisig witness script',
      };
    }

    // Derive the P2WSH address from the witness script
    const derivedAddress = deriveP2WSHAddress(authData.witnessScript, network);

    // Verify the derived address matches the expected wkIdentity
    if (derivedAddress !== expectedWkIdentity) {
      return {
        valid: false,
        error: `Address mismatch: derived ${derivedAddress}, expected ${expectedWkIdentity}`,
      };
    }

    // For signature verification, we need to verify against the signer's P2PKH address
    // (since the signature was created by one of the individual keys)
    const signerAddress = deriveP2PKHAddress(authData.publicKey, network);

    // Verify the signature
    const signatureValid = verifyBitcoinSignature(
      authData.message,
      authData.signature,
      signerAddress,
    );

    if (!signatureValid) {
      return {
        valid: false,
        error: 'Invalid signature',
      };
    }

    // Verified — spend the nonce now, so a replay of this exact request is
    // refused while a failed attempt above left it usable. A recognised
    // duplicate already spent it (with this very fingerprint).
    if (
      !payloadValidation.duplicate &&
      !consumeNonce(payload.nonce, fingerprint, payload.timestamp)
    ) {
      return {
        valid: false,
        unavailable: true,
        error: 'Replay protection is temporarily saturated; retry shortly',
      };
    }

    return {
      valid: true,
      identity: expectedWkIdentity,
      signerPublicKey: authData.publicKey,
      ...(payloadValidation.duplicate && { duplicate: true }),
    };
  } catch (err) {
    log.error(
      `Multisig auth verification error: ${err instanceof Error ? err.message : err}`,
    );
    return {
      valid: false,
      error: `Verification error: ${err instanceof Error ? err.message : 'Unknown error'}`,
    };
  }
}

/**
 * Determine if an identity is a multisig (P2WSH) address.
 *
 * P2WSH addresses:
 * - Mainnet: start with 'bc1q' and are 42-62 characters
 * - Testnet: start with 'tb1q' and are 42-62 characters
 *
 * @param identity - The identity to check
 * @returns Whether the identity appears to be a P2WSH address
 */
export function isMultisigIdentity(identity: string): boolean {
  // P2WSH addresses are bech32 encoded with bc1q (mainnet) or tb1q (testnet)
  // They are typically 42-62 characters for P2WSH
  // P2WPKH (single-sig segwit) would be bc1q... with 42 chars
  // P2WSH (multisig) would be bc1q... with 62 chars
  // However, identity addresses in SSP are P2PKH (1... or m/n...) for single-sig
  // and P2WSH (bc1q...) for multisig wkIdentity

  // For SSP:
  // - walletIdentity (single-sig) = P2PKH starting with '1' (mainnet) or 'm'/'n' (testnet)
  // - keyIdentity (single-sig) = P2PKH starting with '1' (mainnet) or 'm'/'n' (testnet)
  // - wkIdentity (multisig) = P2WSH starting with 'bc1q' (mainnet) or 'tb1q' (testnet)

  return identity.startsWith('bc1q') || identity.startsWith('tb1q');
}

/**
 * Detect the Bitcoin network from an address.
 *
 * @param address - Bitcoin address
 * @returns The detected network
 */
export function detectNetworkFromAddress(address: string): BitcoinNetwork {
  if (
    address.startsWith('1') ||
    address.startsWith('3') ||
    address.startsWith('bc1')
  ) {
    return 'mainnet';
  }
  if (
    address.startsWith('m') ||
    address.startsWith('n') ||
    address.startsWith('2') ||
    address.startsWith('tb1')
  ) {
    return 'testnet';
  }
  // Default to mainnet
  return 'mainnet';
}

/**
 * Generate a random nonce for signing.
 *
 * @returns 64 character hex string (32 bytes)
 */
export function generateNonce(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Create a signature payload for a given action and identity.
 *
 * @param action - The action being performed
 * @param identity - The identity to authenticate
 * @param dataHash - Optional hash of request body
 * @returns The signature payload
 */
export function createSignaturePayload(
  action: SignaturePayload['action'],
  identity: string,
  dataHash?: string,
): SignaturePayload {
  return {
    timestamp: Date.now(),
    action,
    identity,
    nonce: generateNonce(),
    ...(dataHash && { data: dataHash }),
  };
}

// Export types
export type {
  SignaturePayload,
  AuthFields,
  VerificationResult,
  ParsedWitnessScript,
  BitcoinNetwork,
};
