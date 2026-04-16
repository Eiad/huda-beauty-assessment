# Huda Beauty Backend Assessment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Node.js/TypeScript backend service with a Shopify webhook receiver, GWP eligibility engine, multi-market pricing API, and structured logging layer.

**Architecture:** Single Express.js application with clearly separated route → service → data layers. Each domain (webhook, GWP, pricing) is a self-contained module with its own route file and service file. Cross-cutting concerns (logging, error handling, HMAC verification) live in shared middleware.

**Tech Stack:** Node.js 20 LTS, TypeScript 5, Express 4, better-sqlite3, Winston, Jest + Supertest

---

## File Map

| File | Responsibility |
|------|----------------|
| `src/app.ts` | Express app factory — registers middleware and routes |
| `src/server.ts` | HTTP server bootstrap, env validation, graceful shutdown |
| `src/utils/logger.ts` | Winston JSON logger singleton |
| `src/utils/retry.ts` | Exponential backoff retry utility |
| `src/middleware/requestLogger.ts` | Logs every inbound request and outbound response |
| `src/middleware/hmacVerify.ts` | Shopify HMAC-SHA256 signature validation |
| `src/middleware/errorHandler.ts` | Global error handler — classifies 4xx vs 5xx |
| `src/db/store.ts` | SQLite connection init, order upsert (idempotent), closeDb |
| `src/config/gwpRules.json` | Configurable GWP rules (no code change needed) |
| `src/config/marketPricing.json` | Mock product + pricing data for 4 markets |
| `src/routes/health.ts` | GET /health |
| `src/routes/webhook.ts` | POST /webhooks/orders/paid |
| `src/routes/gwp.ts` | POST /api/gwp/check |
| `src/routes/pricing.ts` | GET /api/pricing |
| `src/services/webhookProcessor.ts` | Order parsing, async storage, retry logic |
| `src/services/gwpEngine.ts` | GWP rule evaluation — threshold + product-specific |
| `src/services/pricingService.ts` | Market pricing lookup + discount calculation |
| `tsconfig.test.json` | TypeScript config for Jest (extends main tsconfig) |
| `tests/health.test.ts` | Integration tests for GET /health |
| `tests/webhook.test.ts` | Integration tests for POST /webhooks/orders/paid |
| `tests/gwp.test.ts` | Integration tests for POST /api/gwp/check |
| `tests/pricing.test.ts` | Integration tests for GET /api/pricing |
| `.env.example` | All required env vars documented |
| `README.md` | Architecture, run instructions, production notes |

---

## Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `tsconfig.test.json`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `src/server.ts`
- Create: `src/app.ts`

- [ ] **Step 1: Initialise project and install dependencies**

```bash
cd /Users/ash/Develop/Interview-projects/huda-beauty
npm init -y
npm install express better-sqlite3 winston dotenv
npm install --save-dev typescript ts-node nodemon @types/express @types/node @types/better-sqlite3 jest ts-jest @types/jest supertest @types/supertest
```

- [ ] **Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 3: Create tsconfig.test.json**

