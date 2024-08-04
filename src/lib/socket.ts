import { Server } from 'socket.io';
import log from './log';
import socketService from '../services/socketService';

let ioKey;
let ioWallet;

function initIOKey(httpServer?, path = '/v1/socket/key') {
  ioKey = new Server(httpServer, { path });
  ioKey.on('connection', async (socket) => {
    socket.on('join', async ({ wkIdentity }) => {
      socket.join(wkIdentity);
      const actionToSend = await socketService.getAction(wkIdentity).catch();
      if (
        actionToSend.action === 'tx' ||
        actionToSend.action === 'publicnoncesrequest'
      ) {
        ioKey.to(wkIdentity).emit(actionToSend.action, actionToSend);
      }
    });

    socket.on('leave', ({ wkIdentity }) => {
      socket.leave(wkIdentity);
    });
  });
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
      socket.join(wkIdentity);
    });
    socket.on('leave', ({ wkIdentity }) => {
      socket.leave(wkIdentity);
    });
  });
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
