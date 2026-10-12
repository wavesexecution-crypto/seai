import { escapeAttr, escapeHtml, safeUrl, stripControl, subjectSafe } from './safety.js';
import { config } from '../config.js';
import { dashboardUrl, privacyUrl, supportMailto, termsUrl } from './urls.js';

export type Tone = 'neutral' | 'positive' | 'warning' | 'critical';

export interface Block {
  html: string;
  text: string;
}

const PALETTE = {
  page: '#0a0a0b',
  panel: '#111113',
  fill: '#17171a',
  border: '#26262b',
  ink: '#f4f4f5',
  sub: '#a1a1aa',
  faint: '#7c7c86',
  button: '#f4f4f5',
  buttonInk: '#0a0a0b',
  positive: '#7fb685',
  warning: '#d2a24a',
  critical: '#e0605e',
} as const;

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,'SF Mono',SFMono-Regular,Menlo,Consolas,monospace`;
const WIDTH = 560;
const WRAP = 78;

const TONE_COLOR: Record<Tone, string> = {
  neutral: PALETTE.sub,
  positive: PALETTE.positive,
  warning: PALETTE.warning,
  critical: PALETTE.critical,
};

const TONE_LABEL: Record<Tone, string> = {
  neutral: 'STATUS',
  positive: 'STATUS',
  warning: 'ACTION NEEDED',
  critical: 'ACTION NEEDED',
};

function text(str: unknown): string {
  return stripControl(String(str ?? ''));
}

// Plain-text part hardening: strip control characters AND any HTML tag-like
// construct. A text/plain MIME part cannot execute markup, but a raw
// "<script>" from customer-supplied copy must never reach a mailbox, because some
// clients fall back to rendering a text part as HTML when the html part fails.
// The html part keeps `text()` and escapes instead, so nothing is ever lost.
function plain(str: unknown): string {
  return text(str)
    .replace(/<\/?[a-zA-Z!?][^<>]*>/g, '')
    .replace(/<[^<>]{1,400}>/g, '');
}

function wrapPlain(value: string): string {
  const out: string[] = [];
  for (const paragraph of plain(value).split('\n')) {
    if (paragraph.trim() === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      if (word.length > WRAP) {
        if (line) {
          out.push(line);
          line = '';
        }
        out.push(word);
        continue;
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= WRAP) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out.join('\n');
}

function row(label: string, value: string, href?: string): string {
  const safeLabel = escapeHtml(text(label));
  if (href) {
    const url = safeUrl(href, { label: text(label) });
    return `<tr><td style="padding:9px 0;border-bottom:1px solid ${PALETTE.border};font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.faint};vertical-align:top;width:38%;">${safeLabel}</td><td style="padding:9px 0;border-bottom:1px solid ${PALETTE.border};font-size:14px;line-height:1.5;color:${PALETTE.ink};vertical-align:top;"><a href="${escapeAttr(url)}" style="color:${PALETTE.ink};text-decoration:underline;word-break:break-word;">${escapeHtml(text(value))}</a></td></tr>`;
  }
  return `<tr><td style="padding:9px 0;border-bottom:1px solid ${PALETTE.border};font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${PALETTE.faint};vertical-align:top;width:38%;">${safeLabel}</td><td style="padding:9px 0;border-bottom:1px solid ${PALETTE.border};font-size:14px;line-height:1.5;color:${PALETTE.ink};vertical-align:top;">${escapeHtml(text(value))}</td></tr>`;
}

export function eyebrow(label: string): Block {
  return {
    html: `<p style="margin:0 0 10px;font-size:11px;line-height:1.4;letter-spacing:.14em;text-transform:uppercase;color:${PALETTE.faint};font-weight:600;">${escapeHtml(text(label))}</p>`,
    text: plain(label).toUpperCase(),
  };
}

export function heading(value: string): Block {
  return {
    html: `<h1 class="seai-h1" style="margin:0 0 14px;font-size:25px;line-height:1.22;font-weight:600;letter-spacing:-.015em;color:${PALETTE.ink};">${escapeHtml(text(value))}</h1>`,
    text: plain(value),
  };
}

export function paragraph(value: string, options: { color?: string; size?: number } = {}): Block {
  const color = options.color ?? PALETTE.sub;
  const size = options.size ?? 15;
  return {
    html: `<p style="margin:0 0 12px;font-size:${size}px;line-height:1.6;color:${color};">${escapeHtml(text(value))}</p>`,
    text: wrapPlain(value),
  };
}

export function note(value: string): Block {
  return {
    html: `<p style="margin:18px 0 0;font-size:13px;line-height:1.6;color:${PALETTE.faint};">${escapeHtml(text(value))}</p>`,
    text: wrapPlain(value),
  };
}

export function divider(): Block {
  return {
    html: `<tr><td style="padding:6px 0 22px;"><div style="height:1px;line-height:1px;font-size:0;background:${PALETTE.border};">&nbsp;</div></td></tr>`,
    text: '----------------------------------------',
  };
}

// Restrained status label: small uppercase, letterspaced, no pill chrome.
export function statusBadge(label: string, tone: Tone = 'neutral'): Block {
  const color = TONE_COLOR[tone];
  return {
    html: `<p class="seai-label" style="margin:0 0 14px;font-size:11px;line-height:1.3;letter-spacing:.16em;text-transform:uppercase;font-weight:600;color:${color};">${escapeHtml(text(label))}</p>`,
    text: plain(label).toUpperCase(),
  };
}

export function callout(value: string, tone: Tone = 'neutral'): Block {
  const color = TONE_COLOR[tone];
  return {
    html: `<tr><td style="padding:0 0 18px;"><div style="border-left:2px solid ${color};background:${PALETTE.fill};border-radius:0 8px 8px 0;padding:14px 16px;font-size:14px;line-height:1.6;color:${PALETTE.ink};">${escapeHtml(text(value))}</div></td></tr>`,
    text: wrapPlain(value),
  };
}

export interface InfoRow {
  label: string;
  value: string;
  href?: string;
}

export function infoBlock(title: string | null, rows: InfoRow[]): Block {
  const usable = rows.filter((r) => text(r.value).length > 0);
  if (usable.length === 0) return { html: '', text: '' };
  const headingHtml = title
    ? `<p style="margin:0 0 8px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:${PALETTE.faint};font-weight:600;">${escapeHtml(text(title))}</p>`
    : '';
  const body = usable.map((r) => row(r.label, r.value, r.href)).join('');
  const plainRows = usable.map((r) => `${plain(r.label)}: ${plain(r.value)}`).join('\n');
  return {
    html: `<tr><td style="padding:0 0 6px;border:1px solid ${PALETTE.border};background:${PALETTE.panel};border-radius:10px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;"><tr><td class="seai-card" style="padding:16px 18px 4px;">${headingHtml}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${body}</table></td></tr></table></td></tr>`,
    text: plainRows,
  };
}

export function bulletList(items: string[]): Block {
  const usable = items.map((i) => plain(i)).filter(Boolean);
  if (usable.length === 0) return { html: '', text: '' };
  const html = usable
    .map(
      (item) =>
        `<tr><td style="padding:0 0 8px;vertical-align:top;width:18px;font-size:14px;line-height:1.6;color:${PALETTE.faint};">&bull;</td><td style="padding:0 0 8px;font-size:14px;line-height:1.6;color:${PALETTE.sub};">${escapeHtml(item)}</td></tr>`,
    )
    .join('');
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;">${html}</table>`,
    text: usable.map((i) => `- ${wrapPlain(i).replace(/\n/g, '\n  ')}`).join('\n'),
  };
}