ts-jest needs a separate tsconfig because the main one has `"rootDir": "./src"` and test files live outside that in `tests/`. Without this, TypeScript throws `TS6059: File is not under rootDir`.

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "."
  },
  "include": ["src/**/*", "tests/**/*"]
}
```

- [ ] **Step 4: Update package.json scripts, main, and jest config**

Update the `main` field (npm init sets it to `index.js` which doesn't exist):
```json
"main": "dist/server.js"
```

Replace the `scripts` section with:
```json
"scripts": {
  "start": "node dist/server.js",
  "dev": "nodemon --ext ts,json --exec ts-node src/server.ts",
  "build": "tsc",
  "test": "jest --runInBand",
  "restart": "npm run build && npm start"
}
```

Add jest config alongside scripts:
```json
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "roots": ["<rootDir>/tests"],
  "globals": {
    "ts-jest": {
      "tsconfig": "./tsconfig.test.json"
    }
  }
}
```

- [ ] **Step 5: Create .env.example**

```
PORT=3000
SHOPIFY_WEBHOOK_SECRET=your_shared_secret_here
NODE_ENV=development
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
data/*.db
.env
```

- [ ] **Step 7: Create src/app.ts**

```typescript
import express, { Request, Response } from 'express';
import { requestLogger } from './middleware/requestLogger';
import { errorHandler } from './middleware/errorHandler';
import healthRouter from './routes/health';
import webhookRouter from './routes/webhook';
import gwpRouter from './routes/gwp';
import pricingRouter from './routes/pricing';

export function createApp() {
  const app = express();

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
```

- [ ] **Step 8: Create src/server.ts**

```typescript
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
```

**Note:** `src/app.ts` and `src/server.ts` import modules that do not exist yet (middleware, routes, utils, db). This is expected — those are created in subsequent tasks. Do NOT attempt to run the server until Task 5 when all modules are in place.

- [ ] **Step 9: Initialise git repo and commit**

```bash
git init
git add package.json package-lock.json tsconfig.json tsconfig.test.json .env.example .gitignore src/app.ts src/server.ts
git commit -m "feat: project scaffold with express + typescript"
```

---

## Task 2: Logger and Retry Utilities

**Files:**
- Create: `src/utils/logger.ts`
- Create: `src/utils/retry.ts`

- [ ] **Step 1: Create src/utils/logger.ts**

```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'huda-beauty-api' },
  transports: [new winston.transports.Console()],
});
```

- [ ] **Step 2: Create src/utils/retry.ts**

```typescript
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
```

- [ ] **Step 3: Commit**

```bash
git add src/utils/logger.ts src/utils/retry.ts
git commit -m "feat: add winston logger and exponential backoff retry utility"
```

---

## Task 3: Middleware — Request Logger, HMAC Verifier, Error Handler

**Files:**
- Create: `src/middleware/requestLogger.ts`
- Create: `src/middleware/hmacVerify.ts`
- Create: `src/middleware/errorHandler.ts`

- [ ] **Step 1: Create src/middleware/requestLogger.ts**

```typescript
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    logger.log(level, {
      event: 'http_request',
      method: req.method,
      path: req.originalUrl,
      ip: req.ip,
      statusCode: res.statusCode,
      durationMs: duration,
    });
  });
  next();
}
```

- [ ] **Step 2: Create src/middleware/hmacVerify.ts**

```typescript
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

  // Ensure express.raw() populated the body as a Buffer
  if (!Buffer.isBuffer(req.body)) {
    logger.warn({ event: 'hmac_body_not_buffer' });
    return res.status(400).json({ error: 'Expected raw body' });
  }

  const rawBody = req.body;
  const computedHmac = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');

  // crypto.timingSafeEqual throws RangeError if buffer lengths differ.
  // Check lengths first to avoid a crash on forged/malformed headers.
  const sigBuffer = Buffer.from(shopifyHmac);
  const computedBuffer = Buffer.from(computedHmac);

  if (
    sigBuffer.length !== computedBuffer.length ||
    !crypto.timingSafeEqual(sigBuffer, computedBuffer)
  ) {
    logger.warn({ event: 'hmac_invalid' });
    return res.status(401).json({ error: 'Invalid HMAC signature' });
  }

  // Parse the raw body into JSON for downstream handlers
  try {
    req.body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    logger.warn({ event: 'webhook_body_parse_failed' });
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  next();
}
```

- [ ] **Step 3: Create src/middleware/errorHandler.ts**

```typescript
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // If response was already partially sent, delegate to Express default handler
  if (res.headersSent) {
    return _next(err);
  }

  const statusCode = err instanceof AppError ? err.statusCode : 500;
  const isClientError = statusCode >= 400 && statusCode < 500;
  const errorMessage = err instanceof Error ? err.message : String(err);

  const logPayload = {
    event: 'unhandled_error',
    path: req.originalUrl,
    method: req.method,
    statusCode,
    error: errorMessage,
    ...(err instanceof AppError ? { context: err.context } : {}),
  };

  if (isClientError) {
    logger.warn(logPayload);
  } else {
    logger.error(logPayload);
  }

  res.status(statusCode).json({
    error: errorMessage,
    ...(err instanceof AppError && err.context ? { details: err.context } : {}),
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add src/middleware/
git commit -m "feat: add request logger, HMAC verifier, and error handler middleware"
```

---

## Task 4: SQLite Order Store

**Files:**
- Create: `src/db/store.ts`
- Create: `data/.gitkeep`

- [ ] **Step 1: Create data directory**

```bash
mkdir -p data
touch data/.gitkeep
```

- [ ] **Step 2: Create src/db/store.ts**

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../utils/logger';

let db: Database.Database;
let insertStmt: Database.Statement;

export function initDb() {
  const dbPath = path.join(process.cwd(), 'data', 'orders.db');
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      customer_email TEXT NOT NULL,
      total_price TEXT NOT NULL,
      currency TEXT NOT NULL,
      line_items TEXT NOT NULL,
      shipping_address TEXT,
      received_at TEXT NOT NULL,
      raw_payload TEXT NOT NULL
    )
  `);

  // Prepare once, reuse on every upsertOrder call (better-sqlite3 best practice)
  insertStmt = db.prepare(`
    INSERT INTO orders (id, customer_email, total_price, currency, line_items, shipping_address, received_at, raw_payload)
    VALUES (@id, @customerEmail, @totalPrice, @currency, @lineItems, @shippingAddress, @receivedAt, @rawPayload)
    ON CONFLICT(id) DO UPDATE SET
      customer_email = excluded.customer_email,
      total_price = excluded.total_price,
      raw_payload = excluded.raw_payload
  `);

  logger.info({ event: 'db_init', message: 'SQLite database initialised' });
}

export function closeDb() {
  if (db) db.close();
}

export interface ParsedOrder {
  id: string;
  customerEmail: string;
  totalPrice: string;
  currency: string;
  lineItems: Array<{ productId: string; variantId: string; title: string; quantity: number; price: string }>;
  shippingAddress: Record<string, unknown> | null;
  rawPayload: string;
}

/**
 * Upserts an order — idempotent by Shopify order ID.
 * Duplicate webhook deliveries overwrite with the same data (no-op in effect).
 */
