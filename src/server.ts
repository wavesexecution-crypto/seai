import { config, configuredKeyCount } from './config.js';
import { db } from './db/db.js';
import { createApp } from './app.js';

// Local / long-running boot. On Vercel, api/index.ts calls createApp() instead.
const app = await createApp();
const port = config.port;
app.listen(port, () => {
  console.log(`[seai] listening on :${port} (driver=${db.driver}, autonomy=${config.autonomyLevel}, ollamaKeys=${configuredKeyCount()}/6)`);
});
