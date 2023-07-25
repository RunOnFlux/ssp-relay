const http = require('http');
const config = require('config');
const app = require('./src/lib/server');
const log = require('./src/lib/log');

const serviceHelper = require('./src/services/serviceHelper');

const databaseService = require('./src/services/databaseIndexCreationService');

const server = http.createServer(app);

log.info('Initiating database');
serviceHelper.initiateDB();

setTimeout(() => {
  log.info('Preparing indexes');
  databaseService.doSyncIndexes(); // no waiting
}, 2000);

setTimeout(() => {
  log.info('Starting SSP Relay');
  server.listen(config.server.port, () => {
    log.info(`App listening on port ${config.server.port}`);
  });
}, 4000);
