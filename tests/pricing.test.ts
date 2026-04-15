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
  it('returns correct percentage discount for en-AE', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full&market=en-AE');

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('AED');
    expect(res.body.basePrice).toBe(160);
    expect(res.body.discountType).toBe('percentage');
    expect(res.body.discountValue).toBe(10);
    expect(res.body.discountAmount).toBe(16);
    expect(res.body.finalPrice).toBe(144);
    expect(res.body.meetsShippingThreshold).toBe(false);
    expect(res.body.freeShippingThreshold).toBe(260);
  });

  it('returns no discount for en-US', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full&market=en-US');

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('USD');
    expect(res.body.basePrice).toBe(44);
    expect(res.body.discountType).toBeNull();
    expect(res.body.discountValue).toBeNull();
    expect(res.body.discountAmount).toBe(0);
    expect(res.body.finalPrice).toBe(44);
    expect(res.body.meetsShippingThreshold).toBe(false);
  });

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

  it('returns correct pricing for en-SA', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full&market=en-SA');

    expect(res.status).toBe(200);
    expect(res.body.currency).toBe('SAR');
    expect(res.body.basePrice).toBe(165);
    expect(res.body.discountType).toBe('percentage');
    expect(res.body.discountValue).toBe(10);
    expect(res.body.finalPrice).toBe(148.5);
  });

  it('includes productId and productTitle in response', async () => {
    const res = await request(app).get('/api/pricing?productId=faux-mink-lashes&market=en-AE');

    expect(res.status).toBe(200);
    expect(res.body.productId).toBe('faux-mink-lashes');
    expect(res.body.productTitle).toBe('Huda Beauty Faux Mink Lashes');
    expect(res.body.market).toBe('en-AE');
  });

  it('returns 400 for unsupported market', async () => {
    const res = await request(app).get('/api/pricing?productId=nude-obsessions-full&market=en-FR');

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unsupported market/i);
  });

  it('returns 404 for unknown product', async () => {
    const res = await request(app).get('/api/pricing?productId=ghost-product&market=en-AE');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/product not found/i);
  });

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
