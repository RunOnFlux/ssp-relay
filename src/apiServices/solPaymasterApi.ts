import solPaymasterService from '../services/solPaymasterService';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';
import { stripAuthFields } from '../middleware/authMiddleware';

const SUPPORTED_CHAINS = ['solDevnet', 'solMainnet'];

function isValidChainId(chain: unknown): chain is string {
  return (
    typeof chain === 'string' &&
    chain.length < 50 &&
    /^[a-zA-Z0-9_-]+$/.test(chain) &&
    SUPPORTED_CHAINS.includes(chain)
  );
}

async function getPaymaster(req, res) {
  try {
    const chain = req.query.chain;
    if (!isValidChainId(chain)) {
      throw new Error('Invalid or unsupported chain');
    }
    const pubkey = solPaymasterService.getPaymasterPubkey(chain);
    const fees = solPaymasterService.getFeeSchedule();
    res.json(serviceHelper.createDataMessage({ chain, pubkey, fees }));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(
        error instanceof Error ? error.message : 'Unknown error',
        error instanceof Error ? error.name : 'Error',
        '500',
      ),
    );
  }
}

async function postBroadcast(req, res) {
  try {
    const processedBody = stripAuthFields(req.body) as Record<string, unknown>;
    const chain = processedBody.chain;
    const serializedTxBase64 = processedBody.serializedTxBase64;
    if (!isValidChainId(chain)) {
      throw new Error('Invalid or unsupported chain');
    }
    if (
      typeof serializedTxBase64 !== 'string' ||
      serializedTxBase64.length === 0 ||
      serializedTxBase64.length > 16384 ||
      !/^[A-Za-z0-9+/=]+$/.test(serializedTxBase64)
    ) {
      throw new Error('Invalid serialized transaction');
    }
    const signature = await solPaymasterService.broadcastWithPaymaster(
      chain,
      serializedTxBase64,
    );
    res.json(serviceHelper.createDataMessage({ signature }));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(
        error instanceof Error ? error.message : 'Unknown error',
        error instanceof Error ? error.name : 'Error',
        '500',
      ),
    );
  }
}

function isValidSolanaPubkey(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    v.length >= 32 &&
    v.length <= 44 &&
    // base58 alphabet
    /^[1-9A-HJ-NP-Za-km-z]+$/.test(v)
  );
}

async function postSetup(req, res) {
  try {
    const processedBody = stripAuthFields(req.body) as Record<string, unknown>;
    const chain = processedBody.chain;
    const walletPubkey = processedBody.walletPubkey;
    const keyPubkey = processedBody.keyPubkey;
    if (!isValidChainId(chain)) {
      throw new Error('Invalid or unsupported chain');
    }
    if (!isValidSolanaPubkey(walletPubkey)) {
      throw new Error('Invalid walletPubkey');
    }
    if (!isValidSolanaPubkey(keyPubkey)) {
      throw new Error('Invalid keyPubkey');
    }
    if (walletPubkey === keyPubkey) {
      throw new Error('walletPubkey and keyPubkey must differ');
    }

    const result = await solPaymasterService.setupSolMultisig({
      chain,
      walletPubkey,
      keyPubkey,
    });

    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    log.error(error);
    res.json(
      serviceHelper.createErrorMessage(
        error instanceof Error ? error.message : 'Unknown error',
        error instanceof Error ? error.name : 'Error',
        '500',
      ),
    );
  }
}

export default {
  getPaymaster,
  postBroadcast,
  postSetup,
};
