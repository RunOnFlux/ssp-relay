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

export default {
  postNonces,
};
