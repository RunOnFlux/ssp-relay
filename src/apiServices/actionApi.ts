import actionService from '../services/actionService';
import serviceHelper from '../services/serviceHelper';
import notificationService from '../services/notificationService';
import enterpriseHooks from '../services/enterpriseHooks';
import log from '../lib/log';
import socket, { recoveryRoom, RECOVERY_ROOM_EVENTS } from '../lib/socket';
import blockchains from '../services/blockchains';
import {
  stripAuthFields,
  AuthenticatedRequest,
} from '../middleware/authMiddleware';
import { validateWkSigningRequestPayload } from '../lib/wkSignValidation';
import { getEnterpriseNoncesNeeded } from '../services/noncePoolStatusCache';

interface utxo {
  txid: string;
  vout: number;
  scriptPubKey: string;
  satoshis: string;
  confirmations: number;
  coinbase: boolean;
}
interface actionData {
  chain: string;
  path: string;
  wkIdentity: string;
  action: string;
  payload: string;
  utxos?: utxo[];
}

/** The only action a client may post without signing it (see isUnsignedRecoveryRequest). */
export const UNSIGNED_ACTION = 'recoveryrequest';
/** The Key's answers to a recovery request (payload encrypted to the requester). */
export const RECOVERY_ANSWER_ACTIONS: readonly string[] = [
  'recoveryresponse',
  'recoverydenied',
];
const RECOVERY_ACTIONS: readonly string[] = [
  UNSIGNED_ACTION,
  ...RECOVERY_ANSWER_ACTIONS,
];
const RECOVERY_REQUEST_MAX_AGE_MS = 5 * 60 * 1000;
const RECOVERY_REQUEST_KEYS = new Set([
  'pkEph',
  'nonce',
  'timestamp',
  'recoveryIndex',
  'version',
]);

/**
 * Validate a wallet-recovery request payload. The recovering wallet has no
 * decrypted keys, so this is the one action that reaches the relay unsigned;
 * it is therefore held to its exact shape (mirroring SSP Key's own checks) so
 * the unsigned path cannot carry anything else to a Key.
 */
