import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config.js';

// Transactional email transport (SMTP). All credentials come from env —
// nothing is hardcoded. Supports any SMTP provider; defaults target Gmail
// so SEAI can authenticate as workwithseai@gmail.com via an App Password.
//
// Required env:
//   MAIL_SMTP_HOST, MAIL_SMTP_PORT, MAIL_SMTP_USER, MAIL_SMTP_PASS
// Optional env:
//   MAIL_FROM (default workwithseai@gmail.com), MAIL_FROM_NAME (default SEAI),
//   APP_URL (used to build links; never hardcode localhost in emails)

let transporter: Transporter | null = null;

export function isMailConfigured(): boolean {
  return Boolean(
    config.smtp.host && config.smtp.user && config.smtp.pass && config.mailFrom
  );
}

function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  return transporter;
}

export interface OutgoingMail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

// Sends via the provider. Resolves only when the provider ACCEPTS the
// message (returns messageId). Rejects on any provider failure so callers
// can never report "sent" for a message that was not accepted.
export async function sendMail(mail: OutgoingMail): Promise<string> {
  if (!isMailConfigured()) {
    throw new Error('Email service is not configured');
  }
  const info = await getTransporter().sendMail({
    from: `"${config.mailFromName}" <${config.mailFrom}>`,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });
  const messageId = String(info.messageId ?? '');
  // Delivery audit: recipient + subject + provider ID only. Never tokens,
  // passwords, or credentials.
  console.log(`[mail] accepted to=${mail.to} subject="${mail.subject}" id=${messageId} response=${String(info.response ?? '').slice(0, 120)}`);
  return messageId;
}
