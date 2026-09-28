// Renders every email template to .seai-preview/ (HTML + plain text) so the
// full inventory can be reviewed without sending anything.
//
//   npm run email:preview                 # write files only
//   npm run email:preview -- --send=you@x.com   # also deliver for real QA
//
// Requires a production APP_URL/PUBLIC_URL: preview rendering refuses to emit
// localhost or preview-host links.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.js';
import { db } from '../src/db/db.js';
import { PREVIEW_FIXTURES } from '../src/mail/fixtures.js';
import { renderTemplate } from '../src/mail/registry.js';
import { dispatchEmail, setMailDryRun } from '../src/mail/dispatch.js';
import { emailEnvironmentReport, dashboardUrl } from '../src/mail/urls.js';
import { listTemplates } from '../src/mail/registry.js';

const OUT_DIR = join(process.cwd(), '.seai-preview');
const sendArg = process.argv.find((a) => a.startsWith('--send='));
const sendTo = sendArg ? sendArg.slice('--send='.length).trim() : '';

async function main(): Promise<void> {
  const env = emailEnvironmentReport();
  console.log('[preview] dashboard :', env.dashboard);
  console.log('[preview] public    :', env.publicSite);
  console.log('[preview] logo      :', env.logo ?? '(wordmark only)');
  console.log('[preview] support   :', env.support);
  console.log('[preview] transport:', config.mailFromName, '<' + config.mailFrom + '>');
  console.log('[preview] templates :', listTemplates().length, 'defined /', listTemplates().filter((t) => t.wired).length, 'wired');

  if (env.devUrlsAllowed) {
    console.warn('[preview] WARNING: dev URLs are enabled (SEAI_MAIL_ALLOW_DEV_URLS). Production must never set this.');
  }

  await db.init();
  mkdirSync(OUT_DIR, { recursive: true });

  if (sendTo) {
    if (!config.mailQaRecipient && sendTo === config.mailFrom) {
      console.error('[preview] refusing to bulk-send to the sender address. Use a QA mailbox.');
      process.exit(1);
    }
  }

  setMailDryRun(!sendTo);
  const manifest: { name: string; template: string; subject: string; status: string; file: string }[] = [];
  let failures = 0;

  for (const fixture of PREVIEW_FIXTURES) {
    try {
      const rendered = renderTemplate(fixture.template, fixture.context);
      const htmlPath = join(OUT_DIR, `${fixture.name}.html`);
      const textPath = join(OUT_DIR, `${fixture.name}.txt`);
      writeFileSync(htmlPath, rendered.html, 'utf8');
      writeFileSync(textPath, rendered.text, 'utf8');
      let status = 'rendered';
      if (sendTo) {
        const result = await dispatchEmail({
          eventName: `preview.${fixture.template}`,
          template: fixture.template,
          to: sendTo,
          variables: { ...fixture.context, email: sendTo },
          idempotent: false,
        });
        status = result.status;
        if (result.status === 'failed') failures += 1;
      }
      manifest.push({ name: fixture.name, template: fixture.template, subject: rendered.subject, status, file: htmlPath });
      console.log(`[preview] ${fixture.template.padEnd(34)} ${status.padEnd(9)} ${rendered.subject}`);
    } catch (err) {
      failures += 1;
      console.error(`[preview] ${fixture.template} FAILED:`, (err as Error).message);
    }
  }

  writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log(`[preview] ${manifest.length} templates written to ${OUT_DIR}`);
  console.log('[preview] index:', dashboardUrl('/overview'));
  if (failures > 0) {
    console.error(`[preview] ${failures} failure(s)`);
    process.exit(1);
  }
  await db.close();
}

main().catch((err) => {
  console.error('[preview] failed:', err);
  process.exit(1);
});