export function upsertOrder(order: ParsedOrder): void {
  insertStmt.run({
    id: order.id,
    customerEmail: order.customerEmail,
    totalPrice: order.totalPrice,
    currency: order.currency,
    lineItems: JSON.stringify(order.lineItems),
    shippingAddress: order.shippingAddress ? JSON.stringify(order.shippingAddress) : null,
    receivedAt: new Date().toISOString(),
    rawPayload: order.rawPayload,
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/db/store.ts data/.gitkeep
git commit -m "feat: SQLite order store with idempotent upsert"
```

---

## Task 5: Health Endpoint + First Live Verification

**Files:**
- Create: `src/routes/health.ts`
- Create: `src/routes/webhook.ts` (stub)
- Create: `src/routes/gwp.ts` (stub)
- Create: `src/routes/pricing.ts` (stub)

This is the last missing piece. After this task the server can boot for the first time.

- [ ] **Step 1: Create src/routes/health.ts**

```typescript
import { Router } from 'express';

const router = Router();

const startTime = Date.now();

router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'huda-beauty-api',
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

export default router;
```

- [ ] **Step 2: Create stub route files so all imports in app.ts resolve**

**src/routes/webhook.ts** (stub):
```typescript
import { Router } from 'express';
const router = Router();
export default router;
```

**src/routes/gwp.ts** (stub):
```typescript
import { Router } from 'express';
const router = Router();
export default router;
```

**src/routes/pricing.ts** (stub):
```typescript
import { Router } from 'express';
const router = Router();
export default router;
```

- [ ] **Step 3: Start server and verify /health**

```bash
export SHOPIFY_WEBHOOK_SECRET=dev_secret
npx ts-node src/server.ts &
sleep 1
curl -s http://localhost:3000/health | jq .
```

Expected:
```json
{ "status": "ok", "service": "huda-beauty-api", "uptimeSeconds": 0, "timestamp": "..." }
```

```bash
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add src/routes/health.ts src/routes/webhook.ts src/routes/gwp.ts src/routes/pricing.ts
git commit -m "feat: add /health endpoint and route stubs — server boots for the first time"
```

---

## Task 6: Shopify Webhook Receiver

**Files:**
- Create: `src/services/webhookProcessor.ts`
- Modify: `src/routes/webhook.ts` (replace stub)

- [ ] **Step 1: Create src/services/webhookProcessor.ts**

```typescript
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
```

- [ ] **Step 2: Replace src/routes/webhook.ts stub with full implementation**

```typescript
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
```

- [ ] **Step 3: Test webhook with a mock payload**

```bash
export SHOPIFY_WEBHOOK_SECRET=test_secret

PAYLOAD='{"id":12345678,"email":"customer@example.com","total_price":"320.00","currency":"AED","line_items":[{"product_id":9001,"variant_id":1001,"title":"Nude Obsessions Lipstick - Sand","quantity":2,"price":"160.00"}],"shipping_address":{"address1":"123 JBR","city":"Dubai","country":"AE"}}'

HMAC=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "test_secret" -binary | openssl base64 -A)

npx ts-node src/server.ts &
sleep 1
curl -s -X POST http://localhost:3000/webhooks/orders/paid \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-Sha256: $HMAC" \
  -d "$PAYLOAD"
```

Expected response: `{"received":true}`
Expected server log: `"event":"order_stored"` with orderId 12345678.

- [ ] **Step 4: Test invalid HMAC is rejected (not crashed)**

```bash
curl -s -X POST http://localhost:3000/webhooks/orders/paid \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-Sha256: notavalidhmac" \
  -d "$PAYLOAD"
```

Expected: `{"error":"Invalid HMAC signature"}` with status 401 (not 500).

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add src/services/webhookProcessor.ts src/routes/webhook.ts
git commit -m "feat: shopify webhook receiver with HMAC validation, async processing, and retry"
```

---

## Task 7: GWP Config and Eligibility Engine

**Files:**
- Create: `src/config/gwpRules.json`
- Create: `src/services/gwpEngine.ts`
- Modify: `src/routes/gwp.ts` (replace stub)

- [ ] **Step 1: Create src/config/gwpRules.json**

```json
[
  {
    "id": "rule_cart_threshold_aed",
    "type": "cart_threshold",
    "label": "Spend AED 260 to unlock a free Lash & Blow Mascara",
    "currency": "AED",
    "threshold": 260,
    "gift": {
      "productId": "gift-mascara-001",
      "title": "Lash & Blow Mascara (Free Gift)",
      "variantId": "gift-mascara-001-v1"
    },
    "enabled": true
  },
  {
    "id": "rule_lashes_collection",
    "type": "product_collection",
    "label": "Buy any Lashes product to unlock a free Lash Glue",
    "collectionTag": "lashes",
    "gift": {
      "productId": "gift-lash-glue-001",
      "title": "Lash Glue (Free Gift)",
      "variantId": "gift-lash-glue-001-v1"
    },
    "enabled": true
  }
]
```

- [ ] **Step 2: Create src/services/gwpEngine.ts**

```typescript
import gwpRules from '../config/gwpRules.json';

export interface CartLineItem {
  productId: string;
  variantId: string;
  title: string;
  quantity: number;
  price: string;
  /**
   * Product tags (e.g. ["lashes", "bestseller"]).
   *
   * Important: Shopify's native cart object does NOT include product tags on line items.
   * In production, the calling code (storefront JS or Shopify Function) must enrich
   * line items with tags from a separate product query before calling this endpoint.
   */
  tags?: string[];
}

export interface CartPayload {
  currency: string;
  lineItems: CartLineItem[];
}

interface GiftItem {
  productId: string;
  title: string;
  variantId: string;
}

export interface GwpResult {
  unlocked: boolean;
  gifts: GiftItem[];
  amountNeeded: number | null;
  currency: string;
  appliedRules: string[];
  message: string;
}

type GwpRule = {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  gift: GiftItem;
  currency?: string;
  threshold?: number;
  collectionTag?: string;
};

function cartTotal(lineItems: CartLineItem[]): number {
  return lineItems.reduce((sum, item) => {
    return sum + parseFloat(item.price) * item.quantity;
  }, 0);
}

function evaluateThresholdRule(
  rule: GwpRule & { threshold: number; currency: string },
  cart: CartPayload
) {
  // Threshold rules are currency-scoped. A USD cart cannot trigger an AED rule.
  if (cart.currency !== rule.currency) return null;
  const total = cartTotal(cart.lineItems);
  if (total >= rule.threshold) {
    return { unlocked: true, amountNeeded: 0, gift: rule.gift };
  }
  return {
    unlocked: false,
    amountNeeded: parseFloat((rule.threshold - total).toFixed(2)),
    gift: null,
  };
}

function evaluateCollectionRule(
  rule: GwpRule & { collectionTag: string },
  cart: CartPayload
) {
  // Collection rules apply regardless of currency — buying lashes unlocks a gift
  // in any market. Add a `currency` field to the rule config if market-scoping is needed.
  const hasCollectionItem = cart.lineItems.some(
    (item) => item.tags && item.tags.includes(rule.collectionTag)
  );
  return {
    unlocked: hasCollectionItem,
    gift: hasCollectionItem ? rule.gift : null,
  };
}

export function evaluateGwp(cart: CartPayload): GwpResult {
  if (!cart.lineItems || cart.lineItems.length === 0) {
    return {
      unlocked: false,
      gifts: [],
      amountNeeded: null,
      currency: cart.currency,
      appliedRules: [],
      message: 'Cart is empty.',
    };
  }

  const activeRules = (gwpRules as GwpRule[]).filter((r) => r.enabled);
  const unlockedGifts: GiftItem[] = [];
  const appliedRules: string[] = [];
  let minAmountNeeded: number | null = null;

  for (const rule of activeRules) {
    if (rule.type === 'cart_threshold' && rule.threshold !== undefined && rule.currency !== undefined) {
      const result = evaluateThresholdRule(
        rule as GwpRule & { threshold: number; currency: string },
        cart
      );
      if (result) {
        if (result.unlocked && result.gift) {
          unlockedGifts.push(result.gift);
          appliedRules.push(rule.id);
        } else if (!result.unlocked && result.amountNeeded !== null) {
          if (minAmountNeeded === null || result.amountNeeded < minAmountNeeded) {
            minAmountNeeded = result.amountNeeded;
          }
        }
      }
    } else if (rule.type === 'product_collection' && rule.collectionTag !== undefined) {
      const result = evaluateCollectionRule(
        rule as GwpRule & { collectionTag: string },
        cart
      );
      if (result.unlocked && result.gift) {
        unlockedGifts.push(result.gift);
        appliedRules.push(rule.id);
      }
    }
  }

  const unlocked = unlockedGifts.length > 0;
  return {
    unlocked,
    gifts: unlockedGifts,
    amountNeeded: unlocked ? null : minAmountNeeded,
    currency: cart.currency,
    appliedRules,
    message: unlocked
      ? `Congratulations! You've unlocked ${unlockedGifts.length} free gift(s).`
      : minAmountNeeded !== null
      ? `Spend ${cart.currency} ${minAmountNeeded.toFixed(2)} more to unlock a free gift.`
      : 'No active GWP promotions apply to your cart.',
  };
}
```

- [ ] **Step 3: Replace src/routes/gwp.ts stub with full implementation**

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { evaluateGwp } from '../services/gwpEngine';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/gwp/check
 *
 * Body: { currency: string, lineItems: Array<{ productId, variantId, title, quantity, price, tags? }> }
 *
 * Production note: this endpoint would be called by Shopify Functions (via
 * an App Proxy or a custom cart transformer) at checkout time, or from the
 * storefront JS to show a GWP progress bar in the cart drawer.
 *
 * For region-specific GWP rules, gwpRules.json supports a `currency` field
 * on threshold rules to target a market (AED for UAE, USD for US, GBP for UK).
 * The engine filters threshold rules by currency, so adding new market rules
 * requires only a JSON config update — no code change.
 * Collection rules (product tag-based) apply globally unless you add a
 * `currency` scope to the rule schema and evaluator.
 */
router.post('/check', (req: Request, res: Response, next: NextFunction) => {
  const { currency, lineItems } = req.body;

  if (!currency || typeof currency !== 'string') {
    return next(new AppError(400, 'Request body must contain currency (string)'));
  }
  if (!Array.isArray(lineItems)) {
    return next(new AppError(400, 'Request body must contain lineItems (array)'));
  }

  // Validate individual items have required fields
  for (let i = 0; i < lineItems.length; i++) {
    const item = lineItems[i];
    if (!item || typeof item.price !== 'string' || typeof item.quantity !== 'number') {
      return next(new AppError(400, `lineItems[${i}] must have a string "price" and numeric "quantity"`));
    }
  }

  const result = evaluateGwp({ currency, lineItems });

  logger.info({
    event: 'gwp_evaluated',
    currency,
    cartItemCount: lineItems.length,
    unlocked: result.unlocked,
    appliedRules: result.appliedRules,
  });

  res.json(result);
});

export default router;
```

