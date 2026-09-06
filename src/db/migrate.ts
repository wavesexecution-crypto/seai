import { db } from './db.js';

async function main() {
  await db.init();
  await db.migrate();
  console.log(`[db] migrate ok (driver=${db.driver})`);
  for (let slot = 1; slot <= 6; slot++) {
    await db.insert('ai_keys', { id: `key_${slot}`, key_id: `key_${slot}`, slot, status: 'unknown' }).catch(() => undefined);
  }
  await db.close();
}

await main();
