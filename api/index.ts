import { createApp } from '../src/app';
import { initDb } from '../src/db/store';

initDb();
const app = createApp();

export default app;