export function stepList(items: string[]): Block {
  const usable = items.map((i) => plain(i)).filter(Boolean);
  if (usable.length === 0) return { html: '', text: '' };
  const html = usable
    .map(
      (item, index) =>
        `<tr><td style="padding:0 0 12px;vertical-align:top;width:26px;"><span style="display:inline-block;width:20px;height:20px;line-height:20px;text-align:center;border-radius:999px;background:${PALETTE.fill};border:1px solid ${PALETTE.border};color:${PALETTE.sub};font-size:11px;font-weight:700;">${index + 1}</span></td><td style="padding:1px 0 12px;font-size:14px;line-height:1.6;color:${PALETTE.sub};">${escapeHtml(item)}</td></tr>`,
    )
    .join('');
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 20px;">${html}</table>`,
    text: usable.map((item, index) => `${index + 1}. ${wrapPlain(item).replace(/\n/g, '\n   ')}`).join('\n'),
  };
}

export function cta(label: string, href: string): Block {
  const url = safeUrl(href, { label: 'Call to action' });
  const html = `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:separate;margin:0;"><tr><td bgcolor="${PALETTE.button}" style="border-radius:8px;mso-padding-alt:15px 30px;"><a href="${escapeAttr(url)}" style="display:inline-block;padding:15px 30px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1;color:${PALETTE.buttonInk};text-decoration:none;border-radius:8px;" class="seai-cta">${escapeHtml(text(label))}</a></td></tr></table>`;
  return { html: `<tr><td style="padding:6px 0 22px;">${html}</td></tr>`, text: `${plain(label)}:\n${url}` };
}

