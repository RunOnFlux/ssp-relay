import syncService from '../services/syncService';
import serviceHelper from '../services/serviceHelper';
import enterpriseHooks from '../services/enterpriseHooks';
import { getEnterpriseNoncesNeeded } from '../services/noncePoolStatusCache';
import log from '../lib/log';
import {
  stripAuthFields,
  AuthenticatedRequest,
} from '../middleware/authMiddleware';
import {
  parseWitnessScript,
  deriveP2PKHAddress,
  detectNetworkFromAddress,
} from '../lib/identityAuth';

interface syncData {
  chain: string;
  walletIdentity: string;
  keyXpub: string;
  wkIdentity: string;
  generatedAddress?: string;
  publicNonces?: string[];
  // Additional fields for verification
  walletXpub?: string;
  keyIdentity?: string;
  redeemScript?: string;
  witnessScript?: string; // chain first-address script (see postSync)
  recoveryXpub?: string;
  xpubSignature?: string;
  // CS-1: base64 Bitcoin message signature by the Key's identity key over
  // `SSP_CHAIN_SYNC:${chain}:${walletXpub}:${keyXpub}`. Carried through for
  // the wallet to verify; the relay only checks its shape.
  keyXpubSignature?: string;
  // For chainType === 'sol', keyXpub/walletXpub are JSON-stringified
  // arrays of 20 base58 Ed25519 leaf pubkeys.
  // Whether the write was signed (wkIdentity auth). Server-side only (not in
  // the GET projection); used by assertSyncRecordWritable.
  authenticated?: boolean;
}

// Sync records live 15 minutes (syncService.postSync / the TTL index).
const SYNC_RECORD_TTL_MS = 15 * 60 * 1000;

/**
 * Refuse a sync write that would take over another pairing's LIVE record.
 *
 * Records are keyed by walletIdentity, and any WK identity whose script
 * contains the wallet's identity key can pass verifySyncIdentityBinding (the
 * wallet key is public), so a signature alone does not prove the writer is the
 * wallet's real partner. While a record is live (< 15 min) it may only be
 * rewritten for the SAME wkIdentity:
 *   - different wkIdentity → refused (also for unsigned legacy writes);
 *   - an unsigned (legacy) write may not replace a live SIGNED record at all.
 * An expired record (expireAt passed; Mongo's TTL sweep can lag a minute) or
 * a legacy-empty one (no wkIdentity) may be replaced. A genuine re-pairing
 * with a different SSP Key therefore waits until the previous record expires
 * (at most 15 minutes).
 */
export function assertSyncRecordWritable(
  existing: {
    wkIdentity?: unknown;
    expireAt?: unknown;
    createdAt?: unknown;
    authenticated?: unknown;
  } | null,
  incoming: { wkIdentity: string; authenticated: boolean },
  now = Date.now(),
): void {
  if (!existing) return;
  if (typeof existing.wkIdentity !== 'string' || !existing.wkIdentity) return;
  const toMs = (v: unknown): number =>
    v instanceof Date || typeof v === 'string' || typeof v === 'number'
      ? new Date(v).getTime()
      : NaN;
  let liveUntil = toMs(existing.expireAt);
  if (!Number.isFinite(liveUntil)) {
    const created = toMs(existing.createdAt);
    liveUntil = Number.isFinite(created) ? created + SYNC_RECORD_TTL_MS : 0;
  }
  if (liveUntil <= now) return;
  if (existing.wkIdentity !== incoming.wkIdentity) {
    throw new Error(
      'A pending sync for this wallet belongs to a different SSP identity; refusing to overwrite it (retry after it expires, at most 15 minutes)',
    );
  }
  if (existing.authenticated === true && !incoming.authenticated) {
    throw new Error(
      'A signed sync for this wallet is pending; an unsigned sync cannot replace it',
    );
  }
}

