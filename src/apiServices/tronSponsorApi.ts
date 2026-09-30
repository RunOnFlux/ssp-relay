import tronSponsorService, {
  TronSponsorRefusal,
} from '../services/tronSponsorService';
import serviceHelper from '../services/serviceHelper';
import log from '../lib/log';
import { stripAuthFields } from '../middleware/authMiddleware';
import {
  isTronChain,
  type TronBroadcastRequest,
  type TronQuoteRequest,
} from '../types/tron';

function isValidChainParam(chain: unknown): chain is 'tron' | 'tronNile' {
  return (
    typeof chain === 'string' &&
    chain.length < 50 &&
    /^[a-zA-Z0-9_-]+$/.test(chain) &&
    isTronChain(chain)
  );
}

function sendError(res, error: unknown): void {
  const refusal = error instanceof TronSponsorRefusal;
  if (!refusal) log.error(error);
  // Refusals and the sponsor's own errors (node / broadcast outcomes) are
  // meant for the caller; a database driver error is not (it names the
  // database, collections and indexes). It is logged above in full.
  const internal =
    !refusal && error instanceof Error && /^Mongo/.test(error.name);
  res.json(
    serviceHelper.createErrorMessage(
      internal
        ? 'Internal error'
        : error instanceof Error
          ? error.message
          : 'Unknown error',
      error instanceof Error && !internal ? error.name : 'Error',
      refusal ? '400' : '500',
    ),
  );
}

// GET /v1/tron/sponsor?chain=tron
async function getSponsor(req, res) {
  try {
    const chain = req.query.chain;
    if (!isValidChainParam(chain)) {
      throw new TronSponsorRefusal('Invalid or unsupported chain');
    }
    res.json(
      serviceHelper.createDataMessage(
        tronSponsorService.getSponsorContext(chain),
      ),
    );
  } catch (error) {
    sendError(res, error);
  }
}

// POST /v1/tron/quote — the public (untrusted) quote: the relay chooses the
// nonce and the markup; `deadline` is capped at the consumer 2 h.
async function postQuote(req, res) {
  try {
    const body = stripAuthFields(req.body ?? {}) as Record<string, unknown>;
    if (!isValidChainParam(body.chain)) {
      throw new TronSponsorRefusal('Invalid or unsupported chain');
    }
    const request: TronQuoteRequest = {
      chain: body.chain,
      signers: body.signers as string[],
      threshold: body.threshold as number,
      calls: body.calls as TronQuoteRequest['calls'],
      ...(body.feeToken !== undefined
        ? { feeToken: body.feeToken as string }
        : {}),
      ...(body.deadline !== undefined
        ? { deadline: body.deadline as string }
        : {}),
      ...(body.max !== undefined
        ? { max: body.max as TronQuoteRequest['max'] }
        : {}),
      ...(body.nonce !== undefined ? { nonce: body.nonce as string } : {}),
      ...(body.markup !== undefined ? { markup: body.markup as number } : {}),
    };
    const quote = await tronSponsorService.quote(request, { trusted: false });
    res.json(serviceHelper.createDataMessage(quote));
  } catch (error) {
    sendError(res, error);
  }
}

// POST /v1/tron/broadcast — { chain, signers, threshold, op, signatures }
async function postBroadcast(req, res) {
  try {
    const body = stripAuthFields(req.body ?? {}) as Record<string, unknown>;
    if (!isValidChainParam(body.chain)) {
      throw new TronSponsorRefusal('Invalid or unsupported chain');
    }
    const request: TronBroadcastRequest = {
      chain: body.chain,
      signers: body.signers as string[],
      threshold: body.threshold as number,
      op: body.op as TronBroadcastRequest['op'],
      signatures: body.signatures as string[],
    };
    const result = await tronSponsorService.broadcast(request);
    res.json(serviceHelper.createDataMessage(result));
  } catch (error) {
    sendError(res, error);
  }
}

export default {
  getSponsor,
  postQuote,
  postBroadcast,
};
