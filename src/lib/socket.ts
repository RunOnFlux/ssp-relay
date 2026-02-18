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

let ioKey;
let ioWallet;

/**
 * Verify socket authentication for wkIdentity (multisig).
 *
 * @param data - The join event data
 * @returns Whether authentication is valid
 */
function verifySocketAuth(data: {
  wkIdentity: string;
  signature?: string;
  message?: string;
  publicKey?: string;
  witnessScript?: string;
}): { valid: boolean; error?: string } {
  const { wkIdentity, signature, message, publicKey, witnessScript } = data;

  // If no auth fields provided, allow for backward compatibility
  // TODO: Make auth required after clients are updated
  if (!signature || !message || !publicKey) {
    log.warn(
      `[SOCKET AUTH] SKIPPED - ${wkIdentity} (no auth fields, legacy client)`,
    );
    return { valid: true }; // Allow for backward compatibility
  }

  log.info(`[SOCKET AUTH] Verifying join for ${wkIdentity}...`);

  // For multisig identity, require witness script
  if (isMultisigIdentity(wkIdentity) && !witnessScript) {
    return {
      valid: false,
      error: 'witnessScript required for multisig identity',
    };
  }

  // Verify the signature payload action is 'join'
  try {
    const payload: SignaturePayload = JSON.parse(message);
    if (payload.action !== 'join') {
      return {
        valid: false,
        error: `Invalid action in payload: expected 'join', got '${payload.action}'`,
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

  const result = verifyMultisigAuth(authData, wkIdentity, network);

  if (!result.valid) {
    log.warn(`[SOCKET AUTH] FAILED - ${wkIdentity}: ${result.error}`);
    return { valid: false, error: result.error };
  }

  log.info(
    `[SOCKET AUTH] SUCCESS - ${wkIdentity} (signer: ${result.signerPublicKey?.substring(0, 16)}...)`,
  );
  return { valid: true };
}

function initIOKey(httpServer?, path = '/v1/socket/key') {
  ioKey = new Server(httpServer, { path });
  ioKey.on('connection', async (socket) => {
    log.info(`[SOCKET KEY] New connection: ${socket.id}`);
    socket.on(
      'join',
      async (data: {
        wkIdentity: string;
        signature?: string;
        message?: string;
        publicKey?: string;
        witnessScript?: string;
      }) => {
        const { wkIdentity } = data;

        // Validate wkIdentity before joining room
        if (!wkIdentity || typeof wkIdentity !== 'string') {
          log.warn('Invalid wkIdentity provided to socket join');
          socket.emit('error', { message: 'Invalid wkIdentity' });
          socket.disconnect();
          return;
        }
        if (wkIdentity.length < 10 || wkIdentity.length > 500) {
          log.warn(`Invalid wkIdentity length: ${wkIdentity.length}`);
          socket.emit('error', { message: 'Invalid wkIdentity length' });
          socket.disconnect();
          return;
        }

        // Verify authentication
        const authResult = verifySocketAuth(data);
        if (!authResult.valid) {
          log.warn(
            `Socket authentication failed for ${wkIdentity}: ${authResult.error}`,
          );
          socket.emit('error', {
            message: authResult.error || 'Authentication failed',
          });
          socket.disconnect();
          return;
        }

        socket.join(wkIdentity);
        log.info(`[SOCKET KEY] ${socket.id} joined room: ${wkIdentity}`);

        enterpriseHooks
          .onSocketJoin(wkIdentity, 'key', socket.id, {
            headers: socket.handshake.headers,
            address: socket.handshake.address,
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
          actionToSend.action === 'enterprisevaultsign'
        ) {
          ioKey.to(wkIdentity).emit(actionToSend.action, actionToSend);
        }
      },
    );

    socket.on('leave', ({ wkIdentity }) => {
      if (!wkIdentity || typeof wkIdentity !== 'string') {
        return;
      }
      socket.leave(wkIdentity);
      enterpriseHooks
        .onSocketLeave(wkIdentity, 'key', socket.id, {
          headers: socket.handshake.headers,
          address: socket.handshake.address,
        })
        .catch((e) => log.error(e));
    });
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
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  ioWallet.on('connection', (socket) => {
    log.info(`[SOCKET WALLET] New connection: ${socket.id}`);
    socket.on(
      'join',
      (data: {
        wkIdentity: string;
        signature?: string;
        message?: string;
        publicKey?: string;
        witnessScript?: string;
      }) => {
        const { wkIdentity } = data;

        // Validate wkIdentity before joining room
        if (!wkIdentity || typeof wkIdentity !== 'string') {
          log.warn('Invalid wkIdentity provided to wallet socket join');
          socket.emit('error', { message: 'Invalid wkIdentity' });
          socket.disconnect();
          return;
        }
        if (wkIdentity.length < 10 || wkIdentity.length > 500) {
          log.warn(`Invalid wkIdentity length: ${wkIdentity.length}`);
          socket.emit('error', { message: 'Invalid wkIdentity length' });
          socket.disconnect();
          return;
        }

        // Verify authentication
        const authResult = verifySocketAuth(data);
        if (!authResult.valid) {
          log.warn(
            `[SOCKET WALLET] Auth failed for ${wkIdentity}: ${authResult.error}`,
          );
          socket.emit('error', {
            message: authResult.error || 'Authentication failed',
          });
          socket.disconnect();
          return;
        }

        socket.join(wkIdentity);
        log.info(`[SOCKET WALLET] ${socket.id} joined room: ${wkIdentity}`);
        enterpriseHooks
          .onSocketJoin(wkIdentity, 'wallet', socket.id, {
            headers: socket.handshake.headers,
            address: socket.handshake.address,
          })
          .catch((e) => log.error(e));
      },
    );
    socket.on('leave', ({ wkIdentity }) => {
      if (!wkIdentity || typeof wkIdentity !== 'string') {
        return;
      }
      socket.leave(wkIdentity);
      enterpriseHooks
        .onSocketLeave(wkIdentity, 'wallet', socket.id, {
          headers: socket.handshake.headers,
          address: socket.handshake.address,
        })
        .catch((e) => log.error(e));
    });
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
