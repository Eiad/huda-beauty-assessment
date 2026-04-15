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
    expect(res.body.message).toMatch(/spend/i);
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

  it('returns unlocked=false for an empty cart', async () => {
    const res = await request(app)
      .post('/api/gwp/check')
      .send({ currency: 'AED', lineItems: [] });

    expect(res.status).toBe(200);
    expect(res.body.unlocked).toBe(false);
    expect(res.body.message).toMatch(/empty/i);
  });

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
