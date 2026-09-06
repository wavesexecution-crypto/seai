import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

type Row = Record<string, any>;

// Minimal DB abstraction: real PostgreSQL when DATABASE_URL is set,
// otherwise a disk-backed memory store (SEAI_DATA_DIR, default .seai-data)
// so dev/tests run anywhere AND agent state survives restarts.
// Production MUST set DATABASE_URL (Postgres). Schema is Postgres-first.
class Database {
  private pool: any = null;
  private usePg = false;
  private mem: Map<string, Row[]> = new Map();

  async init(): Promise<void> {
    if (config.databaseUrl) {
      try {
        const { Pool } = await import('pg');
        this.pool = new Pool({ connectionString: config.databaseUrl });
        await this.pool.query('SELECT 1');
        this.usePg = true;
        // NOTE: migrations are NOT run here. Run `npm run db:migrate` explicitly
        // (e.g. locally against the production DATABASE_URL) so schema changes
        // are a deliberate deploy step, never an implicit runtime side effect.
        return;
      } catch (err) {
        console.warn('[db] Postgres unavailable, falling back to disk-backed store:', (err as Error).message);
      }
    }
    this.usePg = false;
    await this.loadDisk();
  }

  private dataDir(): string {
    if (process.env.SEAI_DATA_DIR) return process.env.SEAI_DATA_DIR;
    // Vercel's filesystem is read-only except /tmp (and ephemeral) — Postgres
    // via DATABASE_URL is required for real persistence in production.
    if (process.env.VERCEL) return '/tmp/seai-data';
    return join(process.cwd(), '.seai-data');
  }

  private async loadDisk(): Promise<void> {
    try {
      const { mkdirSync, readdirSync } = await import('node:fs');
      mkdirSync(this.dataDir(), { recursive: true });
      for (const f of readdirSync(this.dataDir())) {
        if (!f.endsWith('.json')) continue;
        try {
          this.mem.set(f.slice(0, -5), JSON.parse(readFileSync(join(this.dataDir(), f), 'utf8')));
        } catch { /* corrupt file: start empty */ }
      }
    } catch { /* ignore */ }
  }

  private async saveDisk(table: string): Promise<void> {
    try {
      const { mkdirSync, writeFileSync } = await import('node:fs');
      mkdirSync(this.dataDir(), { recursive: true });
      writeFileSync(join(this.dataDir(), `${table}.json`), JSON.stringify(this.table(table)));
    } catch { /* ignore */ }
  }

  get driver(): 'pg' | 'memory' {
    return this.usePg ? 'pg' : 'memory';
  }

  async migrate(): Promise<void> {
    if (!this.usePg) return;
    const here = dirname(fileURLToPath(import.meta.url));
    for (const f of ['schema.sql', 'schema-multistore.sql', 'schema-creation.sql', 'schema-blueprint.sql']) {
      try {
        await this.pool.query(readFileSync(join(here, f), 'utf8'));
      } catch (e: any) {
        console.warn(`[db] migration ${f}:`, (e as Error).message);
      }
    }
  }

  async query(text: string, params: any[] = []): Promise<{ rows: Row[] }> {
    if (this.usePg) return this.pool.query(text, params);
    throw new Error('memory driver does not support raw SQL');
  }

  private table(name: string): Row[] {
    if (!this.mem.has(name)) this.mem.set(name, []);
    return this.mem.get(name)!;
  }

  async insert(table: string, row: Row): Promise<Row> {
    if (this.usePg) {
      const keys = Object.keys(row);
      const vals = Object.values(row);
      const cols = keys.map((k) => `"${k}"`).join(',');
      const ph = keys.map((_, i) => `$${i + 1}`).join(',');
      const res = await this.pool.query(
        `INSERT INTO ${table} (${cols}) VALUES (${ph}) ON CONFLICT DO NOTHING RETURNING *`,
        vals
      );
      return res.rows[0] ?? row;
    }
    const t = this.table(table);
    if (!row.id) row.id = randomUUID();
    if (!t.find((r) => r.id === row.id)) t.push({ ...row });
    void this.saveDisk(table);
    return { ...row };
  }

  async list(table: string, where: Partial<Row> = {}, limit = 100): Promise<Row[]> {
    if (this.usePg) {
      const keys = Object.keys(where);
      const vals = Object.values(where);
      const clause = keys.length ? `WHERE ${keys.map((k, i) => `"${k}"=$${i + 1}`).join(' AND ')}` : '';
      const res = await this.pool.query(`SELECT * FROM ${table} ${clause} ORDER BY 1 DESC LIMIT ${Number(limit) || 100}`, vals);
      return res.rows;
    }
    let rows = [...this.table(table)];
    for (const [k, v] of Object.entries(where)) rows = rows.filter((r) => r[k] === v);
    return rows.slice(-limit).reverse();
  }

  async update(table: string, id: string, patch: Row): Promise<void> {
    if (this.usePg) {
      const keys = Object.keys(patch);
      if (!keys.length) return;
      const set = keys.map((k, i) => `"${k}"=$${i + 1}`).join(',');
      await this.pool.query(`UPDATE ${table} SET ${set} WHERE id=$${keys.length + 1}`, [...Object.values(patch), id]);
      return;
    }
    const t = this.table(table);
    const i = t.findIndex((r) => r.id === id);
    if (i >= 0) t[i] = { ...t[i], ...patch };
    void this.saveDisk(table);
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end().catch(() => undefined);
  }
}

export const db = new Database();
