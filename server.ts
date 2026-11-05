import { assertEnv, config } from './src/config.js';
import { getDb, closeDb } from './src/db.js';
import { createApp } from './src/app.js';
import { logger } from './src/utils/logger.js';

assertEnv();

// Open the database eagerly so boot fails loudly on a bad path or schema.
getDb();

const app = createApp();
const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info(`vula-erp listening on http://0.0.0.0:${config.port} (${config.nodeEnv})`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down...`);

  server.close(() => {
    try {
      closeDb();
      logger.info('Database closed cleanly.');
      process.exit(0);
    } catch (error) {
      logger.error('Error closing database', error);
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Forcing exit after shutdown timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