async function getSync(req: AuthenticatedRequest, res) {
  try {
    const { id: paramId } = req.params;
    const id: unknown = paramId || req.query.id; // id is walletIdentity
    if (
      !id ||
      typeof id !== 'string' ||
      id.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(id)
    ) {
      // send status code 400 and message of invalid id
      res.status(400).send('Invalid ID');
      return;
    }

    enterpriseHooks.onGetSync(req, id).catch((e) => log.error(e));

    const syncExist = await syncService.getSync(id);
    if (!syncExist) {
      throw new Error(`Sync of ${id} does not exist`);
    }

    // Enrich with the enterprise nonce-pool flag, rate-limited per identity
    // (10 s for a read signed by this walletIdentity, 60 s for unsigned reads
    // under RELAY_READ_AUTH_MODE=log). Polled every second while pairing.
    if (typeof syncExist.wkIdentity === 'string' && syncExist.wkIdentity) {
      const noncesNeeded = await getEnterpriseNoncesNeeded(
        syncExist.wkIdentity,
        req.isAuthenticated === true && req.verifiedIdentity === id,
      );
      if (noncesNeeded) {
        syncExist.enterpriseNoncesNeeded = noncesNeeded;
      }
    }

    res.json(syncExist);
  } catch (error) {
    if (!error.message.includes('testkappa')) {
      log.error(error);
    }
    res.sendStatus(404);
  }
}

/**
 * Bind a SIGNED sync to the WK pair it claims.
 *
 * POST /v1/sync is signed by SSP Key as the wkIdentity (2-of-2 of the
 * wallet's and the Key's /10/0 identity keys). The record is stored under
 * `walletIdentity`, so the signature alone is not enough: anyone can sign for
 * a WK identity they made up. The record may only be written by the WK
 * partner of that wallet, i.e.:
 *   - the auth witness script is the canonical 2-of-2 for wkIdentity
 *     (already checked by the auth middleware),
 *   - walletIdentity is the P2PKH address of the script key that did NOT sign,
 *   - keyIdentity, when present, is the P2PKH address of the signing key.
 * Throws with a reason on any mismatch.
 */
export function verifySyncIdentityBinding(opts: {
  wkIdentity: string;
  wkWitnessScript: unknown;
  signerPublicKey: unknown;
  walletIdentity: string;
  keyIdentity?: unknown;
}): void {
  if (typeof opts.wkWitnessScript !== 'string') {
    throw new Error('Signed sync is missing the WK witness script');
  }
  if (typeof opts.signerPublicKey !== 'string') {
    throw new Error('Signed sync is missing the signer public key');
  }
  const network = detectNetworkFromAddress(opts.wkIdentity);
  const { publicKeys } = parseWitnessScript(opts.wkWitnessScript);
  const signer = opts.signerPublicKey.toLowerCase();
  const signerIndex = publicKeys.findIndex((pk) => pk.toLowerCase() === signer);
  if (signerIndex === -1) {
    throw new Error('Sync signer is not a member of the WK identity');
  }
  const walletKey = publicKeys[1 - signerIndex];
  if (deriveP2PKHAddress(walletKey, network) !== opts.walletIdentity) {
    throw new Error(
      "walletIdentity is not the WK partner of the signing key — refusing to overwrite another wallet's sync record",
    );
  }
  if (
    opts.keyIdentity !== undefined &&
    opts.keyIdentity !== null &&
    opts.keyIdentity !== '' &&
    deriveP2PKHAddress(publicKeys[signerIndex], network) !== opts.keyIdentity
  ) {
    throw new Error('keyIdentity does not match the signing key');
  }
}