- [ ] **Step 4: Test the GWP endpoint**

```bash
export SHOPIFY_WEBHOOK_SECRET=test_secret
npx ts-node src/server.ts &
sleep 1

# Test 1: Cart below threshold (AED 200, no lashes)
curl -s -X POST http://localhost:3000/api/gwp/check \
  -H "Content-Type: application/json" \
  -d '{"currency":"AED","lineItems":[{"productId":"prod-001","variantId":"v1","title":"Lipstick","quantity":1,"price":"200.00","tags":["lipstick"]}]}' | jq .
# Expected: unlocked=false, amountNeeded=60.00

# Test 2: Cart at exactly threshold (AED 260)
curl -s -X POST http://localhost:3000/api/gwp/check \
  -H "Content-Type: application/json" \
  -d '{"currency":"AED","lineItems":[{"productId":"prod-001","variantId":"v1","title":"Lipstick","quantity":1,"price":"260.00","tags":["lipstick"]}]}' | jq .
# Expected: unlocked=true, gifts contains mascara

# Test 3: Cart with lashes item (product rule triggered)
curl -s -X POST http://localhost:3000/api/gwp/check \
  -H "Content-Type: application/json" \
  -d '{"currency":"AED","lineItems":[{"productId":"lash-001","variantId":"v1","title":"Faux Mink Lashes","quantity":1,"price":"89.00","tags":["lashes"]}]}' | jq .
# Expected: unlocked=true, gifts contains lash glue

# Test 4: Both rules active simultaneously
curl -s -X POST http://localhost:3000/api/gwp/check \
  -H "Content-Type: application/json" \
  -d '{"currency":"AED","lineItems":[{"productId":"lash-001","variantId":"v1","title":"Faux Mink Lashes","quantity":2,"price":"160.00","tags":["lashes"]},{"productId":"prod-001","variantId":"v2","title":"Nude Lipstick","quantity":1,"price":"120.00","tags":["lipstick"]}]}' | jq .
# Expected: unlocked=true, gifts contains BOTH mascara and lash glue

# Test 5: USD cart — AED threshold rule must NOT apply
curl -s -X POST http://localhost:3000/api/gwp/check \
  -H "Content-Type: application/json" \
  -d '{"currency":"USD","lineItems":[{"productId":"prod-001","variantId":"v1","title":"Lipstick","quantity":1,"price":"300.00","tags":["lipstick"]}]}' | jq .
# Expected: unlocked=false (AED threshold rule skipped; no lashes tag)
```

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add src/config/gwpRules.json src/services/gwpEngine.ts src/routes/gwp.ts
git commit -m "feat: GWP eligibility engine with configurable threshold and collection rules"
```

---

## Task 8: Multi-Market Pricing API

**Files:**
- Create: `src/config/marketPricing.json`
- Create: `src/services/pricingService.ts`
- Modify: `src/routes/pricing.ts` (replace stub)

- [ ] **Step 1: Create src/config/marketPricing.json**

```json
{
  "products": {
    "nude-obsessions-mini": {
      "title": "Nude Obsessions Reloaded Lipstick Mini",
      "markets": {
        "en-AE": {
          "currency": "AED",
          "basePrice": 89.00,
          "discount": { "type": "percentage", "value": 15 },
          "freeShippingThreshold": 260
        },
        "en-US": {
          "currency": "USD",
          "basePrice": 24.00,
          "discount": null,
          "freeShippingThreshold": 50
        },
        "en-GB": {
          "currency": "GBP",
          "basePrice": 19.00,
          "discount": { "type": "fixed", "value": 2 },
          "freeShippingThreshold": 40
        },
        "en-SA": {
          "currency": "SAR",
          "basePrice": 90.00,
          "discount": { "type": "percentage", "value": 10 },
          "freeShippingThreshold": 260
        }
      }
    },
    "nude-obsessions-full": {
      "title": "Nude Obsessions Reloaded Lipstick Full Size",
      "markets": {
        "en-AE": {
          "currency": "AED",
          "basePrice": 160.00,
          "discount": { "type": "percentage", "value": 10 },
          "freeShippingThreshold": 260
        },
        "en-US": {
          "currency": "USD",
          "basePrice": 44.00,
          "discount": null,
          "freeShippingThreshold": 50
        },
        "en-GB": {
          "currency": "GBP",
          "basePrice": 35.00,
          "discount": null,
          "freeShippingThreshold": 40
        },
        "en-SA": {
          "currency": "SAR",
          "basePrice": 165.00,
          "discount": { "type": "percentage", "value": 10 },
          "freeShippingThreshold": 260
        }
      }
    },
    "faux-mink-lashes": {
      "title": "Huda Beauty Faux Mink Lashes",
      "markets": {
        "en-AE": {
          "currency": "AED",
          "basePrice": 129.00,
          "discount": null,
          "freeShippingThreshold": 260
        },
        "en-US": {
          "currency": "USD",
          "basePrice": 35.00,
          "discount": { "type": "fixed", "value": 5 },
          "freeShippingThreshold": 50
        },
        "en-GB": {
          "currency": "GBP",
          "basePrice": 28.00,
          "discount": null,
          "freeShippingThreshold": 40
        },
        "en-SA": {
          "currency": "SAR",
          "basePrice": 130.00,
          "discount": null,
          "freeShippingThreshold": 260
        }
      }
    }
  }
}
```

- [ ] **Step 2: Create src/services/pricingService.ts**

```typescript
import catalog from '../config/marketPricing.json';
import { AppError } from '../middleware/errorHandler';

