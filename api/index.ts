import { createApp } from '../src/app';
import { initDb } from '../src/db/store';

// Set a default webhook secret for the demo if not configured
if (!process.env.SHOPIFY_WEBHOOK_SECRET) {
  process.env.SHOPIFY_WEBHOOK_SECRET = 'vercel_demo_secret';
}

initDb();
const app = createApp();

export default app;
