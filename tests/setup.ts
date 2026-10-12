// Runs before every test module. `src/config.ts` snapshots process.env at import
// time, so the values the mail tests depend on must exist before the first
// import of the application. Anything set here wins over `.env` because
// dotenv never overwrites an already-defined variable.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.APP_URL = 'https://dash.seai.store';
process.env.PUBLIC_URL = 'https://seai.store';
process.env.MAIL_FROM = 'SEAI <workwithseai@gmail.com>';
process.env.MAIL_FROM_NAME = 'SEAI';
process.env.SEAI_MAIL_LOGO_URL = 'https://seai.store/assets/brand/seai-mark.png';
process.env.SEAI_SUPPORT_EMAIL = 'workwithseai@gmail.com';
// The kill switch stays ON: the tests inject their own mail sender.
process.env.SEAI_MAIL_EVENTS_ENABLED = 'true';
process.env.SEAI_MAIL_QA_RECIPIENT = '';
process.env.SEAI_EVENTS_SHARED_SECRET = '';
process.env.SEAI_MAIL_ALLOW_DEV_URLS = '';
process.env.MAIL_SMTP_HOST = '';
process.env.MAIL_SMTP_USER = '';
process.env.MAIL_SMTP_PASS = '';
// Never let a developer's real DATABASE_URL turn these unit tests into an
// integration test against a live Postgres.
process.env.DATABASE_URL = '';

// The fallback store is disk-backed, so a shared directory would leak dedupe
// keys between runs and make idempotency tests pass or fail at random. Give
// every run its own throwaway directory.
const dataDir = mkdtempSync(join(tmpdir(), 'seai-mail-test-'));
process.env.SEAI_DATA_DIR = dataDir;
process.on('exit', () => {
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});