interface DiscountConfig {
  type: 'percentage' | 'fixed';
  value: number;
}

interface MarketConfig {
  currency: string;
  basePrice: number;
  discount: DiscountConfig | null;
  freeShippingThreshold: number;
}

interface PricingResponse {
  productId: string;
  productTitle: string;
  market: string;
  currency: string;
  basePrice: number;
  discountType: string | null;
  discountValue: number | null;
  discountAmount: number;
  finalPrice: number;
  meetsShippingThreshold: boolean;
  freeShippingThreshold: number;
}

// Derive supported markets from the catalog at module load time —
// single source of truth, stays in sync if products are added/removed.
const products = catalog.products as Record<string, { title: string; markets: Record<string, MarketConfig> }>;
const SUPPORTED_MARKETS = [...new Set(
  Object.values(products).flatMap((p) => Object.keys(p.markets))
)];

/**
 * Production integration note:
 * In production this service would query Shopify's Storefront API using
 * `presentmentPrices` on the `ProductVariant` type, passing the `@inContext`
 * directive with `country` and `language`. Shopify Markets handles the
 * currency conversion and market-specific price overrides. This mock
 * replicates that data shape so the storefront response format is identical.
 *
 * Endpoint: POST https://{shop}.myshopify.com/api/2024-10/graphql.json
 * Header: X-Shopify-Storefront-Access-Token
 */
export function getMarketPricing(productId: string, market: string): PricingResponse {
  if (!SUPPORTED_MARKETS.includes(market)) {
    throw new AppError(400, `Unsupported market: ${market}. Supported markets: ${SUPPORTED_MARKETS.join(', ')}`);
  }

  const product = products[productId];
  if (!product) {
    throw new AppError(404, `Product not found: ${productId}`);
  }

  const marketData = product.markets[market];
  if (!marketData) {
    throw new AppError(404, `Product ${productId} is not available in market ${market}`);
  }

  let discountAmount = 0;
  let discountType: string | null = null;
  let discountValue: number | null = null;

  if (marketData.discount) {
    discountType = marketData.discount.type;
    discountValue = marketData.discount.value;
    if (marketData.discount.type === 'percentage') {
      discountAmount = parseFloat((marketData.basePrice * (marketData.discount.value / 100)).toFixed(2));
    } else {
      discountAmount = marketData.discount.value;
    }
  }

  const finalPrice = parseFloat(Math.max(0, marketData.basePrice - discountAmount).toFixed(2));

  return {
    productId,
    productTitle: product.title,
    market,
    currency: marketData.currency,
    basePrice: marketData.basePrice,
    discountType,
    discountValue,
    discountAmount,
    finalPrice,
    meetsShippingThreshold: finalPrice >= marketData.freeShippingThreshold,
    freeShippingThreshold: marketData.freeShippingThreshold,
  };
}
```

- [ ] **Step 3: Replace src/routes/pricing.ts stub with full implementation**

```typescript
import { Router, Request, Response, NextFunction } from 'express';
import { getMarketPricing } from '../services/pricingService';
import { AppError } from '../middleware/errorHandler';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/pricing?productId=<id>&market=<locale>
 *
 * Returns market-specific pricing and active discount for a product.
 *
 * Example: GET /api/pricing?productId=nude-obsessions-full&market=en-AE
 */
router.get('/', (req: Request, res: Response, next: NextFunction) => {
  const { productId, market } = req.query;

  if (!productId || typeof productId !== 'string') {
    return next(new AppError(400, 'Query parameter "productId" is required'));
  }
  if (!market || typeof market !== 'string') {
    return next(new AppError(400, 'Query parameter "market" is required (e.g. en-AE, en-US, en-GB, en-SA)'));
  }

  try {
    const pricing = getMarketPricing(productId, market);

    logger.info({
      event: 'pricing_requested',
      productId,
      market,
      finalPrice: pricing.finalPrice,
      currency: pricing.currency,
    });

    res.json(pricing);
  } catch (err) {
    next(err);
  }
});

