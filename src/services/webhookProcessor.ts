import { logger } from '../utils/logger';
import { upsertOrder, ParsedOrder } from '../db/store';
import { withRetry } from '../utils/retry';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseShopifyOrder(payload: any): ParsedOrder {
  if (!payload.id || !payload.email || !payload.total_price || !payload.currency) {
    throw new Error('Malformed order payload: missing required fields (id, email, total_price, currency)');
  }

  return {
    id: String(payload.id),
    customerEmail: payload.email,
    totalPrice: payload.total_price,
    currency: payload.currency,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    lineItems: (payload.line_items || []).map((item: any) => ({
      productId: String(item.product_id),
      variantId: String(item.variant_id),
      title: item.title,
      quantity: item.quantity,
      price: item.price,
    })),
    shippingAddress: payload.shipping_address || null,
    rawPayload: JSON.stringify(payload),
  };
}

/**
 * Process order asynchronously — called after 200 is sent to Shopify.
 *
 * Production note: in a real system this function would be triggered by a queue
 * worker (e.g. BullMQ backed by Redis, or AWS SQS). The webhook route would
 * enqueue the raw payload, acknowledge immediately, and this processor would
 * run in a separate worker process. This ensures Shopify's 5-second timeout
 * is never breached, failed jobs are retried via queue backoff, and processing
 * scales independently from the HTTP layer.
 *
 * This function intentionally swallows all errors after logging them — it must
 * never propagate exceptions back to the fire-and-forget caller in the route.
 */
export async function processOrderAsync(payload: unknown): Promise<void> {
  let parsed: ParsedOrder;

  try {
    parsed = parseShopifyOrder(payload);
  } catch (err) {
    logger.error({
      event: 'order_parse_failed',
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    await withRetry(
      async () => {
        upsertOrder(parsed);
      },
      { maxAttempts: 3, baseDelayMs: 200, label: `order_store:${parsed.id}` }
    );

    logger.info({
      event: 'order_stored',
      orderId: parsed.id,
      customerEmail: parsed.customerEmail,
      totalPrice: parsed.totalPrice,
      currency: parsed.currency,
    });
  } catch (err) {
    logger.error({
      event: 'order_store_failed_permanently',
      orderId: parsed.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
