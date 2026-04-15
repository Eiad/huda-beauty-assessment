import { logger } from './logger';

/**
 * Retries an async function with exponential backoff.
 *
 * For maxAttempts=3: attempt 1 → fail → wait 200ms → attempt 2 → fail → wait 400ms → attempt 3 → fail → dead-letter.
 * Total: 3 attempts, 2 delays (600ms).
 *
 * Note: this retries ALL errors including permanent ones (e.g. constraint violations).
 * In production, distinguish transient errors (connection timeout) from permanent ones
 * and only retry transient failures.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 200, label = 'operation' } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      const isLastAttempt = attempt === maxAttempts;
      if (isLastAttempt) {
        logger.error({
          event: 'dead_letter',
          label,
          attempt,
          error: errorMessage,
        });
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn({
        event: 'retry',
        label,
        attempt,
        nextDelayMs: delay,
        error: errorMessage,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error('Retry loop exhausted');
}
