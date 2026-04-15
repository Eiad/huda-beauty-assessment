# Huda Beauty - Backend Integration & Promotion Logic Service

## Overview

Backend service powering the **Nude Obsessions Reloaded** lipstick collection launch campaign at Huda Beauty. The service handles Shopify webhook ingestion, Gift-with-Purchase (GWP) eligibility evaluation, and multi-market pricing across four regional storefronts (UAE, US, UK, Saudi Arabia).

Four endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | Health check and uptime monitor |
| `POST /webhooks/orders/paid` | Shopify order webhook receiver with HMAC verification |
| `POST /api/gwp/check` | GWP eligibility engine for cart evaluation |
| `GET /api/pricing` | Multi-market product pricing with discount calculations |

Built with Express 5, TypeScript, SQLite (via better-sqlite3), and Winston structured logging.

---

## Quick Start

```bash
npm install
cp .env.example .env   # set SHOPIFY_WEBHOOK_SECRET to any value for local dev
npm run dev             # starts on port 3000
npm test                # 25 integration tests
```

**Requirements:** Node.js 18+

**Environment variables:**

| Variable | Required | Description |
|---|---|---|
| `SHOPIFY_WEBHOOK_SECRET` | Yes | Shared secret for HMAC-SHA256 webhook verification |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | `development` or `production` |

---

## API Reference

### GET /health

Returns service status and uptime.

```bash
curl http://localhost:3000/health
```

**Response (200):**

```json
{
  "status": "ok",
  "service": "huda-beauty-api",
  "uptimeSeconds": 142,
  "timestamp": "2026-04-15T10:30:00.000Z"
}
```

---

### POST /webhooks/orders/paid

Receives Shopify `orders/paid` webhook events. Validates the HMAC signature, responds immediately with 200, then processes the order asynchronously.

```bash
curl -X POST http://localhost:3000/webhooks/orders/paid \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Hmac-SHA256: <base64-hmac>" \
  -d '{
    "id": 820982911946154508,
    "email": "customer@example.com",
    "total_price": "260.00",
    "currency": "AED",
    "line_items": [
      {
        "product_id": 788032119674292900,
        "title": "Nude Obsessions Reloaded Lipstick Full Size",
        "quantity": 2,
        "price": "130.00"
      }
    ]
  }'
```

**Response (200):**

```json
{
  "received": true
}
```

**Response (401) - Invalid HMAC:**

```json
{
  "error": "Invalid HMAC signature"
}
```

---

### POST /api/gwp/check

Evaluates a cart against active GWP promotion rules. Supports threshold-based rules (currency-specific) and collection-based rules (product tag matching).

```bash
curl -X POST http://localhost:3000/api/gwp/check \
  -H "Content-Type: application/json" \
  -d '{
    "currency": "AED",
    "lineItems": [
      {
        "productId": "nude-obsessions-full",
        "variantId": "var-001",
        "title": "Nude Obsessions Reloaded Lipstick Full Size",
        "quantity": 2,
        "price": "144.00",
        "tags": ["lashes"]
      }
    ]
  }'
```

**Response (200) - Gift unlocked:**

```json
{
  "unlocked": true,
  "gifts": [
    {
      "productId": "gift-mascara-001",
      "title": "Lash & Blow Mascara (Free Gift)",
      "variantId": "gift-mascara-001-v1"
    },
    {
      "productId": "gift-lash-glue-001",
      "title": "Lash Glue (Free Gift)",
      "variantId": "gift-lash-glue-001-v1"
    }
  ],
  "amountNeeded": null,
  "currency": "AED",
  "appliedRules": ["rule_cart_threshold_aed", "rule_lashes_collection"],
  "message": "Congratulations! You've unlocked 2 free gift(s)."
}
```

**Response (200) - Threshold not met:**

```json
{
  "unlocked": false,
  "gifts": [],
  "amountNeeded": 171.00,
  "currency": "AED",
  "appliedRules": [],
  "message": "Spend AED 171.00 more to unlock a free gift."
}
```

---

### GET /api/pricing?productId=X&market=Y

Returns pricing for a specific product in a given market, including discount calculation and free shipping threshold evaluation.

