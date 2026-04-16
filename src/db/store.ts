import path from 'path';
import { logger } from '../utils/logger';

export interface ParsedOrder {
  id: string;
  customerEmail: string;
  totalPrice: string;
  currency: string;
  lineItems: Array<{ productId: string; variantId: string; title: string; quantity: number; price: string }>;
  shippingAddress: Record<string, unknown> | null;
  rawPayload: string;
}

// On Vercel, better-sqlite3 native module won't compile.
// Use an in-memory Map as fallback. Locally, use SQLite.
const isVercel = !!process.env.VERCEL;

// ── In-memory store (Vercel) ──
const memoryStore = new Map<string, Record<string, unknown>>();

// ── SQLite store (local) ──
let db: any;
let insertStmt: any;

export function initDb() {
  if (isVercel) {
    logger.info({ event: 'db_init', message: 'Using in-memory store (Vercel environment)' });
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3');
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

    insertStmt = db.prepare(`
      INSERT INTO orders (id, customer_email, total_price, currency, line_items, shipping_address, received_at, raw_payload)
      VALUES (@id, @customerEmail, @totalPrice, @currency, @lineItems, @shippingAddress, @receivedAt, @rawPayload)
      ON CONFLICT(id) DO UPDATE SET
        customer_email = excluded.customer_email,
        total_price = excluded.total_price,
        raw_payload = excluded.raw_payload
    `);

    logger.info({ event: 'db_init', message: 'SQLite database initialised' });
  } catch (err) {
    logger.warn({ event: 'db_init_fallback', message: 'SQLite unavailable, using in-memory store' });
  }
}

export function closeDb() {
  if (db) db.close();
}

export function upsertOrder(order: ParsedOrder): void {
  if (db && insertStmt) {
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
  } else {
    // In-memory fallback
    memoryStore.set(order.id, {
      id: order.id,
      customer_email: order.customerEmail,
      total_price: order.totalPrice,
      currency: order.currency,
      line_items: order.lineItems,
      received_at: new Date().toISOString(),
    });
  }
}
