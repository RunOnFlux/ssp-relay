import { Server } from 'socket.io';
import log from './log';
import socketService from '../services/socketService';

let ioKey;
let ioWallet;

function initIOKey(httpServer?, path = '/v1/socket/key') {
  ioKey = new Server(httpServer, { path });
  ioKey.on('connection', async (socket) => {
    socket.on('join', async ({ wkIdentity }) => {
      // Validate wkIdentity before joining room
      if (!wkIdentity || typeof wkIdentity !== 'string') {
        log.warn('Invalid wkIdentity provided to socket join');
        socket.disconnect();
        return;
      }
      if (wkIdentity.length < 10 || wkIdentity.length > 500) {
        log.warn(`Invalid wkIdentity length: ${wkIdentity.length}`);
        socket.disconnect();
        return;
      }

      socket.join(wkIdentity);
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
        actionToSend.action === 'publicnoncesrequest'
      ) {
        ioKey.to(wkIdentity).emit(actionToSend.action, actionToSend);
      }
    });

    socket.on('leave', ({ wkIdentity }) => {
      if (!wkIdentity || typeof wkIdentity !== 'string') {
        return;
      }
      socket.leave(wkIdentity);
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
    socket.on('join', ({ wkIdentity }) => {
      // Validate wkIdentity before joining room
      if (!wkIdentity || typeof wkIdentity !== 'string') {
        log.warn('Invalid wkIdentity provided to wallet socket join');
        socket.disconnect();
        return;
      }
      if (wkIdentity.length < 10 || wkIdentity.length > 500) {
        log.warn(`Invalid wkIdentity length: ${wkIdentity.length}`);
        socket.disconnect();
        return;
      }
      socket.join(wkIdentity);
    });
    socket.on('leave', ({ wkIdentity }) => {
      if (!wkIdentity || typeof wkIdentity !== 'string') {
        return;
      }
      socket.leave(wkIdentity);
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