export default router;
```

- [ ] **Step 4: Test pricing endpoint**

```bash
export SHOPIFY_WEBHOOK_SECRET=test_secret
npx ts-node src/server.ts &
sleep 1

# Test 1: Valid product + AE market (percentage discount)
curl -s "http://localhost:3000/api/pricing?productId=nude-obsessions-full&market=en-AE" | jq .
# Expected: AED 160 base, 10% discount = 16 AED off, finalPrice=144.00

# Test 2: US market — no discount
curl -s "http://localhost:3000/api/pricing?productId=nude-obsessions-full&market=en-US" | jq .
# Expected: USD 44, discountAmount=0, finalPrice=44.00

# Test 3: Unknown market returns structured 400
curl -s "http://localhost:3000/api/pricing?productId=nude-obsessions-full&market=en-FR" | jq .
# Expected: {"error":"Unsupported market: en-FR..."} status 400

# Test 4: Unknown product returns structured 404
curl -s "http://localhost:3000/api/pricing?productId=ghost-product&market=en-AE" | jq .
# Expected: {"error":"Product not found: ghost-product"} status 404

# Test 5: Missing params return structured 400
curl -s "http://localhost:3000/api/pricing" | jq .
# Expected: {"error":"Query parameter \"productId\" is required"} status 400
```

```bash
kill %1
```

- [ ] **Step 5: Commit**

```bash
git add src/config/marketPricing.json src/services/pricingService.ts src/routes/pricing.ts
git commit -m "feat: multi-market pricing API with discount calculation for AE/US/GB/SA"
```

---

## Task 9: End-to-End Integration Tests (All Endpoints)

Full Supertest-based integration tests for every endpoint. Each test makes real HTTP requests through the full Express stack (middleware → route → service → DB) and verifies the actual response body, status codes, and side effects.

**Files:**
- Create: `tests/health.test.ts`
- Create: `tests/webhook.test.ts`
- Create: `tests/gwp.test.ts`
- Create: `tests/pricing.test.ts`

- [ ] **Step 1: Create tests/health.test.ts**

```typescript
import request from 'supertest';
import { createApp } from '../src/app';
import { initDb, closeDb } from '../src/db/store';

const app = createApp();

beforeAll(() => { initDb(); });
afterAll(() => { closeDb(); });

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('huda-beauty-api');
    expect(typeof res.body.uptimeSeconds).toBe('number');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('404 handler', () => {
  it('returns JSON 404 for unknown routes', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});
```

- [ ] **Step 2: Create tests/webhook.test.ts**

```typescript
import request from 'supertest';
import crypto from 'crypto';
import { createApp } from '../src/app';
import { initDb, closeDb } from '../src/db/store';
import Database from 'better-sqlite3';
import path from 'path';

const TEST_SECRET = 'test_webhook_secret';
const app = createApp();

function signPayload(payload: string): string {
  return crypto.createHmac('sha256', TEST_SECRET).update(payload).digest('base64');
}

const validOrder = {
  id: 99001,
  email: 'test@hudabeauty.com',
  total_price: '320.00',
  currency: 'AED',
  line_items: [
    { product_id: 9001, variant_id: 1001, title: 'Nude Obsessions Lipstick', quantity: 2, price: '160.00' },
  ],
  shipping_address: { address1: '123 JBR', city: 'Dubai', country: 'AE' },
};

beforeAll(() => {
  process.env.SHOPIFY_WEBHOOK_SECRET = TEST_SECRET;
  initDb();
});
afterAll(() => { closeDb(); });

function queryOrder(orderId: string) {
  const db = new Database(path.join(process.cwd(), 'data', 'orders.db'));
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  db.close();
  return row;
}

describe('POST /webhooks/orders/paid', () => {
  it('accepts valid HMAC and returns 200', async () => {
    const body = JSON.stringify(validOrder);
    const hmac = signPayload(body);

    const res = await request(app)
      .post('/webhooks/orders/paid')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(Buffer.from(body));

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('stores the order in SQLite after processing', async () => {
    // Give async processing a moment to complete
    await new Promise((r) => setTimeout(r, 500));
    const row = queryOrder('99001') as any;
    expect(row).toBeDefined();
    expect(row.customer_email).toBe('test@hudabeauty.com');
    expect(row.total_price).toBe('320.00');
    expect(row.currency).toBe('AED');
  });

  it('is idempotent — sending the same order twice produces only one row', async () => {
    const body = JSON.stringify(validOrder);
    const hmac = signPayload(body);

    await request(app)
      .post('/webhooks/orders/paid')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Hmac-Sha256', hmac)
      .send(Buffer.from(body));

    await new Promise((r) => setTimeout(r, 500));

    const db = new Database(path.join(process.cwd(), 'data', 'orders.db'));
    const count = db.prepare('SELECT COUNT(*) as cnt FROM orders WHERE id = ?').get('99001') as any;
    db.close();
    expect(count.cnt).toBe(1);
  });

  it('rejects requests with invalid HMAC — returns 401', async () => {
    const body = JSON.stringify(validOrder);

    const res = await request(app)
      .post('/webhooks/orders/paid')
      .set('Content-Type', 'application/json')
      .set('X-Shopify-Hmac-Sha256', 'forged-signature')
      .send(Buffer.from(body));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid hmac/i);
  });

  it('rejects requests with missing HMAC header — returns 401', async () => {
    const body = JSON.stringify(validOrder);

    const res = await request(app)
      .post('/webhooks/orders/paid')
      .set('Content-Type', 'application/json')
      .send(Buffer.from(body));

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing hmac/i);
  });
});
```

- [ ] **Step 3: Create tests/gwp.test.ts**

```typescript
import request from 'supertest';
import { createApp } from '../src/app';
import { initDb, closeDb } from '../src/db/store';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_WEBHOOK_SECRET = 'test';
  initDb();
});
afterAll(() => { closeDb(); });

