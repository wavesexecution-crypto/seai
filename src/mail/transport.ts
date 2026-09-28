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
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId: string;
  response: string;
  accepted: string[];
  rejected: string[];
}

function envelopeOf(mail: OutgoingMail): Record<string, unknown> {
  return {
    from: `"${config.mailFromName}" <${config.mailFrom}>`,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    ...(mail.headers ? { headers: mail.headers } : {}),
  };
}

// Resolves only when the provider ACCEPTS the message. Rejects on any provider
// failure so callers can never report "sent" for a message that was not accepted.
export async function sendMail(mail: OutgoingMail): Promise<string> {
  const result = await sendMailDetailed(mail);
  return result.messageId;
}

export async function sendMailDetailed(mail: OutgoingMail): Promise<SendResult> {
  if (!isMailConfigured()) {
    throw new Error('Email service is not configured');
  }
  const info: any = await getTransporter().sendMail(envelopeOf(mail));
  return {
    messageId: String(info?.messageId ?? ''),
    response: String(info?.response ?? ''),
    accepted: (info?.accepted ?? []).map(String),
    rejected: (info?.rejected ?? []).map(String),
  };
}

export function mailTransporterInfo(): { configured: boolean; host: string; port: number; secure: boolean; user: string; from: string } {
  return {
    configured: isMailConfigured(),
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    user: config.smtp.user,
    from: `${config.mailFromName} <${config.mailFrom}>`,
  };
}

export function resetMailTransport(): void {
  transporter = null;
}
