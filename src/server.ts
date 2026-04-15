import 'dotenv/config';
import { createApp } from './app';
import { logger } from './utils/logger';
import { initDb, closeDb } from './db/store';

const PORT = process.env.PORT || 3000;

// Fail fast if required env vars are missing
if (!process.env.SHOPIFY_WEBHOOK_SECRET) {
  logger.error({ event: 'startup_failed', message: 'SHOPIFY_WEBHOOK_SECRET is required' });
  process.exit(1);
}

function start() {
  initDb();
  const app = createApp();

  const server = app.listen(PORT, () => {
    logger.info({ event: 'startup', message: `Listening on port ${PORT}` });
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    logger.error({ event: 'listen_failed', error: err.message });
    process.exit(1);
  });

  // Graceful shutdown — close HTTP server then SQLite connection
  const shutdown = () => {
    logger.info({ event: 'shutdown', message: 'Received shutdown signal' });
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start();
