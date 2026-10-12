/**
 * Minimal migration runner: applies db/migrations/*.sql in order against
 * DATABASE_URL. Idempotent (every migration is wrapped in transactions with
 * IF NOT EXISTS). Used in Phase 7 and CI; never embeds credentials.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', '..', 'db', 'migrations');

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set.');
    process.exit(1);
  }
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf-8');
      console.log(`applying ${file}...`);
      await pool.query(sql);
      console.log(`applied ${file}`);
    }
  } finally {
    await pool.end();
  }
}

void main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
