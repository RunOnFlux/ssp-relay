const socketio = require('socket.io');
const log = require('./log');

let ioKey;
let ioWallet;

function initIOKey(httpServer, path = '/v1/socket/key') {
  ioKey = socketio(httpServer, { path });
  ioKey.on('connection', async (socket) => {
    socket.on('join', async ({ wkIdentity }) => {
      socket.join(wkIdentity);
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

function initIOWallet(httpServer, path = '/v1/socket/wallet') {
  ioWallet = socketio(httpServer, { path });
  ioWallet.on('connection', async (socket) => {
    socket.on('join', async ({ wkIdentity }) => {
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

module.exports = {
  initIOKey,
  getIOKey,
  initIOWallet,
  getIOWallet,
};