**Supported markets:** `en-AE`, `en-US`, `en-GB`, `en-SA`

**Supported products:** `nude-obsessions-mini`, `nude-obsessions-full`, `faux-mink-lashes`

```bash
curl "http://localhost:3000/api/pricing?productId=nude-obsessions-mini&market=en-AE"
```

**Response (200):**

```json
{
  "productId": "nude-obsessions-mini",
  "productTitle": "Nude Obsessions Reloaded Lipstick Mini",
  "market": "en-AE",
  "currency": "AED",
  "basePrice": 89.00,
  "discountType": "percentage",
  "discountValue": 15,
  "discountAmount": 13.35,
  "finalPrice": 75.65,
  "meetsShippingThreshold": false,
  "freeShippingThreshold": 260
}
```

**Response (404) - Product not found:**

```json
{
  "error": "Product not found: unknown-product"
}
```

---

## Architecture Overview

The service follows a three-layer architecture:

```
Route  ->  Service  ->  Data
```

- **Routes** (`src/routes/`) handle HTTP concerns: parsing requests, validating input, returning responses.
- **Services** (`src/services/`) contain business logic: GWP rule evaluation, pricing calculation, webhook processing.
- **Data** (`src/db/store.ts`, `src/config/*.json`) manage persistence and configuration.

### File Structure

```
src/
  app.ts                         # Express app factory
  server.ts                      # Startup, env validation, graceful shutdown
  config/
    gwpRules.json                # GWP promotion rules (editable without code changes)
    marketPricing.json           # Product catalog with per-market pricing
  db/
    store.ts                     # SQLite order store with upsert
  middleware/
    hmacVerify.ts                # HMAC-SHA256 webhook signature validation
    requestLogger.ts             # Structured request/response logging
    errorHandler.ts              # Centralised error handler with AppError class
  routes/
    health.ts                    # GET /health
    webhook.ts                   # POST /webhooks/orders/paid
    gwp.ts                       # POST /api/gwp/check
    pricing.ts                   # GET /api/pricing
  services/
    webhookProcessor.ts          # Async order processing and persistence
    gwpEngine.ts                 # Rule-based GWP evaluation engine
    pricingService.ts            # Multi-market pricing with discount logic
  utils/
    logger.ts                    # Winston structured JSON logger
    retry.ts                     # Retry utility with exponential backoff
tests/
  health.test.ts
  webhook.test.ts
  gwp.test.ts
  pricing.test.ts
```

### Shared Middleware

- **requestLogger** logs every request with method, URL, status code, and duration.
- **hmacVerify** validates Shopify's `X-Shopify-Hmac-SHA256` header using timing-safe comparison before any webhook processing occurs.
- **errorHandler** catches thrown `AppError` instances and unknown errors, returning consistent JSON error responses.

### JSON Config Files

GWP rules and product pricing are stored in JSON configuration files (`src/config/gwpRules.json` and `src/config/marketPricing.json`). This allows merchandising teams to adjust promotion rules, thresholds, and pricing without code deployments. Rules are loaded at startup.

---

## Production Considerations

### Webhook Reliability

Shopify enforces a 5-second timeout on webhook responses. The service responds immediately with `200 { "received": true }` and processes the order asynchronously via `processOrderAsync`. This fire-and-forget approach works for the assessment, but in production it should be replaced with a durable queue:

- **Ingest:** Webhook handler validates HMAC, enqueues the raw payload to **BullMQ/Redis** or **AWS SQS**, and responds 200.
- **Worker:** A separate worker process dequeues jobs, processes orders, and persists to the database. This isolates webhook latency from processing time and enables horizontal scaling.
- **Idempotency:** The SQLite store already uses `INSERT ... ON CONFLICT(order_id) DO UPDATE` (upsert), so duplicate Shopify deliveries of the same order ID are safe. This pattern carries directly to a production database.

### GWP Regional Scaling

The `gwpRules.json` config supports a `currency` field on threshold rules. To add regional thresholds for new markets, add separate rule objects with no code changes:

```json
{ "id": "rule_cart_threshold_usd", "type": "cart_threshold", "currency": "USD", "threshold": 75, ... }
{ "id": "rule_cart_threshold_gbp", "type": "cart_threshold", "currency": "GBP", "threshold": 60, ... }
```

