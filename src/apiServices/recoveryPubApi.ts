import recoveryPubService from '../services/recoveryPubService';
import log from '../lib/log';
import { stripAuthFields } from '../middleware/authMiddleware';

// Pass-through storage for SSP Key's recovery account xpub. No business logic
// lives here: the value is public, the relay never derives from it, and the
// wallet verifies the accompanying signature itself.
//
// TRANSITIONAL — scheduled for removal.
//
// The value also travels on the ordinary sync payload, which is where SSP
// Wallet takes it from. This endpoint exists only for pairs that were
// established before that field did and so have no sync event to carry it.
// Both writers run, and the wallet prefers the sync copy.
//
// Removal condition (measured, not calendar-based): the admin dashboard's
// Recovery Keys page reports how many identities are known ONLY through this
// endpoint. Once that reaches zero and stays there, delete this file,
// services/recoveryPubService.ts, the two routes, the v1recoverypub collection
// in config/default.ts, its index, and ssp-key's publishRecoveryXpub. Reviewed
// first on 2026-10-01.

const XPUB_MAX_LENGTH = 200;
const SIGNATURE_MAX_LENGTH = 200;

// NOTE the field name. `signature` is reserved for the request-auth envelope
// and stripAuthFields() removes it before a handler ever sees the body (see
// middleware/authMiddleware.ts), so this detached signature travels under its
// own name. syncApi.ts hits the same trap with witnessScript and works around
// it by reading the raw body first.

async function getRecoveryPub(req, res) {
  try {
    let { id } = req.params;
    id = id || req.query.id; // id is wkIdentity
    if (
      !id ||
      typeof id !== 'string' ||
      id.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(id)
    ) {
      res.status(400).send('Invalid ID');
      return;
    }
    const record = await recoveryPubService.getRecoveryPub(id);
    res.json(record);
  } catch (error) {
    log.error(error);
    res.sendStatus(404);
  }
}

async function postRecoveryPub(req, res) {
  try {
    const body = stripAuthFields(req.body);

    if (
      !body.wkIdentity ||
      typeof body.wkIdentity !== 'string' ||
      body.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(body.wkIdentity)
    ) {
      throw new Error('Invalid wkIdentity specified');
    }
    if (
      !body.recoveryXpub ||
      typeof body.recoveryXpub !== 'string' ||
      body.recoveryXpub.length > XPUB_MAX_LENGTH ||
      !/^[a-zA-Z0-9]+$/.test(body.recoveryXpub)
    ) {
      throw new Error('Invalid recoveryXpub specified');
    }
    if (
      !body.xpubSignature ||
      typeof body.xpubSignature !== 'string' ||
      body.xpubSignature.length > SIGNATURE_MAX_LENGTH
    ) {
      throw new Error('Invalid xpubSignature specified');
    }
    if (
      !body.chain ||
      typeof body.chain !== 'string' ||
      body.chain.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(body.chain)
    ) {
      throw new Error('Invalid chain specified');
    }

    const stored = await recoveryPubService.postRecoveryPub({
      wkIdentity: body.wkIdentity,
      recoveryXpub: body.recoveryXpub,
      xpubSignature: body.xpubSignature,
      chain: body.chain,
    });
    res.json(stored);
  } catch (error) {
    log.error(error);
    res.sendStatus(400);
  }
}

export default {
  getRecoveryPub,
  postRecoveryPub,
};