export function validateRecoveryRequestPayload(payload: unknown): {
  valid: boolean;
  error?: string;
} {
  if (typeof payload !== 'string' || payload.length > 2000) {
    return { valid: false, error: 'payload must be a short JSON string' };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { valid: false, error: 'payload is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { valid: false, error: 'payload must be a JSON object' };
  }
  for (const key of Object.keys(parsed)) {
    if (!RECOVERY_REQUEST_KEYS.has(key)) {
      return { valid: false, error: `unexpected field ${key}` };
    }
  }
  const { pkEph, nonce, timestamp, recoveryIndex, version } = parsed;
  if (typeof pkEph !== 'string' || !/^0[23][0-9a-fA-F]{64}$/.test(pkEph)) {
    return { valid: false, error: 'invalid pkEph' };
  }
  if (typeof nonce !== 'string' || !/^[0-9a-fA-F]{32,128}$/.test(nonce)) {
    return { valid: false, error: 'invalid nonce' };
  }
  if (
    typeof timestamp !== 'number' ||
    !Number.isSafeInteger(timestamp) ||
    Math.abs(Date.now() - timestamp) > RECOVERY_REQUEST_MAX_AGE_MS
  ) {
    return { valid: false, error: 'timestamp outside the accepted window' };
  }
  if (
    typeof recoveryIndex !== 'number' ||
    !Number.isInteger(recoveryIndex) ||
    recoveryIndex < 0 ||
    recoveryIndex >= 0x80000000
  ) {
    return { valid: false, error: 'invalid recoveryIndex' };
  }
  if (
    version !== undefined &&
    (typeof version !== 'number' || !Number.isInteger(version))
  ) {
    return { valid: false, error: 'invalid version' };
  }
  return { valid: true };
}

/**
 * How long a recovery ANSWER (recoveryresponse / recoverydenied) is held for
 * the recovering wallet before an unsigned recovery request may take the slot
 * again. The wallet waits for the answer for 2 minutes; the request window
 * (Key and relay) is 5 minutes.
 */
export const RECOVERY_ANSWER_HOLD_MS = RECOVERY_REQUEST_MAX_AGE_MS;

function timeMs(v: unknown): number {
  return v instanceof Date || typeof v === 'string' || typeof v === 'number'
    ? new Date(v).getTime()
    : NaN;
}

function recoveryPayloadFields(payload: unknown): {
  pkEph?: string;
  timestamp?: number;
} {
  if (typeof payload !== 'string') return {};
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * The identity has ONE action slot, and an unsigned recovery request is the
 * only write anyone can make to it without keys. It must therefore never
 * clobber something the identity's own devices or the recovering wallet are
 * waiting for. Throws when the pending action must be kept:
 *   - any live non-recovery action (a signing request, a response…);
 *   - a recovery ANSWER less than RECOVERY_ANSWER_HOLD_MS old — replacing it
 *     would erase the response the recovering wallet is polling for;
 *   - another live recovery REQUEST (different ephemeral key, timestamp still
 *     inside the 5-minute window the Key accepts) — replacing it would swap a
 *     stranger's request in front of the Key while its user is approving.
 * Expired actions, the recovering wallet's own retry (same pkEph) and dead
 * requests (older than the Key's window) may be replaced.
 */
export function assertUnsignedRecoveryMayReplace(
  pending: {
    action?: unknown;
    payload?: unknown;
    expireAt?: unknown;
    createdAt?: unknown;
  } | null,
  incomingPayload: unknown,
  now = Date.now(),
): void {
  if (!pending) return;
  const expiry = timeMs(pending.expireAt);
  const liveUntil = Number.isFinite(expiry) ? expiry : Number.POSITIVE_INFINITY;
  if (liveUntil <= now) return;
  const action = typeof pending.action === 'string' ? pending.action : '';
  if (!RECOVERY_ACTIONS.includes(action)) {
    throw new Error(
      'Another action is pending for this identity; unsigned recovery request refused',
    );
  }
  if (RECOVERY_ANSWER_ACTIONS.includes(action)) {
    const created = timeMs(pending.createdAt);
    const holdUntil = Number.isFinite(created)
      ? created + RECOVERY_ANSWER_HOLD_MS
      : liveUntil;
    if (holdUntil > now) {
      throw new Error(
        'A recovery answer is pending for this identity; unsigned recovery request refused',
      );
    }
    return;
  }
  // A pending recovery request.
  const prev = recoveryPayloadFields(pending.payload);
  const next = recoveryPayloadFields(incomingPayload);
  if (typeof prev.pkEph === 'string' && prev.pkEph === next.pkEph) return;
  if (
    typeof prev.timestamp !== 'number' ||
    !Number.isFinite(prev.timestamp) ||
    Math.abs(now - prev.timestamp) > RECOVERY_REQUEST_MAX_AGE_MS
  ) {
    return; // dead request: SSP Key refuses it anyway
  }
  throw new Error(
    'Another recovery request is pending for this identity; unsigned recovery request refused',
  );
}

/**
 * Predicate for the auth middleware: an UNSIGNED POST /v1/action is let
 * through only for a well-formed wallet-recovery request. Everything else
 * must be signed by the wkIdentity it names.
 */
export function isUnsignedRecoveryRequest(req: AuthenticatedRequest): boolean {
  const body = req.body as Record<string, unknown> | undefined;
  return (
    !!body &&
    typeof body === 'object' &&
    body.action === UNSIGNED_ACTION &&
    validateRecoveryRequestPayload(body.payload).valid
  );
}

async function getAction(req: AuthenticatedRequest, res) {
  try {
    const { id: paramId } = req.params;
    const id: unknown = paramId || req.query.id; // id is wkIdentity
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

    enterpriseHooks.onGetAction(req, id).catch((e) => log.error(e));

    if (req.recoveryOnlyRead === true) {
      // Unsigned read under RELAY_READ_AUTH_MODE=enforce: only a recovery
      // answer (encrypted to the recovering wallet's ephemeral key) may be
      // returned. Anything else — including "nothing pending" — is a 401, so
      // an unsigned caller learns nothing about the identity's other actions.
      const pending = await actionService.getAction(id).catch(() => null);
      if (!pending || !RECOVERY_ANSWER_ACTIONS.includes(pending.action)) {
        res
          .status(401)
          .json(
            serviceHelper.createErrorMessage(
              'Authentication required',
              'AuthenticationError',
              'AUTH_REQUIRED',
            ),
          );
        return;
      }
      res.json(pending);
      return;
    }

    const syncExist = await actionService.getAction(id);
    if (!syncExist) {
      throw new Error(`Action of ${id} does not exist`);
    }

    // Enrich with the enterprise nonce-pool flag. Polled every second, so it
    // is rate-limited per identity (10 s for a read signed for this id, 60 s
    // for unsigned reads, which only exist under RELAY_READ_AUTH_MODE=log).
    const noncesNeeded = await getEnterpriseNoncesNeeded(
      id,
      req.isAuthenticated === true && req.verifiedIdentity === id,
    );
    if (noncesNeeded) {
      syncExist.enterpriseNoncesNeeded = noncesNeeded;
    }

    res.json(syncExist);
  } catch (error) {
    if (!error.message.includes('testkappa')) {
      log.error(error);
    }
    res.sendStatus(404);
  }
}

async function postAction(req: AuthenticatedRequest, res) {
  try {
    // Strip auth fields before processing
    const processedBody = stripAuthFields(req.body);
    // Identifiers only: the payload (tx hex, recipients, signing requests)
    // must not be persisted in plaintext logs.
    log.info(
      `[ACTION] ${String(processedBody.action).slice(0, 64)} ${String(processedBody.chain).slice(0, 64)} ${String(processedBody.wkIdentity).slice(0, 100)} authenticated=${req.isAuthenticated === true}`,
    );
    // Defence in depth: the route middleware only lets an unsigned request
    // through for the recovery request; refuse anything else that arrives
    // here without a verified identity, or for a different identity.
    if (req.isAuthenticated !== true) {
      if (!isUnsignedRecoveryRequest(req)) {
        throw new Error('Unauthenticated action refused');
      }
      // The identity has ONE action slot; an unsigned recovery request may
      // only take it when nothing anyone is waiting for sits there (see
      // assertUnsignedRecoveryMayReplace).
      // Only "nothing stored" counts as an empty slot; a database error
      // fails closed (the request is refused).
      const pending = await actionService
        .getAction(processedBody.wkIdentity)
        .catch((e: unknown) => {
          if (e instanceof Error && / not found$/.test(e.message)) return null;
          throw e;
        });
      assertUnsignedRecoveryMayReplace(pending, processedBody.payload);
    } else if (req.verifiedIdentity !== processedBody.wkIdentity) {
      throw new Error('Verified identity does not match wkIdentity');
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
      !processedBody.wkIdentity ||
      typeof processedBody.wkIdentity !== 'string' ||
      processedBody.wkIdentity.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.wkIdentity)
    ) {
      throw new Error('Invalid Wallet-Key Identity specified');
    }
    if (
      !processedBody.action ||
      typeof processedBody.action !== 'string' ||
      processedBody.action.length > 200 ||
      !/^[a-zA-Z0-9_:-]+$/.test(processedBody.action)
    ) {
      throw new Error('Invalid Action specified');
    }
    if (
      !processedBody.payload ||
      typeof processedBody.payload !== 'string' ||
      processedBody.payload.length > 10000000
    ) {
      throw new Error('Invalid Payload specified'); // max 10MB
    }

    // Validate payload format based on chain type
    const blockchain = blockchains[processedBody.chain];
    if (blockchain && blockchain.chainType === 'evm') {
      // For EVM chains, validate payload is valid JSON with expected structure
      if (
        processedBody.action === 'tx' ||
        processedBody.action === 'evmsigningrequest'
      ) {
        try {
          const parsedPayload = JSON.parse(processedBody.payload);
          if (!parsedPayload || typeof parsedPayload !== 'object') {
            throw new Error('Payload must be valid JSON object for EVM chains');
          }
        } catch {
          throw new Error('Invalid EVM payload format: must be valid JSON');
        }
      }
    } else if (blockchain && blockchain.chainType === 'utxo') {
      // For UTXO chains, validate payload is hex string
      if (processedBody.action === 'tx') {
        if (!/^[0-9a-fA-F]+$/.test(processedBody.payload)) {
          throw new Error('Invalid UTXO payload format: must be hex string');
        }
      }
    }
    if (processedBody.action === 'tx' && !processedBody.path) {
      throw new Error('No Derivation Path specified');
    }

    if (processedBody.path) {
      if (
        typeof processedBody.path !== 'string' ||
        processedBody.path.length > 200 ||
        !/^[a-zA-Z0-9_:-]+$/.test(processedBody.path)
      ) {
        throw new Error('Invalid Derivation Path specified');
      }
    }

    // utxo {
    //   txid: string;
    //   vout: number;
    //   scriptPubKey: string;
    //   satoshis: string;
    //   confirmations: number;
    //   coinbase: boolean;
    // }
    if (processedBody.utxos) {
      // utxos must be an array of utxo objects. Not all fields have to be specified there
      if (!Array.isArray(processedBody.utxos)) {
        throw new Error('Invalid UTXOs specified');
      }
      // utxos must be an array of utxo objects. Not all fields have to be specified there
      processedBody.utxos.forEach((utxo) => {
        if (
          typeof utxo !== 'object' ||
          !utxo.txid ||
          (typeof utxo.vout !== 'number' && typeof utxo.vout !== 'string')
        ) {
          throw new Error('Invalid UTXO specified');
        }
        if (typeof utxo.txid !== 'string' || utxo.txid.length > 200) {
          // mandatory
          throw new Error('Invalid UTXO txid specified');
        }
        if (Number(utxo.vout) > 100000) {
          // mandatory
          throw new Error('Invalid UTXO vout specified');
        }
        if (utxo.scriptPubKey) {
          // optional
          if (
            typeof utxo.scriptPubKey !== 'string' ||
            utxo.scriptPubKey.length > 5000
          ) {
            throw new Error('Invalid UTXO scriptPubKey specified');
          }
        }
        if (utxo.satoshis) {
          // if its false, 0 its alright
          // optional
          if (Number(utxo.satoshis) > 1000000000000000000) {
            throw new Error('Invalid UTXO satoshis specified');
          }
        }
        if (utxo.confirmations) {
          // if its false, 0 its alright
          // optional
          if (Number(utxo.confirmations) > 100000000000) {
            throw new Error('Invalid UTXO confirmations specified');
          }
        }
        if (utxo.coinbase) {
          // if its false, 0 its alright
          // optional
          if (
            typeof utxo.coinbase !== 'boolean' &&
            utxo.coinbase !== 'true' &&
            utxo.coinbase !== 'false' &&
            utxo.coinbase !== '0' &&
            utxo.coinbase !== '1' &&
            utxo.coinbase !== 0 &&
            utxo.coinbase !== 1
          ) {
            throw new Error('Invalid UTXO coinbase specified');
          }
        }
      });
    }

    // Validate recovery request payload format (the unsigned action)
    if (processedBody.action === UNSIGNED_ACTION) {
      const validation = validateRecoveryRequestPayload(processedBody.payload);
      if (!validation.valid) {
        throw new Error(`Invalid recoveryrequest payload: ${validation.error}`);
      }
    }

    // Validate wksigningrequest payload format
    if (processedBody.action === 'wksigningrequest') {
      try {
        const parsedPayload = JSON.parse(processedBody.payload);
        const validation = validateWkSigningRequestPayload(parsedPayload);
        if (!validation.valid) {
          throw new Error(
            `Invalid wksigningrequest payload: ${validation.error}`,
          );
        }
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new Error(
            'Invalid wksigningrequest payload: must be valid JSON',
          );
        }
        throw error;
      }
    }

    const data: actionData = {
      chain: processedBody.chain,
      path: processedBody.path,
      wkIdentity: processedBody.wkIdentity,
      action: processedBody.action,
      payload: processedBody.payload,
    };

    if (processedBody.utxos) {
      data.utxos = processedBody.utxos;
    }

    enterpriseHooks.onAction(req, data).catch((e) => log.error(e));

    // Note: Regular publicnonces/publicnoncesrequest actions are for standard SSP Key<->Wallet
    // communication. Enterprise nonces are handled separately via POST /v1/nonces endpoint.
    // Future: SSP Enterprise multi-party will generate dedicated enterprise nonces.

    const actionOK = await actionService.postAction(data);
    if (!actionOK) {
      throw new Error('Failed to post action data');
    }
    const result = serviceHelper.createDataMessage(actionOK);

    // SSP Key listens for these actions
    if (
      data.action === 'tx' ||
      data.action === 'publicnoncesrequest' ||
      data.action === 'evmsigningrequest' ||
      data.action === 'wksigningrequest' ||
      data.action === 'enterprisevaultxpub' ||
      data.action === 'enterprisevaultsign' ||
      data.action === 'enterprisekeynoncesync' ||
      data.action === 'enterprisefluxnodestart' ||
      data.action === 'recoveryrequest' ||
      data.action === 'chainsyncrequest'
    ) {
      const ioKey = socket.getIOKey();
      ioKey.to(data.wkIdentity).emit(data.action, data);
      await notificationService
        .sendNotificationKey(data.wkIdentity, data)
        .catch((error) => log.error(error));
    }

    // SSP Wallet listens for these actions
    if (
      data.action === 'txrejected' ||
      data.action === 'txid' ||
      data.action === 'publicnoncesrejected' ||
      data.action === 'publicnonces' ||
      data.action === 'evmsigningrejected' ||
      data.action === 'evmsigned' ||
      data.action === 'wksigningrejected' ||
      data.action === 'wksigned' ||
      data.action === 'enterprisevaultxpubrejected' ||
      data.action === 'enterprisevaultxpubsigned' ||
      data.action === 'enterprisevaultsignrejected' ||
      data.action === 'enterprisevaultsigned' ||
      data.action === 'enterprisekeynoncesynced' ||
      data.action === 'enterprisekeynoncesyncrejected' ||
      data.action === 'enterprisefluxnodestarted' ||
      data.action === 'recoveryresponse' ||
      data.action === 'recoverydenied'
    ) {
      const ioWallet = socket.getIOWallet();
      ioWallet.to(data.wkIdentity).emit(data.action, data);
      // A recovering wallet joins unsigned and sits in the recovery-only room;
      // it receives the recovery answer (encrypted to its ephemeral key) and
      // nothing else.
      if (RECOVERY_ROOM_EVENTS.includes(data.action)) {
        ioWallet.to(recoveryRoom(data.wkIdentity)).emit(data.action, data);
      }
    }

    res.json(result);
  } catch (error) {
    log.error(error);
    res.sendStatus(400);
  }
}

export default {
  getAction,
  postAction,
};
