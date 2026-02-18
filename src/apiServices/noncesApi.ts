import serviceHelper from '../services/serviceHelper';
import enterpriseHooks from '../services/enterpriseHooks';
import log from '../lib/log';
import { stripAuthFields } from '../middleware/authMiddleware';

interface PublicNonce {
  kPublic: string;
  kTwoPublic: string;
}

interface NoncesData {
  wkIdentity: string;
  source: 'wallet' | 'key';
  chain?: string;
  nonces: PublicNonce[];
}

/**
 * POST /v1/nonces
 * Receive and store ENTERPRISE public nonces from wallet or key.
 *
 * These are dedicated nonces for SSP Enterprise multi-party signing,
 * NOT the regular SSP Key<->Wallet nonces (those are handled via /v1/action
 * and are ephemeral - not stored).
 */
async function postNonces(req, res) {
  try {
    // Strip auth fields before processing
    const processedBody = stripAuthFields(req.body);

    // Validate wkIdentity
    if (
      !processedBody.wkIdentity ||
      typeof processedBody.wkIdentity !== 'string' ||
      processedBody.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.wkIdentity)
    ) {
      throw new Error('Invalid SSP identity specified');
    }

    // Validate source
    if (
      !processedBody.source ||
      (processedBody.source !== 'wallet' && processedBody.source !== 'key')
    ) {
      throw new Error('Invalid source specified. Must be "wallet" or "key"');
    }

    // Validate chain (optional)
    if (
      processedBody.chain &&
      (typeof processedBody.chain !== 'string' ||
        processedBody.chain.length > 50 ||
        !/^[a-zA-Z0-9_-]+$/.test(processedBody.chain))
    ) {
      throw new Error('Invalid chain specified');
    }

    // Validate nonces array
    if (!processedBody.nonces || !Array.isArray(processedBody.nonces)) {
      throw new Error('Invalid nonces array');
    }

    if (processedBody.nonces.length === 0) {
      throw new Error('Nonces array cannot be empty');
    }

    if (processedBody.nonces.length > 1000) {
      throw new Error('Too many nonces submitted (max 1000)');
    }

    // Validate each nonce
    const validatedNonces: PublicNonce[] = [];
    for (const nonce of processedBody.nonces) {
      if (
        typeof nonce !== 'object' ||
        typeof nonce.kPublic !== 'string' ||
        typeof nonce.kTwoPublic !== 'string'
      ) {
        throw new Error(
          'Invalid nonce format. Each nonce must have kPublic and kTwoPublic',
        );
      }

      if (nonce.kPublic.length > 200 || nonce.kTwoPublic.length > 200) {
        throw new Error('Nonce value is too long');
      }

      // Validate hex format (public keys should be hex)
      if (
        !/^[a-fA-F0-9]+$/.test(nonce.kPublic) ||
        !/^[a-fA-F0-9]+$/.test(nonce.kTwoPublic)
      ) {
        throw new Error('Nonce values must be hex strings');
      }

      validatedNonces.push({
        kPublic: nonce.kPublic,
        kTwoPublic: nonce.kTwoPublic,
      });
    }

    // Enterprise module required for nonce storage
    if (!enterpriseHooks.isLoaded()) {
      throw new Error(
        'Enterprise module not available. Nonces cannot be stored.',
      );
    }

    const data: NoncesData = {
      wkIdentity: processedBody.wkIdentity,
      source: processedBody.source,
      chain: processedBody.chain || undefined,
      nonces: validatedNonces,
    };

    // Store nonces via enterprise hook
    await enterpriseHooks.onNonces(req, data);

    const response = serviceHelper.createDataMessage({
      status: 'success',
      message: `Received ${validatedNonces.length} nonces for storage`,
    });

    res.json(response);
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

/**
 * GET /v1/nonces/status/:wkIdentity
 * Get nonce pool status for an enterprise identity.
 */
async function getNonceStatus(req, res) {
  try {
    const { wkIdentity } = req.params;

    // Validate wkIdentity
    if (
      !wkIdentity ||
      typeof wkIdentity !== 'string' ||
      wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(wkIdentity)
    ) {
      throw new Error('Invalid SSP identity specified');
    }

    if (!enterpriseHooks.isLoaded()) {
      throw new Error(
        'Enterprise module not available. Nonce status unavailable.',
      );
    }

    const hook = (enterpriseHooks as Record<string, unknown>)[
      'getNoncePoolStatus'
    ];
    if (typeof hook !== 'function') {
      throw new Error('Nonce pool status not available');
    }

    const poolStatus = await (
      hook as (wkIdentity: string) => Promise<unknown>
    )(wkIdentity);

    const TARGET_COUNT = 50;
    const MINIMUM_COUNT = 10;

    // Build structured response
    const statusArr = poolStatus as Array<{
      source: string;
      available: number;
      used: number;
      total: number;
    }>;
    const walletPool = statusArr.find((p) => p.source === 'wallet');
    const keyPool = statusArr.find((p) => p.source === 'key');

    const response = {
      wallet: {
        available: walletPool?.available ?? 0,
        used: walletPool?.used ?? 0,
        total: walletPool?.total ?? 0,
      },
      key: {
        available: keyPool?.available ?? 0,
        used: keyPool?.used ?? 0,
        total: keyPool?.total ?? 0,
      },
      replenishNeeded: {
        wallet: (walletPool?.available ?? 0) < MINIMUM_COUNT,
        key: (keyPool?.available ?? 0) < MINIMUM_COUNT,
      },
      targetCount: TARGET_COUNT,
      minimumCount: MINIMUM_COUNT,
    };

    res.json(serviceHelper.createDataMessage(response));
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

/**
 * POST /v1/nonces/validate
 * Validate that nonces exist and are in the expected state.
 * Used by devices to confirm their submitted nonces were stored correctly.
 *
 * Body: { wkIdentity, source, nonces: [{ kPublic, kTwoPublic }] }
 * Returns: { valid: number, missing: number, used: number }
 */
async function validateNonces(req, res) {
  try {
    const processedBody = stripAuthFields(req.body);

    // Validate wkIdentity
    if (
      !processedBody.wkIdentity ||
      typeof processedBody.wkIdentity !== 'string' ||
      processedBody.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.wkIdentity)
    ) {
      throw new Error('Invalid SSP identity specified');
    }

    // Validate source
    if (
      !processedBody.source ||
      (processedBody.source !== 'wallet' && processedBody.source !== 'key')
    ) {
      throw new Error('Invalid source specified. Must be "wallet" or "key"');
    }

    // Validate nonces array
    if (!processedBody.nonces || !Array.isArray(processedBody.nonces)) {
      throw new Error('Invalid nonces array');
    }

    if (processedBody.nonces.length === 0 || processedBody.nonces.length > 100) {
      throw new Error('Nonces array must have 1-100 entries');
    }

    if (!enterpriseHooks.isLoaded()) {
      throw new Error('Enterprise module not available.');
    }

    // Use getNonces to check stored nonces for this identity
    const storedNonces = await enterpriseHooks.getNonces(
      processedBody.wkIdentity,
      {
        source: processedBody.source,
        includeUsed: true,
        limit: 10000,
      },
    );

    // Build lookup map
    const nonceMap = new Map<string, { usedAt: unknown; status?: string }>();
    for (const n of storedNonces) {
      nonceMap.set(`${n.kPublic}:${n.kTwoPublic}`, { usedAt: n.usedAt, status: n.status });
    }

    let valid = 0;
    let missing = 0;
    let used = 0;

    for (const nonce of processedBody.nonces) {
      if (typeof nonce?.kPublic !== 'string' || typeof nonce?.kTwoPublic !== 'string') {
        continue;
      }
      const key = `${nonce.kPublic}:${nonce.kTwoPublic}`;
      const stored = nonceMap.get(key);
      if (!stored) {
        missing++;
      } else if (stored.status === 'used' || stored.usedAt !== null) {
        used++;
      } else {
        valid++;
      }
    }

    res.json(serviceHelper.createDataMessage({ valid, missing, used }));
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
  postNonces,
  getNonceStatus,
  validateNonces,
};
