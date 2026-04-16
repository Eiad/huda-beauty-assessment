import express, { Request, Response } from 'express';
import path from 'path';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import webhookRouter from './routes/webhook';
import gwpRouter from './routes/gwp';
import pricingRouter from './routes/pricing';

export function createApp() {
  const app = express();

  // Serve the demo dashboard
  app.use(express.static(path.join(process.cwd(), 'public')));

  // Raw body buffer needed for HMAC verification — must come before json().
  // express.raw() sets req._body = true after consuming the stream, so
  // express.json() that follows will skip these routes automatically.
  app.use('/webhooks', express.raw({ type: 'application/json', limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));

  app.use(requestLogger);

  app.use('/health', healthRouter);
  app.use('/webhooks', webhookRouter);
  app.use('/api/gwp', gwpRouter);
  app.use('/api/pricing', pricingRouter);

  // Catch-all 404 — must be after all route mounts, before errorHandler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: `Route not found` });
  });

  app.use(errorHandler);

  return app;
}
