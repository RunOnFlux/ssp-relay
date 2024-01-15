const http = require('http');
const config = require('config');
const app = require('./src/lib/server');
const log = require('./src/lib/log');
const socket = require('./src/lib/socket');

const serviceHelper = require('./src/services/serviceHelper');

const databaseService = require('./src/services/databaseIndexCreationService');

const ratesService = require('./src/services/ratesService');

const networkFeesService = require('./src/services/networkFeesService');

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