export function secondaryLink(label: string, href: string): Block {
  const url = safeUrl(href, { label: 'Link' });
  return {
    html: `<p style="margin:0 0 18px;font-size:14px;line-height:1.6;"><a href="${escapeAttr(url)}" style="color:${PALETTE.sub};text-decoration:underline;">${escapeHtml(text(label))}</a></p>`,
    text: `${plain(label)}: ${url}`,
  };
}

export function linkList(links: { label: string; href: string }[]): Block {
  const usable = links.filter((l) => text(l.label) && text(l.href));
  if (usable.length === 0) return { html: '', text: '' };
  const html = usable
    .map((l) => {
      const url = safeUrl(l.href, { label: l.label });
      return `<tr><td style="padding:0 0 10px;vertical-align:top;width:20px;font-size:14px;line-height:1.6;color:${PALETTE.faint};">&rarr;</td><td style="padding:0 0 10px;font-size:14px;line-height:1.6;"><a href="${escapeAttr(url)}" style="color:${PALETTE.sub};text-decoration:underline;word-break:break-word;">${escapeHtml(text(l.label))}</a></td></tr>`;
    })
    .join('');
  return {
    html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 18px;">${html}</table>`,
    text: usable.map((l) => `${plain(l.label)}:\n  ${safeUrl(l.href, { label: l.label })}`).join('\n'),
  };
}

export function urlFallback(url: string, label = 'If the button does not work, paste this address into your browser:'): Block {
  const safe = safeUrl(url, { label: 'Fallback link' });
  return {
    html: `<p style="margin:0 0 6px;font-size:13px;line-height:1.6;color:${PALETTE.sub};">${escapeHtml(text(label))}</p><p class="seai-url" style="margin:0 0 18px;font-family:${MONO};font-size:12px;line-height:1.6;color:${PALETTE.sub};word-break:break-all;">${escapeHtml(safe)}</p>`,
    text: `${plain(label)}\n${safe}`,
  };
}

export function preheaderBlock(value: string): Block {
  const hidden = escapeHtml(text(value).replace(/\n/g, ' '));
  return {
    html: `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;height:0;width:0;">${hidden}</div><div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>`,
    text: '',
  };
}

// Brand mark: a text wordmark, never a remote image.
//
// A hosted image proved unreliable in real inboxes — mail clients fetch remote
// images through a proxy that refuses cross-origin-restricted assets, which
// rendered as a broken-image placeholder. A styled wordmark cannot fail, loads
// instantly on mobile, and matches the monochrome product identity.
function logoBlock(): Block {
  return {
    html: `<p style="margin:0;font-size:15px;line-height:1;font-weight:700;letter-spacing:.22em;color:${PALETTE.ink};">SEAI</p>`,
    text: 'SEAI',
  };
}

