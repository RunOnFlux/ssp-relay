import { Server } from 'socket.io';
import log from './log';
import socketService from '../services/socketService';
import enterpriseHooks from '../services/enterpriseHooks';
import {
  verifyMultisigAuth,
  detectNetworkFromAddress,
  isMultisigIdentity,
  AuthFields,
  SignaturePayload,
} from './identityAuth';
import { handshakeClientIp } from './clientIp';

let ioKey;
let ioWallet;

/**
 * Room for wallets that are recovering their password. Such a wallet has no
 * decrypted keys, so it cannot sign a join; it is admitted to this room only,
 * which receives nothing but the recovery answer (`recoveryresponse`, whose
 * payload is encrypted to the requester's ephemeral key) and `recoverydenied`.
 * Every other event for the identity goes to the authenticated room.
 */
export function recoveryRoom(wkIdentity: string): string {
  return `recovery:${wkIdentity}`;
}

/** Events a recovery-room member may receive. */
export const RECOVERY_ROOM_EVENTS: readonly string[] = [
  'recoveryresponse',
  'recoverydenied',
];

export interface SocketJoinData {
  wkIdentity: string;
  signature?: string;
  message?: string;
  publicKey?: string;
  witnessScript?: string;
}

export interface SocketAuthResult {
  valid: boolean;
  error?: string;
  /** No auth fields at all (as opposed to bad or partial auth). */
  unauthenticated?: boolean;
}

/**
 * Validate the shape of a join payload: an object with a string wkIdentity of
 * sane length. Returns the identity, or an error message.
 */
export function parseJoinData(
  data: unknown,
): { wkIdentity: string } | { error: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { error: 'Invalid join payload' };
  }
  const { wkIdentity } = data as { wkIdentity?: unknown };
  if (!wkIdentity || typeof wkIdentity !== 'string') {
    return { error: 'Invalid wkIdentity' };
  }
  if (wkIdentity.length < 10 || wkIdentity.length > 500) {
    return { error: 'Invalid wkIdentity length' };
  }
  return { wkIdentity };
}

/**
 * Verify socket authentication for wkIdentity (multisig).
 *
 * Auth is mandatory: a join without signature/message/publicKey is NOT
 * authenticated (returned with `unauthenticated: true` so the wallet
 * namespace can admit it to the recovery-only room), and a partial set is
 * refused outright.
 *
 * @param data - The join event data
 * @returns Whether authentication is valid
 */
export function verifySocketAuth(data: SocketJoinData): SocketAuthResult {
  const { wkIdentity, signature, message, publicKey, witnessScript } = data;

  if (!signature && !message && !publicKey) {
    return {
      valid: false,
      unauthenticated: true,
      error: 'Authentication required',
    };
  }
  if (
    typeof signature !== 'string' ||
    typeof message !== 'string' ||
    typeof publicKey !== 'string' ||
    !signature ||
    !message ||
    !publicKey
  ) {
    return { valid: false, error: 'Incomplete authentication fields' };
  }
  if (!/^[a-fA-F0-9]{66}$/.test(publicKey)) {
    return { valid: false, error: 'Invalid publicKey format' };
  }

  log.info(`[SOCKET AUTH] Verifying join for ${wkIdentity}...`);

  // Only multisig WK identities join rooms; witness script is mandatory.
  if (!isMultisigIdentity(wkIdentity)) {
    return { valid: false, error: 'Join identity must be a wkIdentity' };
  }
  if (
    !witnessScript ||
    typeof witnessScript !== 'string' ||
    !/^[a-fA-F0-9]+$/.test(witnessScript)
  ) {
    return {
      valid: false,
      error: 'witnessScript required for multisig identity',
    };
  }

  // Verify the signature payload action is 'join'
  try {
    const payload: SignaturePayload = JSON.parse(message);
    if (!payload || typeof payload !== 'object') {
      return { valid: false, error: 'Invalid message format' };
    }
    if (payload.action !== 'join') {
      return {
        valid: false,
        error: `Invalid action in payload: expected 'join', got '${String(payload.action)}'`,
      };
    }
    if (payload.identity !== wkIdentity) {
      return {
        valid: false,
        error: `Identity mismatch in payload`,
      };
    }
  } catch {
    return {
      valid: false,
      error: 'Invalid message format',
    };
  }

  const network = detectNetworkFromAddress(wkIdentity);
  const authData: AuthFields = {
    signature,
    message,
    publicKey,
    witnessScript,
  };

  const result = verifyMultisigAuth(authData, wkIdentity, network, {
    allowedActions: ['join'],
  });

  if (!result.valid) {
    log.warn(`[SOCKET AUTH] FAILED - ${wkIdentity}: ${result.error}`);
    return { valid: false, error: result.error };
  }

  log.info(
    `[SOCKET AUTH] SUCCESS - ${wkIdentity} (signer: ${result.signerPublicKey?.substring(0, 16)}...)`,
  );
  return { valid: true };
}

