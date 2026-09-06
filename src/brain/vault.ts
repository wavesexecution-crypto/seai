import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, sep } from 'node:path';
import { config } from '../config.js';

// Obsidian vault root: application-controlled, human-readable Markdown.
// Overridable via SEAI_BRAIN_DIR. On Vercel (read-only fs) defaults to /tmp
// (ephemeral) — production persistence requirements are documented in
// docs/DEPLOYMENT.md under "Brain persistence". Never contains secrets.
export function brainDir(): string {
  if (process.env.SEAI_BRAIN_DIR) return process.env.SEAI_BRAIN_DIR;
  if (process.env.VERCEL) return '/tmp/seai-brain';
  return join(process.cwd(), 'brain');
}

export function vaultName(): string {
  return 'SEAI VX';
}

/** Resolve a vault-relative path. Rejects traversal, absolute, and drive paths. */
export function safePath(rel: string): string {
  const raw = String(rel || '').replace(/\\/g, '/');
  if (!raw || raw.startsWith('/') || /^[a-zA-Z]:/.test(raw)) throw new Error('refusing unsafe vault path');
  const clean = raw.replace(/^\/+/, '');
  if (!clean || clean.includes('..')) throw new Error('refusing unsafe vault path');
  const full = join(brainDir(), ...clean.split('/'));
  const root = brainDir();
  if (full !== root && !full.startsWith(root + sep)) throw new Error('vault path escapes root');
  return full;
}

const SECRET_PATTERNS: RegExp[] = [
  /shpat_[A-Za-z0-9]+/i,
  /shpss_[A-Za-z0-9]+/i,
  /sk-ant-[A-Za-z0-9-]+/i,
  /sk-[A-Za-z0-9]{20,}/,
  /xox[bpas]-[A-Za-z0-9-]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /OLLAMA_API_KEY_\d\s*=\s*\S+/i,
  /"accessToken"\s*:\s*"[^"]{8,}"/,
  /"access_token[^}]{0,60}"[^"]{8,}"/i,
];

/** Hard refusal: secrets must never reach the vault. Throws on match. */
export function assertNoSecrets(content: string): void {
  for (const re of SECRET_PATTERNS) {
    if (re.test(content)) throw new Error('brain write refused: content matches a secret pattern');
  }
  // Also refuse any configured Ollama key value verbatim (values never leave config)
  for (const k of config.ollamaKeys) {
    if (k && k.length > 12 && content.includes(k)) throw new Error('brain write refused: contains provider credential material');
  }
}

export interface Note {
  path: string;
  title: string;
  updatedAt: string;
}

export function writeNote(rel: string, title: string, body: string, meta: Record<string, string> = {}): string {
  assertNoSecrets(title + '\n' + body);
  const full = safePath(rel);
  mkdirSync(dirname(full), { recursive: true });
  const fm = Object.entries({ title, updated: new Date().toISOString(), ...meta })
    .map(([k, v]) => `${k}: ${String(v).replace(/\n/g, ' ')}`)
    .join('\n');
  writeFileSync(full, `---\n${fm}\n---\n\n# ${title}\n\n${body.replace(/\s+$/, '')}\n`, 'utf8');
  return rel;
}

export function readNote(rel: string): string | null {
  try {
    return readFileSync(safePath(rel), 'utf8');
  } catch {
    return null;
  }
}

export function noteExists(rel: string): boolean {
  try {
    return existsSync(safePath(rel));
  } catch {
    return false;
  }
}

/** Append a dated entry to a note, creating it with a header if absent. */
export function appendEntry(rel: string, title: string, entry: string): void {
  assertNoSecrets(entry);
  const full = safePath(rel);
  mkdirSync(dirname(full), { recursive: true });
  const stamp = `\n\n## ${new Date().toISOString()}\n\n${entry.replace(/\s+$/, '')}\n`;
  if (existsSync(full)) {
    writeFileSync(full, readFileSync(full, 'utf8').replace(/\s+$/, '') + stamp, 'utf8');
  } else {
    writeNote(rel, title, entry.trim());
  }
}

export function listNotes(relDir: string): Note[] {
  const out: Note[] = [];
  const base = relDir ? relDir.replace(/\/?$/, '') + '/' : '';
  const walk = (dir: string, prefix: string) => {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      const full = join(dir, e);
      try {
        const st = statSync(full);
        if (st.isDirectory()) walk(full, `${prefix}${e}/`);
        else if (e.endsWith('.md')) out.push({ path: `${prefix}${e}`, title: e.replace(/\.md$/, ''), updatedAt: st.mtime.toISOString() });
      } catch { /* ignore */ }
    }
  };
  walk(relDir ? safePath(relDir) : brainDir(), base);
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

/** Store-scoped root. Slots keep friendly names; unknown shops get a sanitized folder. Never mixes stores. */
export function storeRoot(storeId: string, slotLabel?: string | null): string {
  const label = (slotLabel ?? '').trim();
  if (/^Store \d{2}$/.test(label)) return `02_STORES/${label}`;
  const safe = storeId.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 60);
  return `02_STORES/_unbound/${safe || 'unknown'}`;
}
