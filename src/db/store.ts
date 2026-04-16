import Database from 'better-sqlite3';
import path from 'path';
import { logger } from '../utils/logger';

let db: Database.Database;
let insertStmt: Database.Statement;

export function initDb() {
  // Use /tmp on Vercel (read-only filesystem), local data/ directory otherwise
  const isVercel = !!process.env.VERCEL;
  const dbPath = isVercel
    ? path.join('/tmp', 'orders.db')
    : path.join(process.cwd(), 'data', 'orders.db');
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