/**
 * Wrap a socket event listener so that neither a synchronous throw nor a
 * rejected promise can escape. socket.io dispatches listeners without a
 * try/catch, and the relay treats uncaughtException / unhandledRejection as
 * fatal (graceful shutdown), so a single malformed event (e.g. `join` with a
 * null payload) would otherwise take the whole relay down.
 */
export function safeListener<A extends unknown[]>(
  label: string,
  fn: (...args: A) => unknown,
): (...args: A) => void {
  return (...args: A) => {
    try {
      const result = fn(...args);
      if (result && typeof (result as Promise<unknown>).catch === 'function') {
        (result as Promise<unknown>).catch((error) => {
          log.error(
            `[SOCKET] ${label} handler failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });
      }
    } catch (error) {
      log.error(
        `[SOCKET] ${label} handler failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
}

function refuseJoin(socket, message: string): void {
  socket.emit('error', { message });
  socket.disconnect();
}

/**
 * Allowed browser origins for the wallet namespace's HTTP long-polling
 * transport (CORS only matters to browsers; the extension's own pages hold
 * host permissions and the mobile app is not a browser). Override with
 * RELAY_SOCKET_CORS_ORIGINS (comma-separated exact origins, or '*').
 */
const SOCKET_EXTENSION_ORIGIN =
  /^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-zA-Z0-9-]+$/;
const SOCKET_SSP_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*sspwallet\.(com|io)$/;
export function isAllowedSocketOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // non-browser clients send no Origin
  const override = process.env.RELAY_SOCKET_CORS_ORIGINS;
  if (override && override.trim()) {
    const list = override
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    if (list.includes('*')) return true;
    return list.includes(origin);
  }
  return SOCKET_EXTENSION_ORIGIN.test(origin) || SOCKET_SSP_ORIGIN.test(origin);
}

function initIOKey(httpServer?, path = '/v1/socket/key') {
  ioKey = new Server(httpServer, { path });
  ioKey.on('connection', (socket) => {
    log.info(`[SOCKET KEY] New connection: ${socket.id}`);
    socket.on(
      'join',
      safeListener('key join', async (data: unknown) => {
        const parsed = parseJoinData(data);
        if ('error' in parsed) {
          log.warn(`[SOCKET KEY] Invalid join: ${parsed.error}`);
          refuseJoin(socket, parsed.error);
          return;
        }
        const { wkIdentity } = parsed;

        // Verify authentication — mandatory on the key namespace.
        const authResult = verifySocketAuth(data as SocketJoinData);
        if (!authResult.valid) {
          log.warn(
            `Socket authentication failed for ${wkIdentity}: ${authResult.error}`,
          );
          refuseJoin(socket, authResult.error || 'Authentication failed');
          return;
        }

        socket.join(wkIdentity);
        log.info(`[SOCKET KEY] ${socket.id} joined room: ${wkIdentity}`);

        enterpriseHooks
          .onSocketJoin(wkIdentity, 'key', socket.id, {
            headers: socket.handshake.headers,
            address: socket.handshake.address,
            ...handshakeClientIp(socket.handshake),
          })
          .catch((e) => log.error(e));

        const actionToSend = await socketService
          .getAction(wkIdentity)
          .catch((error) => {
            log.error(error);
          });
        if (!actionToSend) {
          log.warn(`No action to send for ${wkIdentity}`);
          return;
        }
        if (
          actionToSend.action === 'tx' ||
          actionToSend.action === 'publicnoncesrequest' ||
          actionToSend.action === 'evmsigningrequest' ||
          actionToSend.action === 'wksigningrequest' ||
          actionToSend.action === 'enterprisevaultxpub' ||
          actionToSend.action === 'enterprisevaultsign' ||
          actionToSend.action === 'enterprisefluxnodestart' ||
          actionToSend.action === 'recoveryrequest' ||
          actionToSend.action === 'chainsyncrequest'
        ) {
          ioKey.to(wkIdentity).emit(actionToSend.action, actionToSend);
        }
      }),
    );

    socket.on(
      'leave',
      safeListener('key leave', (data: unknown) => {
        const parsed = parseJoinData(data);
        if ('error' in parsed) return;
        const { wkIdentity } = parsed;
        socket.leave(wkIdentity);
        enterpriseHooks
          .onSocketLeave(wkIdentity, 'key', socket.id, {
            headers: socket.handshake.headers,
            address: socket.handshake.address,
            ...handshakeClientIp(socket.handshake),
          })
          .catch((e) => log.error(e));
      }),
    );
  });
  return ioKey;
}

function getIOKey() {
  if (!ioKey) {
    log.warn('ioKey not initialized');
    initIOKey();
  }
  return ioKey;
}

function initIOWallet(httpServer?, path = '/v1/socket/wallet') {
  ioWallet = new Server(httpServer, {
    path,
    // @ts-expect-error keeping flashsocket for now. todo tests, fix
    transports: ['websocket', 'polling', 'flashsocket'],
    allowEIO3: true,
    cors: {
      origin: (origin, callback) => {
        callback(null, isAllowedSocketOrigin(origin));
      },
      methods: ['GET', 'POST'],
    },
  });
  ioWallet.on('connection', (socket) => {
    log.info(`[SOCKET WALLET] New connection: ${socket.id}`);
    socket.on(
      'join',
      safeListener('wallet join', (data: unknown) => {
        const parsed = parseJoinData(data);
        if ('error' in parsed) {
          log.warn(`[SOCKET WALLET] Invalid join: ${parsed.error}`);
          refuseJoin(socket, parsed.error);
          return;
        }
        const { wkIdentity } = parsed;

        // Verify authentication
        const authResult = verifySocketAuth(data as SocketJoinData);
        if (!authResult.valid) {
          if (authResult.unauthenticated) {
            // A wallet without keys (password recovery) cannot sign. Admit it
            // to the recovery-only room: it receives the recovery answer for
            // its identity and nothing else.
            socket.join(recoveryRoom(wkIdentity));
            log.info(
              `[SOCKET WALLET] ${socket.id} joined recovery-only room for ${wkIdentity} (unsigned join)`,
            );
            return;
          }
          log.warn(
            `[SOCKET WALLET] Auth failed for ${wkIdentity}: ${authResult.error}`,
          );
          refuseJoin(socket, authResult.error || 'Authentication failed');
          return;
        }

        socket.join(wkIdentity);
        log.info(`[SOCKET WALLET] ${socket.id} joined room: ${wkIdentity}`);
        enterpriseHooks
          .onSocketJoin(wkIdentity, 'wallet', socket.id, {
            headers: socket.handshake.headers,
            address: socket.handshake.address,
            ...handshakeClientIp(socket.handshake),
          })
          .catch((e) => log.error(e));
      }),
    );
    socket.on(
      'leave',
      safeListener('wallet leave', (data: unknown) => {
        const parsed = parseJoinData(data);
        if ('error' in parsed) return;
        const { wkIdentity } = parsed;
        socket.leave(wkIdentity);
        socket.leave(recoveryRoom(wkIdentity));
        enterpriseHooks
          .onSocketLeave(wkIdentity, 'wallet', socket.id, {
            headers: socket.handshake.headers,
            address: socket.handshake.address,
            ...handshakeClientIp(socket.handshake),
          })
          .catch((e) => log.error(e));
      }),
    );
  });
  return ioWallet;
}

function getIOWallet() {
  if (!ioWallet) {
    log.warn('ioWallet not initialized');
    initIOWallet();
  }
  return ioWallet;
}

export default {
  initIOKey,
  getIOKey,
  initIOWallet,
  getIOWallet,
};
