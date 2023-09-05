const socketio = require('socket.io');
const log = require('./log');

let ioKey;
let ioWallet;

function initIOKey(httpServer, path = '/v1/socket/key') {
  ioKey = socketio(httpServer, { path });
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