async function postSync(req: AuthenticatedRequest, res) {
  try {
    // `witnessScript` is ambiguous on this endpoint. On a SIGNED sync it is
    // the auth envelope's WK identity script (verified by the middleware) and
    // the chain's first-address script travels as `chainWitnessScript` (so it
    // is covered by the body hash). On a legacy UNSIGNED sync (only possible
    // with RELAY_LEGACY_UNAUTH_MODE=log) it is the chain script, as before.
    const rawWitnessScript = req.body?.witnessScript;

    // Strip auth fields before processing
    const processedBody = stripAuthFields(req.body);
    let chainWitnessScript: unknown;
    if (req.isAuthenticated === true) {
      if (req.verifiedIdentity !== processedBody.wkIdentity) {
        throw new Error('Verified identity does not match wkIdentity');
      }
      if (
        typeof processedBody.walletIdentity !== 'string' ||
        !processedBody.walletIdentity
      ) {
        throw new Error('Invalid Wallet identity specified');
      }
      verifySyncIdentityBinding({
        wkIdentity: processedBody.wkIdentity,
        wkWitnessScript: rawWitnessScript,
        signerPublicKey: req.signerPublicKey,
        walletIdentity: processedBody.walletIdentity,
        keyIdentity: processedBody.keyIdentity,
      });
      chainWitnessScript = processedBody.chainWitnessScript;
    } else if (req.legacyUnauthenticated === true) {
      chainWitnessScript = rawWitnessScript;
    } else {
      throw new Error('Unauthenticated sync refused');
    }
    if (
      !processedBody.chain ||
      typeof processedBody.chain !== 'string' ||
      processedBody.chain.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.chain)
    ) {
      throw new Error('Invalid Chain specified');
    }
    if (
      !processedBody.walletIdentity ||
      typeof processedBody.walletIdentity !== 'string' ||
      processedBody.walletIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.walletIdentity)
    ) {
      throw new Error('Invalid Wallet identity specified');
    }
    if (!processedBody.keyXpub || typeof processedBody.keyXpub !== 'string') {
      throw new Error('Invalid XPUB of Key specified');
    }
    // For Solana chains the xpub field carries a JSON-stringified array of
    // 20 base58 Ed25519 leaf pubkeys (Ed25519 has no non-hardened public-key
    // derivation, so an actual xpub is useless). Validate accordingly.
    if (
      processedBody.chain === 'solDevnet' ||
      processedBody.chain === 'solMainnet'
    ) {
      if (processedBody.keyXpub.length > 3000) {
        throw new Error('Invalid XPUB of Key specified');
      }
      try {
        const arr = JSON.parse(processedBody.keyXpub);
        if (!Array.isArray(arr) || arr.length !== 20) {
          throw new Error('expected 20-entry array');
        }
        const seen = new Set<string>();
        for (const pk of arr) {
          if (
            typeof pk !== 'string' ||
            pk.length < 32 ||
            pk.length > 64 ||
            !/^[1-9A-HJ-NP-Za-km-z]+$/.test(pk)
          ) {
            throw new Error('invalid base58 entry');
          }
          // Each HD slot derives a distinct ed25519 leaf — duplicates are a
          // malformed submission (wallet/key bug) or a tampering attempt.
          if (seen.has(pk)) {
            throw new Error('duplicate pubkey in array');
          }
          seen.add(pk);
        }
      } catch {
        throw new Error('Invalid XPUB of Key specified');
      }
    } else if (
      processedBody.keyXpub.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.keyXpub)
    ) {
      throw new Error('Invalid XPUB of Key specified');
    }
    if (
      !processedBody.wkIdentity ||
      typeof processedBody.wkIdentity !== 'string' ||
      processedBody.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.wkIdentity)
    ) {
      throw new Error('Invalid SSP Identity specified');
    }

    // validations
    // generated address
    if (
      processedBody.generatedAddress &&
      typeof processedBody.generatedAddress !== 'string'
    ) {
      throw new Error('Invalid generated address');
    }

    if (
      processedBody.generatedAddress &&
      (processedBody.generatedAddress.length > 200 ||
        !/^[a-zA-Z0-9_:-]+$/.test(processedBody.generatedAddress))
    ) {
      throw new Error('Generated address is invalid');
    }

    // public nonces
    if (
      processedBody.publicNonces &&
      !Array.isArray(processedBody.publicNonces)
    ) {
      throw new Error('Invalid public nonces');
    }

    if (processedBody.publicNonces && processedBody.publicNonces.length > 0) {
      processedBody.publicNonces.forEach((nonce) => {
        // nonce is object containing kPublic and kTwoPublic
        if (
          typeof nonce !== 'object' ||
          typeof nonce.kPublic !== 'string' ||
          typeof nonce.kTwoPublic !== 'string'
        ) {
          throw new Error('Invalid public nonce detected');
        }

        if (nonce.kPublic.length > 200 || nonce.kTwoPublic.length > 200) {
          throw new Error('Public nonce is too long');
        }
      });
    }

    // too many nonces
    if (
      processedBody.publicNonces &&
      processedBody.publicNonces.length > 1000
    ) {
      throw new Error('Too many public nonces submitted');
    }

    // validate walletXpub (optional). For Solana, same JSON-array shape.
    if (processedBody.walletXpub) {
      if (typeof processedBody.walletXpub !== 'string') {
        throw new Error('Invalid Wallet XPUB specified');
      }
      if (
        processedBody.chain === 'solDevnet' ||
        processedBody.chain === 'solMainnet'
      ) {
        if (processedBody.walletXpub.length > 3000) {
          throw new Error('Invalid Wallet XPUB specified');
        }
        try {
          const arr = JSON.parse(processedBody.walletXpub);
          if (!Array.isArray(arr) || arr.length !== 20) {
            throw new Error('expected 20-entry array');
          }
          const seen = new Set<string>();
          for (const pk of arr) {
            if (
              typeof pk !== 'string' ||
              pk.length < 32 ||
              pk.length > 64 ||
              !/^[1-9A-HJ-NP-Za-km-z]+$/.test(pk)
            ) {
              throw new Error('invalid base58 entry');
            }
            // Each HD slot derives a distinct ed25519 leaf — duplicates are
            // malformed (wallet/key bug or tampering attempt).
            if (seen.has(pk)) {
              throw new Error('duplicate pubkey in array');
            }
            seen.add(pk);
          }
        } catch {
          throw new Error('Invalid Wallet XPUB specified');
        }
      } else if (
        processedBody.walletXpub.length > 200 ||
        !/^[a-zA-Z0-9_:-]+$/.test(processedBody.walletXpub)
      ) {
        throw new Error('Invalid Wallet XPUB specified');
      }
    }

    // validate keyIdentity (optional)
    if (
      processedBody.keyIdentity &&
      (typeof processedBody.keyIdentity !== 'string' ||
        processedBody.keyIdentity.length > 200 ||
        !/^[a-zA-Z0-9_:-]+$/.test(processedBody.keyIdentity))
    ) {
      throw new Error('Invalid Key Identity specified');
    }

    // validate redeemScript (optional) - hex string
    if (
      processedBody.redeemScript &&
      (typeof processedBody.redeemScript !== 'string' ||
        processedBody.redeemScript.length > 1000 ||
        !/^[a-fA-F0-9]+$/.test(processedBody.redeemScript))
    ) {
      throw new Error('Invalid Redeem Script specified');
    }

    // validate the chain's first-address witness script (optional) - hex string
    if (
      chainWitnessScript &&
      (typeof chainWitnessScript !== 'string' ||
        chainWitnessScript.length > 1000 ||
        !/^[a-fA-F0-9]+$/.test(chainWitnessScript))
    ) {
      throw new Error('Invalid Witness Script specified');
    }

    const data: syncData = {
      chain: processedBody.chain,
      walletIdentity: processedBody.walletIdentity,
      keyXpub: processedBody.keyXpub,
      wkIdentity: processedBody.wkIdentity,
      generatedAddress: processedBody.generatedAddress, // this is the address generated on the key that must match the address on the wallet, this is optional, verification is done on the wallet
    };

    // EVM sync
    if (processedBody.publicNonces && processedBody.publicNonces.length > 0) {
      data.publicNonces = processedBody.publicNonces;
    }

    // Additional fields for verification
    if (processedBody.walletXpub) {
      data.walletXpub = processedBody.walletXpub;
    }
    if (processedBody.keyIdentity) {
      data.keyIdentity = processedBody.keyIdentity;
    }
    if (processedBody.redeemScript) {
      data.redeemScript = processedBody.redeemScript;
    }
    if (chainWitnessScript && typeof chainWitnessScript === 'string') {
      data.witnessScript = chainWitnessScript;
    }
    // SSP Key's recovery account xpub and its signature. SSP Wallet verifies the
    // signature itself, so this is carried through rather than interpreted.
    if (
      processedBody.recoveryXpub &&
      typeof processedBody.recoveryXpub === 'string' &&
      processedBody.recoveryXpub.length <= 200
    ) {
      data.recoveryXpub = processedBody.recoveryXpub;
    }
    if (
      processedBody.xpubSignature &&
      typeof processedBody.xpubSignature === 'string' &&
      processedBody.xpubSignature.length <= 200
    ) {
      data.xpubSignature = processedBody.xpubSignature;
    }

    if (processedBody.keyXpubSignature !== undefined) {
      if (
        typeof processedBody.keyXpubSignature !== 'string' ||
        processedBody.keyXpubSignature.length > 120 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(processedBody.keyXpubSignature)
      ) {
        throw new Error('Invalid keyXpubSignature specified');
      }
      data.keyXpubSignature = processedBody.keyXpubSignature;
    }

    data.authenticated = req.isAuthenticated === true;
    // Fails closed: if the current owner cannot be read, nothing is written.
    const existing = await syncService.getSyncOwner(data.walletIdentity);
    assertSyncRecordWritable(existing, {
      wkIdentity: data.wkIdentity,
      authenticated: data.authenticated,
    });

    const tokenData = {
      wkIdentity: processedBody.wkIdentity,
      keyToken: processedBody.keyToken,
    };

    enterpriseHooks.onSync(req, data).catch((e) => log.error(e));

    const syncOK = await syncService.postSync(data);
    await syncService.postToken(tokenData).catch((error) => log.error(error)); // we do not need to fail if this fails
    if (!syncOK) {
      throw new Error('Failed to update synchronisation data');
    }
    const result = serviceHelper.createDataMessage(syncOK);
    res.json(result);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

