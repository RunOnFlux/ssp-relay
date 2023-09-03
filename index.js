const http = require('http');
const config = require('config');
const app = require('./src/lib/server');
const log = require('./src/lib/log');

const actionService = require('./src/services/actionService');

const serviceHelper = require('./src/services/serviceHelper');

const databaseService = require('./src/services/databaseIndexCreationService');
const socket = require('./src/lib/socket');

const server = http.createServer(app);

const io = socket.init(server);

io.on('connection', async (socket) => {
  socket.on('join', async ({ wkIdentity }) => {
    socket.join(wkIdentity);
    try {
      const data = await actionService.getAction(wkIdentity);
      if (data.action === 'tx') {
        io.to(data.wkIdentity).emit("tx", {tx: data});
      }
    } catch (error) {
     log.info(`no available action found for ${wkIdentity}`);
     log.error(error);
    }
  });

  socket.on('leave', ({ wkIdentity }) => {
    socket.leave(wkIdentity);
  });
});

log.info('Initiating database');
serviceHelper.initiateDB();

setTimeout(() => {
  log.info('Preparing indexes');
  databaseService.doIndexes(); // no waiting
}, 2000);

setTimeout(() => {
  log.info('Starting SSP Relay');
  server.listen(config.server.port, () => {
    log.info(`App listening on port ${config.server.port}`);
  });
}, 4000);