describe('POST /api/gwp/check', () => {
  // --- Threshold rule ---
  it('returns unlocked=false when cart is below AED 260 threshold', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({
        currency: 'AED',
        lineItems: [{ productId: 'p1', variantId: 'v1', title: 'Lipstick', quantity: 1, price: '200.00', tags: ['lipstick'] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(false);
    expect(res.body.amountNeeded).toBeCloseTo(60, 0);
    expect(res.body.gifts).toHaveLength(0);
    expect(res.body.message).toMatch(/spend.*60/i);
  });

  it('returns unlocked=true when cart exactly meets AED 260 threshold', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({
        currency: 'AED',
        lineItems: [{ productId: 'p1', variantId: 'v1', title: 'Lipstick', quantity: 1, price: '260.00', tags: [] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(true);
    expect(res.body.gifts.some((g: any) => g.productId === 'gift-mascara-001')).toBe(true);
  });

  it('does NOT apply AED threshold rule for USD cart', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({
        currency: 'USD',
        lineItems: [{ productId: 'p1', variantId: 'v1', title: 'Lipstick', quantity: 1, price: '500.00', tags: [] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(false);
    expect(res.body.gifts).toHaveLength(0);
  });

  // --- Collection rule ---
  it('returns unlocked=true when cart contains a lashes-tagged item', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({
        currency: 'AED',
        lineItems: [{ productId: 'lash-001', variantId: 'v1', title: 'Faux Mink Lashes', quantity: 1, price: '89.00', tags: ['lashes'] }],
      });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(true);
    expect(res.body.gifts.some((g: any) => g.productId === 'gift-lash-glue-001')).toBe(true);
  });

  // --- Both rules simultaneously ---
  it('unlocks both gifts when both rules are satisfied', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({
        currency: 'AED',
        lineItems: [
          { productId: 'lash-001', variantId: 'v1', title: 'Faux Mink Lashes', quantity: 2, price: '160.00', tags: ['lashes'] },
          { productId: 'p1', variantId: 'v2', title: 'Nude Lipstick', quantity: 1, price: '120.00', tags: ['lipstick'] },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(true);
    expect(res.body.gifts).toHaveLength(2);
    expect(res.body.gifts.some((g: any) => g.productId === 'gift-mascara-001')).toBe(true);
    expect(res.body.gifts.some((g: any) => g.productId === 'gift-lash-glue-001')).toBe(true);
  });

  // --- Edge cases ---
  it('returns unlocked=false for an empty cart', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({ currency: 'AED', lineItems: [] });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(false);
    expect(res.body.message).toMatch(/empty/i);
  });

  // --- Validation ---
  it('returns 400 when currency is missing', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({ lineItems: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/currency/i);
  });

  it('returns 400 when lineItems is not an array', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({ currency: 'AED', lineItems: 'invalid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lineItems/i);
  });

  it('returns 400 when a lineItem is missing price', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({
        currency: 'AED',
        lineItems: [{ productId: 'p1', variantId: 'v1', title: 'Lipstick', quantity: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/price/i);
  });
});
```

- [ ] **Step 4: Create tests/pricing.test.ts**

```typescript
import request from 'supertest';
import { createApp } from '../src/app';
import { initDb, closeDb } from '../src/db/store';

const app = createApp();

beforeAll(() => {
  process.env.SHOPIFY_WEBHOOK_SECRET = 'test';
  initDb();
});
afterAll(() => { closeDb(); });

describe('GET /api/pricing', () => {
  // --- Percentage discount (en-AE, nude-obsessions-full: 10% off 160 AED) ---
  it('returns correct percentage discount for en-AE', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full&market=en-AE');

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('AED');
    expect(res.body.basePrice).toBe(160);
    expect(res.body.discountType).toBe('percentage');
    expect(res.body.discountValue).toBe(10);
    expect(res.body.discountAmount).toBe(16);
    expect(res.body.finalPrice).toBe(144);
    expect(res.body.meetsShippingThreshold).toBe(false); // 144 < 260
    expect(res.body.freeShippingThreshold).toBe(260);
  });

  // --- No discount (en-US, nude-obsessions-full) ---
  it('returns no discount for en-US', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full&market=en-US');

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
    expect(res.body.basePrice).toBe(44);
    expect(res.body.discountType).toBeNull();
    expect(res.body.discountValue).toBeNull();
    expect(res.body.discountAmount).toBe(0);
    expect(res.body.finalPrice).toBe(44);
    expect(res.body.meetsShippingThreshold).toBe(false); // 44 < 50
  });

  // --- Fixed discount (en-GB, nude-obsessions-mini: £2 off £19) ---
  it('returns correct fixed discount for en-GB', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-mini&market=en-GB');

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('GBP');
    expect(res.body.basePrice).toBe(19);
    expect(res.body.discountType).toBe('fixed');
    expect(res.body.discountValue).toBe(2);
    expect(res.body.discountAmount).toBe(2);
    expect(res.body.finalPrice).toBe(17);
  });

  // --- SAR market ---
  it('returns correct pricing for en-SA', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full&market=en-SA');

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('SAR');
    expect(res.body.basePrice).toBe(165);
    expect(res.body.discountType).toBe('percentage');
    expect(res.body.discountValue).toBe(10);
    expect(res.body.finalPrice).toBe(148.5);
  });

  // --- Product info in response ---
  it('includes productId and productTitle in response', async () => {
    const res = await request(app).get('/api/pricing?productId=faux-mink-lashes&market=en-AE');

    expect(res.status).toBe(200);
    expect(res.body.productId).toBe('faux-mink-lashes');
    expect(res.body.productTitle).toBe('Huda Beauty Faux Mink Lashes');
    expect(res.body.market).toBe('en-AE');
  });

  // --- Validation: unknown market ---
  it('returns 400 for unsupported market', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full&market=en-FR');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported market/i);
  });

  // --- Validation: unknown product ---
  it('returns 404 for unknown product', async () => {
    const res = await request(app).get('/api/pricing?productId=ghost-product&market=en-AE');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/product not found/i);
  });

  // --- Validation: missing params ---
  it('returns 400 when productId is missing', async () => {
    const res = await request(app).get('/api/pricing?market=en-AE');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/productId/i);
  });

  it('returns 400 when market is missing', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/market/i);
  });
});
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```

Expected: All tests pass across 4 test files:
- `health.test.ts` — 2 tests (health endpoint, 404 handler)
- `webhook.test.ts` — 5 tests (valid HMAC, DB verification, idempotency, invalid HMAC, missing HMAC)
- `gwp.test.ts` — 9 tests (threshold below/at/USD, collection, both rules, empty cart, missing currency, missing lineItems, malformed item)
- `pricing.test.ts` — 9 tests (AE percentage, US no discount, GB fixed, SA market, product info, unknown market, unknown product, missing productId, missing market)

Total: **25 integration tests**

- [ ] **Step 6: Commit**

```bash
git add tests/
git commit -m "test: comprehensive supertest integration tests for all 4 endpoints (25 tests)"
```

---

## Task 10: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Create README.md**

Write the full README. Every section must be complete — no placeholders.

Required sections and their content:

**1. Overview** — what this service is, which campaign it supports ("Nude Obsessions Reloaded"), the 4 endpoints

**2. Quick Start**
```bash
npm install
cp .env.example .env   # set SHOPIFY_WEBHOOK_SECRET
npm run dev             # starts on port 3000

npm test                # run integration tests
```

**3. API Reference** — for each of the 4 endpoints: method, path, description, example request, example response

**4. Architecture Overview** — describe the three-layer structure (route → service → data), shared middleware (logger, HMAC, errorHandler), JSON config files for rule changes without deployments

**5. Production Considerations**

- **Webhook reliability:** Shopify enforces a 5-second response timeout. Our service responds immediately with 200 and processes asynchronously. In production, replace the in-process fire-and-forget with a BullMQ queue backed by Redis (or AWS SQS). The webhook route enqueues the raw payload, a separate worker process dequeues and calls `processOrderAsync`. Idempotency is handled via `INSERT ... ON CONFLICT` upsert on the Shopify order ID.

- **GWP regional scaling:** `gwpRules.json` supports a `currency` field on threshold rules, making market-scoping purely config-driven (AED 260 for UAE, $75 for US, £60 for UK). Add a new rule object per market — zero code change. At checkout, a Shopify Function (JS-based serverless in Shopify's infrastructure) would POST the cart to this endpoint via an App Proxy. The storefront JS can also call it directly for a GWP progress bar in the cart drawer. **Important note on tags:** Shopify's native cart line items do not include product tags. The caller must enrich line items with tags via a product query before sending to this API.

- **Monitoring & observability:** Winston outputs structured JSON to stdout. In production, ship stdout via a Datadog or New Relic log forwarder. Every log line includes `service`, `event`, `timestamp`, and relevant IDs — these map directly to Datadog Log Management facets. The `/health` endpoint maps to a Datadog synthetic monitor with alerting.

- **Security:** Every inbound webhook is validated against the Shopify HMAC-SHA256 signature before any processing. GWP and pricing endpoints should add `Authorization: Bearer` middleware in production. Secrets are environment variables, never committed. Rate limiting via `express-rate-limit` or at the Nginx/CDN layer.

- **Real-time ERP inventory sync (architecture):** Shopify fires `inventory_levels/update` webhooks on every stock change → webhook receiver enqueues on SQS/BullMQ → worker normalises payload to ERP format → ERP REST/SOAP call with idempotency token → failures go to dead-letter queue → nightly reconciliation cron compares Shopify vs ERP and re-queues gaps.

**6. Assumptions & Trade-offs**
- Mock data only — no live Shopify store
- SQLite as downstream mock; production would use a managed DB
- No auth on GWP/pricing endpoints (noted as production gap)
- Collection rules are currency-agnostic by design
- `meetsShippingThreshold` is product-level; in production evaluated at cart level
- JSON config is read at startup (changes require restart)
- Docker can be added as a next step — the service runs directly with Node.js

**7. What I'd do with more time**
- OpenAPI/Swagger spec for the API endpoints
- Auth middleware on GWP and pricing routes
- Docker setup for containerised deployment
- More test coverage: webhook HMAC tests via Supertest, pricing unit tests
- Graceful handling of malformed GWP rules at startup (validation + log warning)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: comprehensive README with architecture, API reference, and production notes"
```

---

## Self-Review Checklist

- [x] **3.1 Webhook Receiver:** HMAC validation with length-safe + Buffer check ✓ | Parse order fields with validation ✓ | Write to SQLite ✓ | 200 immediate + fire-and-forget ✓ | Error handling (malformed payload, missing fields) ✓ | Retry 3x with exponential backoff + dead-letter ✓ | Production queue comments ✓
- [x] **3.2 GWP Engine:** Cart threshold rule (AED-scoped) ✓ | Product collection rule with tags documentation ✓ | Configurable JSON ✓ | Structured response ✓ | Empty cart ✓ | Exact threshold ✓ | Both rules active ✓ | Item-level validation in route ✓ | README regional extension note ✓
- [x] **3.3 Pricing API:** productId + market query params ✓ | 4 markets ✓ | Base price, discountType/Value/Amount, finalPrice, shipping threshold ✓ | Math.max(0) floor ✓ | SUPPORTED_MARKETS derived from catalog ✓ | Input validation ✓ | Storefront API integration note ✓
- [x] **3.4 Logging:** Structured JSON via Winston ✓ | /health endpoint ✓ | 4xx warn / 5xx error distinction ✓ | req.originalUrl + req.ip ✓ | headersSent guard ✓ | 404 JSON handler ✓ | README monitoring extension ✓
- [x] **3.5 Quality:** RESTful conventions ✓ | README ✓ | Security notes ✓ | Graceful shutdown ✓ | Env validation at startup ✓ | Listen error handling ✓
- [x] **Testing:** 25 Supertest integration tests across all 4 endpoints ✓ | Health + 404 ✓ | Webhook HMAC valid/invalid/missing + DB verification + idempotency ✓ | GWP threshold/collection/both/edge cases + validation (400s) ✓ | Pricing all 4 markets + discount math + validation (400/404) ✓
- [x] **Bonus:** Retry with exponential backoff + dead-letter ✓ | ERP inventory sync architecture ✓
- [x] **Docker:** Removed — noted in README as "what I'd do with more time" ✓
