import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export function hmacVerify(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    logger.error({ event: 'hmac_config_missing', message: 'SHOPIFY_WEBHOOK_SECRET not set' });
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  const rawHeader = req.headers['x-shopify-hmac-sha256'];
  if (!rawHeader || typeof rawHeader !== 'string') {
    logger.warn({ event: 'hmac_missing_header' });
    return res.status(401).json({ error: 'Missing HMAC header' });
  }

  const shopifyHmac = rawHeader.trim();

  if (!Buffer.isBuffer(req.body)) {
    logger.warn({ event: 'hmac_body_not_buffer' });
    return res.status(400).json({ error: 'Expected raw body' });
  }

  const rawBody = req.body;
  const computedHmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  const sigBuffer = Buffer.from(shopifyHmac);
  const computedBuffer = Buffer.from(computedHmac);

  if (
    sigBuffer.length !== computedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, computedBuffer)
  ) {
    logger.warn({ event: 'hmac_invalid' });
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  try {
    req.body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logger.warn({ event: 'webhook_body_parse_failed' });
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  next();
}
