// End-to-end password-reset delivery check through the REAL SMTP transport.
//
//   npx tsx scripts/verify-reset-delivery.ts qa-account@example.com
//   npx tsx scripts/verify-reset-delivery.ts qa-account@example.com --yes
//
// It creates a real single-use reset token, sends the real
// `account.password_reset` template through the same dispatch pipeline the
// route uses, then prints the recorded delivery row. The token itself is never
// printed, and it stays valid only until the reset is used.
//
// `--yes` is required so a real email can never be sent to a live customer by
// accident. A configured SEAI_MAIL_QA_RECIPIENT always wins, so the real
// account address is never contacted while QA redirection is on.
import { createHash } from 'node:crypto';
import { db } from '../src/db/db.js';
import { config } from '../src/config.js';
import { findUserByEmail, createPasswordReset } from '../src/auth/service.js';
import { dispatchEmail } from '../src/mail/dispatch.js';
import { passwordResetUrl } from '../src/mail/urls.js';
import { isMailConfigured } from '../src/mail/transport.js';
import { listDeliveries } from '../src/mail/store.js';

const args = process.argv.slice(2);
const confirmed = args.includes('--yes');
const email = args.find((a) => !a.startsWith('--'))?.trim().toLowerCase();

function usage(message: string): never {
  console.error(`[reset-check] ${message}`);
  console.error('[reset-check] usage: npx tsx scripts/verify-reset-delivery.ts <email> --yes');
  process.exit(1);
}

if (!email) usage('an account email argument is required');
if (!confirmed) usage('refusing to send real mail without --yes');

if (!isMailConfigured()) {
  usage('SMTP is not configured (MAIL_SMTP_HOST / MAIL_SMTP_USER / MAIL_SMTP_PASS required)');
}

const qa = config.mailQaRecipient.trim().toLowerCase();
const recipient = qa || email;
if (qa && qa !== email) console.log(`[reset-check] QA redirection active: sending to ${qa} instead of ${email}`);

await db.init();
try {
  const user = await findUserByEmail(email);
  if (!user) usage(`no account found for ${email}`);

  const token = await createPasswordReset(user.id);
  const resetUrl = passwordResetUrl(token);
  // Same one-way hash the route uses, so this run can never collide with a
  // real customer's own reset request.
  const dedupeHash = createHash('sha256').update(token).digest('hex').slice(0, 32);

  const result = await dispatchEmail({
    eventName: 'account.password_reset',
    template: 'account.password_reset',
    to: recipient,
    customerId: user.id,
    dedupeParts: [user.id, dedupeHash],
    variables: { reset_url: resetUrl, email: recipient, expires_in_hours: '1' },
  });

  const recorded = result.deliveryId
    ? (await listDeliveries({ recipient })).find((d) => d.id === result.deliveryId) ?? null
    : null;

  console.log(
    JSON.stringify(
      {
        to: recipient,
        template: result.template,
        status: result.status,
        attempt: result.attempt,
        event_id: result.eventId,
        delivery_id: result.deliveryId,
        provider: recorded?.provider ?? null,
        provider_message_id: recorded?.provider_message_id ?? null,
        provider_response: recorded?.provider_response ?? null,
        error: result.reason ?? null,
      },
      null,
      2,
    ),
  );

  if (result.status !== 'sent') {
    console.error(`[reset-check] FAILED (${result.status}). Check SMTP credentials and the log line above.`);
    process.exit(1);
  }
  console.log('[reset-check] delivered. Confirm the message arrived and the link opens a reset form.');
} finally {
  await db.close();
}