function footerBlock(): Block {
  const support = config.mailSupportEmail;
  const year = new Date().getFullYear();
  const html = [
    `<tr><td style="padding:8px 0 0;"><div style="height:1px;line-height:1px;font-size:0;background:${PALETTE.border};">&nbsp;</div></td></tr>`,
    `<tr><td style="padding:22px 0 0;text-align:left;">`,
    `<p style="margin:0 0 12px;font-size:13px;line-height:1.6;color:${PALETTE.sub};">Questions? Reply to this email.</p>`,
    `<p style="margin:0;font-size:12px;line-height:1.6;color:${PALETTE.faint};">SEAI &middot; <a href="${escapeAttr(supportMailto())}" style="color:${PALETTE.faint};text-decoration:underline;">${escapeHtml(support)}</a> &middot; <a href="${escapeAttr(privacyUrl())}" style="color:${PALETTE.faint};text-decoration:underline;">Privacy</a> &middot; <a href="${escapeAttr(termsUrl())}" style="color:${PALETTE.faint};text-decoration:underline;">Terms</a></p>`,
    `</td></tr>`,
  ].join('');
  const plain = [
    `Questions? Reply to this email.`,
    '',
    `SEAI · ${support}`,
    `Privacy: ${privacyUrl()}`,
    `Terms: ${termsUrl()}`,
  ].join('\n');
  return { html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${html}</table>`, text: plain };
}

const HEAD_STYLE = `
    body{margin:0;padding:0;width:100%!important;background:${PALETTE.page};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
    table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0;}
    img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;}
    a{color:${PALETTE.sub};}
    .seai-cta{display:inline-block!important;}
    @media only screen and (max-width:600px){
      .seai-pad{padding:26px 20px 34px!important;}
      .seai-card{padding:15px 15px 2px!important;}
      .seai-cta{display:block!important;width:100%!important;text-align:center!important;box-sizing:border-box!important;padding:16px 20px!important;}
      .seai-h1{font-size:22px!important;line-height:1.28!important;letter-spacing:-.01em!important;}
      .seai-label{letter-spacing:.14em!important;}
      .seai-url{word-break:break-all!important;}
    }
  `;

export interface DocumentSpec {
  preheader: string;
  blocks: Block[];
  reason: string;
  title: string;
}

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

function buildText(spec: DocumentSpec): string {
  const parts: string[] = [wrapPlain(spec.preheader), ''];
  for (const block of spec.blocks) {
    const value = block.text.trim();
    if (!value) continue;
    parts.push(value, '');
  }
  parts.push(footerBlock().text);
  return `${parts.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function renderDocument(spec: DocumentSpec): RenderedEmail {
  const pre = preheaderBlock(spec.preheader);
  const logo = logoBlock();
  const body = spec.blocks
    .map((b) => b.html)
    .filter(Boolean)
    .join('');
  const inner = [logo.html, `<tr><td style="padding:30px 0 0;">`, body, `</td></tr>`].join('');
  const html = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="dark" />
<meta name="supported-color-schemes" content="dark" />
<meta name="format-detection" content="telephone=no,date=no,address=no,email=no" />
<title>${escapeHtml(subjectSafe(spec.title))}</title>
<!--[if mso]><style type="text/css">body,table,td{font-family:${FONT};}table{border-collapse:collapse;}</style><![endif]-->
<style>${HEAD_STYLE}</style>
</head>
<body style="margin:0;padding:0;background:${PALETTE.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(subjectSafe(spec.preheader))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:${PALETTE.page};">
<tr><td align="center" style="padding:0;">
<table role="presentation" width="${WIDTH}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${WIDTH}px;border-collapse:collapse;">
<tr><td class="seai-pad" style="padding:36px 32px 44px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
${pre.html}
${inner}
${footerBlock().html}
</table>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
  return {
    subject: subjectSafe(spec.title),
    preheader: stripControl(spec.preheader).replace(/\n/g, ' ').trim(),
    html,
    text: buildText(spec),
  };
}

export const brandPalette = PALETTE;
export const brandFont = FONT;
export const brandMono = MONO;
