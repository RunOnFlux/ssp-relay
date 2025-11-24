import { Server } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { MongoClient } from 'mongodb';
import log from './log';

interface ShutdownDependencies {
  httpServer?: Server;
  ioKey?: SocketIOServer;
  ioWallet?: SocketIOServer;
  dbConnection?: MongoClient;
}

const dependencies: ShutdownDependencies = {};
let isShuttingDown = false;

/**
 * Register dependencies for graceful shutdown
 */
export function registerShutdownDependency(
  name: keyof ShutdownDependencies,
  dependency: any,
) {
  dependencies[name] = dependency;
  log.debug(`Registered shutdown dependency: ${name}`);
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal: string) {
  if (isShuttingDown) {
    log.warn('Shutdown already in progress, ignoring signal');
    return;
  }

  isShuttingDown = true;
  log.info(`Received ${signal}, starting graceful shutdown`);

  const shutdownTimeout = setTimeout(() => {
    log.error('Graceful shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, 30000); // 30 second timeout

  try {
    // Close HTTP server (stop accepting new connections)
    if (dependencies.httpServer) {
      log.info('Closing HTTP server');
      await new Promise<void>((resolve, reject) => {
        dependencies.httpServer!.close((err) => {
          if (err) {
            log.error(err);
            reject(err);
          } else {
            log.info('HTTP server closed');
            resolve();
          }
        });
      });
    }

    // Close Socket.IO servers
    if (dependencies.ioKey) {
      log.info('Closing Socket.IO Key server');
      await new Promise<void>((resolve) => {
        dependencies.ioKey!.close(() => {
          log.info('Socket.IO Key server closed');
          resolve();
        });
      });
    }

    if (dependencies.ioWallet) {
      log.info('Closing Socket.IO Wallet server');
      await new Promise<void>((resolve) => {
        dependencies.ioWallet!.close(() => {
          log.info('Socket.IO Wallet server closed');
          resolve();
        });
      });
    }

    // Close database connection
    if (dependencies.dbConnection) {
      log.info('Closing database connection');
      await dependencies.dbConnection.close();
      log.info('Database connection closed');
    }

    clearTimeout(shutdownTimeout);
    log.info('Graceful shutdown completed successfully');
    process.exit(0);
  } catch (error) {
    clearTimeout(shutdownTimeout);
    log.error(error);
    process.exit(1);
  }
}

/**
 * Setup graceful shutdown handlers
 */
export function setupGracefulShutdown() {
  // Handle termination signals
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // Handle uncaught errors
  process.on('uncaughtException', (error) => {
    log.error(error);
    gracefulShutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    log.error(reason);
    gracefulShutdown('unhandledRejection');
  });

  log.info('Graceful shutdown handlers registered');
}

export default {
  registerShutdownDependency,
  setupGracefulShutdown,
};
