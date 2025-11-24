import http from 'http';
import config from './config/default';
import app from './src/lib/server';
import log from './src/lib/log';
import socket from './src/lib/socket';
import { setupGracefulShutdown, registerShutdownDependency } from './src/lib/shutdown';

import serviceHelper from './src/services/serviceHelper';
import databaseService from './src/services/databaseIndexCreationService';
import ratesService from './src/services/ratesService';
import networkFeesService from './src/services/networkFeesService';

async function startServer() {
  try {
    log.info('Starting SSP Relay server');

    // Setup graceful shutdown handlers first
    setupGracefulShutdown();

    // Initialize database connection
    log.info('Connecting to database');
    await serviceHelper.initiateDB();
    const dbConnection = await serviceHelper.databaseConnection();
    registerShutdownDependency('dbConnection', dbConnection);
    log.info('Database connected successfully');

    // Create database indexes
    log.info('Creating database indexes');
    await databaseService.doIndexes();
    log.info('Database indexes created');

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize Socket.IO servers
    log.info('Initializing Socket.IO servers');
    const ioKey = socket.initIOKey(server);
    const ioWallet = socket.initIOWallet(server);
    registerShutdownDependency('ioKey', ioKey);
    registerShutdownDependency('ioWallet', ioWallet);
    log.info('Socket.IO servers initialized');

    // Initialize background services
    log.info('Initializing background services');
    ratesService.initRates();
    networkFeesService.fetchFees();
    log.info('Background services initialized');

    // Start HTTP server
    await new Promise<void>((resolve, reject) => {
      server.listen(config.server.port, () => {
        log.info(`SSP Relay started successfully on port ${config.server.port}`);
        resolve();
      });

      server.on('error', (error) => {
        log.error(error);
        reject(error);
      });
    });

    registerShutdownDependency('httpServer', server);

  } catch (error) {
    log.error(error);
    process.exit(1);
  }
}

// Start the server
startServer();
