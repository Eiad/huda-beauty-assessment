import { Router, Request, Response } from 'express';
import { hmacVerify } from '../middleware/hmacVerify';
import { processOrderAsync } from '../services/webhookProcessor';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /webhooks/orders/paid
 *
 * Shopify sends orders/paid events here. We validate the HMAC, acknowledge
 * immediately with 200, then process asynchronously to avoid Shopify's
 * 5-second timeout.
 *
 * Idempotency: the store uses INSERT ... ON CONFLICT upsert so duplicate
 * deliveries of the same order ID are safe.
 */
router.post('/orders/paid', hmacVerify, (req: Request, res: Response) => {
  res.status(200).json({ received: true });

  const payload = req.body;
  logger.info({
    event: 'webhook_received',
    topic: 'orders/paid',
    orderId: payload.id,
  });

  // Fire-and-forget. processOrderAsync handles all errors internally
  // and is documented to never throw, so no .catch() is needed.
  void processOrderAsync(payload);
});

export default router;
