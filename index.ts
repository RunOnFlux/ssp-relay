import http from 'http';
import config from './config/default';
import app from './src/lib/server';
import log from './src/lib/log';
import socket from './src/lib/socket';

import serviceHelper from './src/services/serviceHelper';

import databaseService from './src/services/databaseIndexCreationService';

import ratesService from './src/services/ratesService';

import networkFeesService from './src/services/networkFeesService';

const server = http.createServer(app);

ratesService.initRates();

socket.initIOKey(server);
socket.initIOWallet(server);

log.info('Initiating database');
serviceHelper.initiateDB();

setTimeout(() => {
  log.info('Preparing indexes');
  databaseService.doIndexes(); // no waiting
}, 2000);

networkFeesService.fetchFees();

setTimeout(() => {
  log.info('Starting SSP Relay');
  server.listen(config.server.port, () => {
    log.info(`App listening on port ${config.server.port}`);
  });
}, 4000);