Integration with Shopify:
- **Shopify Functions** would POST the cart to this endpoint via App Proxy at checkout for server-side enforcement.
- **Storefront JavaScript** can call the endpoint to render a cart drawer progress bar (e.g., "Spend AED 40 more to unlock your free gift").
- **Important caveat:** Shopify cart line items do not natively include product tags. The caller must enrich line items with tags via a product query before calling the GWP endpoint.

### Monitoring & Observability

All logging uses **Winston** with structured JSON output to stdout. Every log entry includes:

- `service`: service identifier (`huda-beauty-api`)
- `event`: machine-readable event name (e.g., `webhook_received`, `gwp_evaluated`, `pricing_requested`)
- `timestamp`: ISO 8601
- Relevant IDs: `orderId`, `productId`, `market`, etc.

In production, these structured logs ship via a **Datadog** or **New Relic** log forwarder. The event and ID fields map directly to Datadog facets for dashboards and alerting. The `/health` endpoint maps to a synthetic monitor for uptime tracking.

### Security

- **Webhook HMAC:** Every Shopify webhook is verified with HMAC-SHA256 using timing-safe comparison (`crypto.timingSafeEqual`) before processing. Requests with invalid or missing signatures are rejected with 401.
- **GWP/Pricing Auth:** These endpoints are currently open. In production, they need `Authorization: Bearer` middleware with JWT or API key validation.
- **Secrets Management:** `SHOPIFY_WEBHOOK_SECRET` is loaded from environment variables and never committed to source control. `.env.example` documents required variables without exposing values.
- **Rate Limiting:** Production deployments should add `express-rate-limit` middleware or enforce rate limits at the Nginx/CDN layer to prevent abuse.

### Real-Time ERP Inventory Sync (Architecture Only)

For keeping Shopify inventory in sync with an external ERP system:

1. **Shopify `inventory_levels/update` webhooks** fire on every stock change.
2. Webhook handler validates HMAC and enqueues the payload to **SQS** or **BullMQ**.
3. A **worker process** dequeues events, normalises the data to the ERP's expected format, and calls the ERP's REST or SOAP API with an **idempotency token** (inventory level ID + updated_at timestamp).
4. Failed calls route to a **dead-letter queue** for manual review and retry.
5. A **nightly reconciliation cron job** compares Shopify inventory levels against ERP records and flags discrepancies for resolution.

---

## Assumptions & Trade-offs

- **Mock data only** -- no live Shopify store is connected. Product catalog and GWP rules use representative data for the Nude Obsessions Reloaded collection.
- **SQLite as downstream mock** -- serves as a lightweight stand-in for order persistence. Production would use a managed database (Amazon RDS, Cloud SQL).
- **No auth on GWP/pricing endpoints** -- noted as a production gap. These endpoints would require Bearer token middleware in a real deployment.
- **Collection rules are currency-agnostic** -- the `product_collection` rule type triggers on product tags regardless of currency, which is intentional for global promotions.
- **`meetsShippingThreshold` is product-level** -- evaluated per product at the current price. Production would evaluate this at the cart level against total order value.
- **JSON config read at startup** -- changes to `gwpRules.json` or `marketPricing.json` require a service restart. A production system could use a config service or file watcher.
- **Docker omitted** -- the service runs directly with Node.js for simplicity. A production setup would containerise with Docker.

---

## What I'd Do With More Time

- **OpenAPI/Swagger spec** -- auto-generated API documentation with request/response schemas and a test UI.
- **Auth middleware on GWP and pricing** -- JWT or API key validation to secure public-facing endpoints.
- **Docker setup** -- Dockerfile and docker-compose for containerised deployment and consistent environments.
- **More test coverage** -- webhook edge cases (malformed payloads, replay attacks), pricing unit tests for discount edge cases, GWP rule combination scenarios.
- **Graceful GWP rule validation at startup** -- schema validation of `gwpRules.json` at boot time to catch configuration errors early.
- **Region-specific threshold rules** -- add USD and GBP cart threshold rules to complement the existing AED rule for full multi-market GWP support.
