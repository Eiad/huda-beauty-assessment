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
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.received).toBe(true);
  });

  it('stores the order in SQLite after processing', async () => {
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
      .send(body);

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
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/invalid hmac/i);
  });

  it('rejects requests with missing HMAC header — returns 401', async () => {
    const body = JSON.stringify(validOrder);

    const res = await request(app)
      .post('/webhooks/orders/paid')
      .set('Content-Type', 'application/json')
      .send(body);

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing hmac/i);
  });
});
