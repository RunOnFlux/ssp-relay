/**
 * Identity Authentication Library for SSP Relay
 *
 * Provides cryptographic verification of Bitcoin signatures for authenticating
 * identities (wkIdentity, walletIdentity, keyIdentity) on relay endpoints.
 *
 * Supports both single-sig (P2PKH) and multisig (P2WSH) addresses.
 */

import * as bitcoin from '@runonflux/utxo-lib';
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
const MAX_TIMESTAMP_DRIFT_MS = 10 * 60 * 1000; // 10 minutes
const NONCE_CACHE_SIZE = 10000;
const NONCE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// Nonce cache to prevent replay attacks
// Map<nonce, timestamp>
const nonceCache = new Map<string, number>();

// Periodic cleanup interval reference
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get the Bitcoin network object based on network name.
 */
function getNetwork(network: BitcoinNetwork): typeof bitcoin.networks.bitcoin {
  return network === 'testnet'
    ? bitcoin.networks.testnet
    : bitcoin.networks.bitcoin;
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

  const keyPair = bitcoin.ECPair.fromPublicKeyBuffer(pubKeyBuffer, networkObj);
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
  const scriptPubKey = bitcoin.script.witnessScriptHash.output.encode(
    bitcoin.crypto.sha256(witnessScript),
  );

  return bitcoin.address.fromOutputScript(scriptPubKey, networkObj);
}

/**
 * Parse a multisig witness script and extract public keys.
 *
 * Witness script format for 2-of-2:
 * OP_2 <pubkey1> <pubkey2> OP_2 OP_CHECKMULTISIG
 *
 * @param witnessScriptHex - Hex-encoded witness script
 * @returns Parsed witness script with m, n, and public keys
 */
export function parseWitnessScript(
  witnessScriptHex: string,
): ParsedWitnessScript {
  const scriptBuffer = Buffer.from(witnessScriptHex, 'hex');

  // Decode the script using utxo-lib
  const decompiled = bitcoin.script.decompile(scriptBuffer);

  if (!decompiled || decompiled.length < 4) {
    throw new Error('Invalid witness script: too short');
  }

  // First element should be OP_m (OP_1 = 0x51, OP_2 = 0x52, etc.)
  const mOpcode = decompiled[0];
  if (typeof mOpcode !== 'number' || mOpcode < 0x51 || mOpcode > 0x60) {
    throw new Error('Invalid witness script: missing or invalid m value');
  }
  const m = mOpcode - 0x50; // OP_1 is 0x51, so subtract 0x50 to get the number

  // Last element should be OP_CHECKMULTISIG (0xae)
  const lastElement = decompiled[decompiled.length - 1];
  if (lastElement !== 0xae) {
    throw new Error('Invalid witness script: missing OP_CHECKMULTISIG');
  }

  // Second to last should be OP_n
  const nOpcode = decompiled[decompiled.length - 2];
  if (typeof nOpcode !== 'number' || nOpcode < 0x51 || nOpcode > 0x60) {
    throw new Error('Invalid witness script: missing or invalid n value');
  }
  const n = nOpcode - 0x50;

  // Extract public keys (elements between m and n)
  const publicKeys: string[] = [];
  for (let i = 1; i < decompiled.length - 2; i++) {
    const element = decompiled[i];
    if (Buffer.isBuffer(element)) {
      if (element.length !== 33) {
        throw new Error(
          `Invalid public key at position ${i}: expected 33 bytes`,
        );
      }
      publicKeys.push(element.toString('hex'));
    }
  }

  if (publicKeys.length !== n) {
    throw new Error(
      `Invalid witness script: expected ${n} public keys, found ${publicKeys.length}`,
    );
  }

  return { m, n, publicKeys };
}

/**
 * Validate the signature payload (timestamp, nonce, etc.).
 *
 * @param payload - The parsed signature payload
 * @returns Validation result
 */
export function validateSignaturePayload(payload: SignaturePayload): {
  valid: boolean;
  error?: string;
} {
  // Validate timestamp (must be within 5 minutes of server time)
  const now = Date.now();
  const drift = Math.abs(now - payload.timestamp);
  if (drift > MAX_TIMESTAMP_DRIFT_MS) {
    return {
      valid: false,
      error: `Timestamp too far from server time: ${drift}ms drift (max ${MAX_TIMESTAMP_DRIFT_MS}ms)`,
    };
  }

  // Validate nonce format (should be 64 hex characters = 32 bytes)
  if (!/^[a-fA-F0-9]{64}$/.test(payload.nonce)) {
    return {
      valid: false,
      error: 'Invalid nonce format: expected 64 hex characters',
    };
  }

  // Check nonce uniqueness (replay prevention)
  if (nonceCache.has(payload.nonce)) {
    return {
      valid: false,
      error: 'Nonce already used (potential replay attack)',
    };
  }

  // Add nonce to cache
  nonceCache.set(payload.nonce, now);

  // Trim cache if too large
  if (nonceCache.size > NONCE_CACHE_SIZE) {
    cleanupNonceCache();
  }

  // Validate action type
  const validActions = ['sync', 'action', 'token', 'join'];
  if (!validActions.includes(payload.action)) {
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
 * Clean up expired nonces from the cache.
 */
export function cleanupNonceCache(): void {
  const now = Date.now();
  const expiredThreshold = now - NONCE_CACHE_TTL_MS;

  // Use forEach to avoid iterator issues with older ES targets
  nonceCache.forEach((timestamp, nonce) => {
    if (timestamp < expiredThreshold) {
      nonceCache.delete(nonce);
    }
  });
}

/**
 * Start periodic nonce cache cleanup.
 */
export function startNonceCacheCleanup(): void {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(cleanupNonceCache, NONCE_CACHE_TTL_MS);
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
 * @returns Verification result
 */
export function verifySingleSigAuth(
  authData: AuthFields,
  expectedIdentity: string,
  network: BitcoinNetwork = 'mainnet',
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
    const payloadValidation = validateSignaturePayload(payload);
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

    return {
      valid: true,
      identity: expectedIdentity,
      signerPublicKey: authData.publicKey,
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
 * @returns Verification result
 */
export function verifyMultisigAuth(
  authData: AuthFields,
  expectedWkIdentity: string,
  network: BitcoinNetwork = 'mainnet',
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
    const payloadValidation = validateSignaturePayload(payload);
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

    return {
      valid: true,
      identity: expectedWkIdentity,
      signerPublicKey: authData.publicKey,
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