async function postToken(req: AuthenticatedRequest, res) {
  try {
    // Strip auth fields before processing
    const processedBody = stripAuthFields(req.body);
    // The route requires wkIdentity auth; never accept a token write for an
    // identity other than the one that signed (it would redirect someone
    // else's push notifications).
    if (
      req.isAuthenticated !== true ||
      req.verifiedIdentity !== processedBody.wkIdentity
    ) {
      throw new Error('Unauthenticated token update refused');
    }
    if (
      !processedBody.wkIdentity ||
      typeof processedBody.wkIdentity !== 'string' ||
      processedBody.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.wkIdentity)
    ) {
      throw new Error('Invalid SSP identity specified');
    }

    if (
      !processedBody.keyToken ||
      typeof processedBody.keyToken !== 'string' ||
      processedBody.keyToken.length > 5000
    ) {
      throw new Error('Invalid SSP Key Token specified');
    }

    const tokenData = {
      wkIdentity: processedBody.wkIdentity,
      keyToken: processedBody.keyToken,
    };

    enterpriseHooks.onToken(req, tokenData).catch((e) => log.error(e));

    const syncOK = await syncService.postToken(tokenData);
    if (!syncOK) {
      throw new Error('Failed to update synced data');
    }
    const result = serviceHelper.createDataMessage(syncOK);
    res.json(result);
  } catch (error) {
    log.error(error);
    const errMessage = serviceHelper.createErrorMessage(
      error.message,
      error.name,
      error.code,
    );
    res.json(errMessage);
  }
}

export default {
  getSync,
  postSync,
  postToken,
};
