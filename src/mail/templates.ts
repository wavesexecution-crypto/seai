// SEAI transactional email templates. Plain inline-styled HTML for
// maximum client compatibility. No secrets or tokens in logs — only in
// the message body addressed to the account owner.

const BRAND_HEAD = `<div style="font-size:16px;font-weight:700;letter-spacing:.04em;margin-bottom:24px;">SEAI</div>`;
const WRAP_OPEN = `<div style="max-width:520px;margin:0 auto;padding:40px 24px;">`;
const SUB = `color:#a1a1aa;font-size:14px;line-height:1.6;`;
const BTN = `display:inline-block;background:#f4f4f5;color:#0a0a0b;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;`;
const PAGE = (inner: string) =>
  `<!doctype html><html><body style="margin:0;padding:0;background:#0a0a0b;color:#f4f4f5;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;">${WRAP_OPEN}${BRAND_HEAD}${inner}</div></body></html>`;

export function passwordResetEmail(resetUrl: string): { subject: string; html: string; text: string } {
  const subject = 'Reset your SEAI password';
  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#0a0a0b;color:#f4f4f5;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif;">
<div style="max-width:520px;margin:0 auto;padding:40px 24px;">
<div style="font-size:16px;font-weight:700;letter-spacing:.04em;margin-bottom:24px;">SEAI</div>
<h1 style="font-size:22px;margin:0 0 12px;">Reset your SEAI password</h1>
<p style="color:#a1a1aa;font-size:14px;line-height:1.6;">Someone requested a password reset for your SEAI account. Click the button below to choose a new password. This link expires in <strong>1 hour</strong> and can only be used once.</p>
<p style="margin:28px 0;"><a href="${resetUrl}" style="display:inline-block;background:#f4f4f5;color:#0a0a0b;font-weight:600;font-size:14px;padding:12px 24px;border-radius:8px;text-decoration:none;">Reset password</a></p>
<p style="color:#a1a1aa;font-size:13px;line-height:1.6;">If the button does not work, copy and paste this link into your browser:<br><span style="word-break:break-all;">${resetUrl}</span></p>
<p style="color:#63636b;font-size:12px;line-height:1.6;margin-top:28px;">If you did not request this, you can safely ignore this email — your password will not change.</p>
</div></body></html>`;
  const text = `SEAI — Reset your SEAI password\n\nSomeone requested a password reset for your SEAI account. Open this link to choose a new password (expires in 1 hour, one-time use):\n\n${resetUrl}\n\nIf you did not request this, ignore this email — your password will not change.`;
  return { subject, html, text };
}

export function welcomeEmail(name: string, loginUrl: string) {
  const subject = 'Welcome to SEAI';
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">Welcome to SEAI, ${name}</h1>
<p style="${SUB}">Your account is ready. Sign in to see your website's performance, request changes, and manage maintenance.</p>
<p style="margin:28px 0;"><a href="${loginUrl}" style="${BTN}">Open your dashboard</a></p>`);
  const text = `SEAI — Welcome, ${name}\n\nYour account is ready. Open your dashboard:\n\n${loginUrl}`;
  return { subject, html, text };
}

export function websiteReadyEmail(siteName: string, domain: string, dashboardUrl: string) {
  const subject = 'Your website is live';
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">${siteName} is live</h1>
<p style="${SUB}">Your website at <strong>${domain}</strong> is deployed. Open your SEAI dashboard any time to check performance, request changes, or manage maintenance.</p>
<p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">Open your dashboard</a></p>`);
  const text = `SEAI — ${siteName} is live at ${domain}.\n\nOpen your dashboard:\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function changeRequestReceivedEmail(title: string, page: string, priority: string, dashboardUrl: string) {
  const subject = 'We received your website change request';
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">We received your request</h1>
<p style="${SUB}">“${title}”${page ? ` on <strong>${page}</strong>` : ''} (priority: ${priority}). SEAI is reviewing it — replies appear in your dashboard.</p>
<p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">View request</a></p>`);
  const text = `SEAI — change request received: "${title}"${page ? ` on ${page}` : ''} (priority: ${priority}).\n\nView it:\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function changeRequestCompletedEmail(title: string, dashboardUrl: string) {
  const subject = 'Your website change is complete';
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">Change completed</h1>
<p style="${SUB}">“${title}” has been updated and deployed. Take a look at your website.</p>
<p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">View request</a></p>`);
  const text = `SEAI — change completed: "${title}" has been updated and deployed.\n\nView it:\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function maintenanceActivatedEmail(planName: string, priceInr: number, dashboardUrl: string) {
  const subject = `Maintenance requested: ${planName}`;
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">Maintenance activation requested</h1>
<p style="${SUB}">${planName} (₹${Number(priceInr).toLocaleString('en-IN')} / month) is <strong>pending payment</strong>. Complete payment to activate — nothing has been charged.</p>
<p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">Manage maintenance</a></p>`);
  const text = `SEAI — maintenance activation requested: ${planName} (Rs.${priceInr} / month), pending payment. Nothing has been charged.\n\nManage it:\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function orderUnderwayEmail(businessName: string, planName: string, dashboardUrl: string) {
  const subject = 'Your SEAI website is underway';
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">Your website is underway, ${businessName}</h1>
<p style="${SUB}">You selected the <strong>${planName}</strong> plan. Here is what happens next: SEAI builds your website, you review a preview, then it goes live. Most websites are delivered within 5–7 business days.</p>
<p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">Open your dashboard</a></p>
<p style="color:#63636b;font-size:12px;line-height:1.6;">This email confirms your order only — build updates follow as work progresses.</p>`);
  const text = `SEAI — Your website is underway, ${businessName}\n\nPlan: ${planName}.\n\nWhat happens next: SEAI builds your website, you review a preview, then it goes live (usually 5-7 business days).\n\nOpen your dashboard:\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function performanceUpdateEmail(siteName: string, periodLabel: string, rows: { label: string; value: string }[], dashboardUrl: string) {
  const subject = 'Your SEAI website performance update';
  const body = rows.length
    ? `<div style="margin:20px 0;">${rows.map((r) => `<div style="display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);font-size:14px;"><span style="color:#a1a1aa;">${r.label}</span><strong>${r.value}</strong></div>`).join('')}</div><p style="color:#63636b;font-size:12px;">Reporting period: ${periodLabel}. Figures come straight from your connected analytics.</p>`
    : `<p style="${SUB}">Analytics is not connected for ${siteName}, so there are no metrics to report yet. Connect Google Analytics in your dashboard to start receiving website data.</p><p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">Connect analytics</a></p>`;
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">Performance update</h1>${body}`);
  const text = rows.length
    ? `SEAI — performance update for ${siteName} (${periodLabel}):\n${rows.map((r) => `- ${r.label}: ${r.value}`).join('\n')}\n\nOpen your dashboard:\n\n${dashboardUrl}`
    : `SEAI — performance update for ${siteName}:\n\nAnalytics is not connected, so there are no metrics yet. Connect Google Analytics in your dashboard:\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function maintenanceReminderEmail(planName: string, priceInr: number, nextBillingDate: string, dashboardUrl: string) {
  const subject = 'Your SEAI maintenance renewal is coming up';
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">Maintenance renewal reminder</h1>
<p style="${SUB}">${planName} renews on <strong>${nextBillingDate}</strong> for <strong>₹${Number(priceInr).toLocaleString('en-IN')} / month</strong>. No action is needed if your payment method is current.</p>
<p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">Manage maintenance</a></p>`);
  const text = `SEAI — maintenance renewal reminder:\n\n${planName} renews on ${nextBillingDate} for Rs.${priceInr} / month. No action needed if your payment method is current.\n\nManage maintenance:\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function waitingForClientEmail(title: string, missing: string, dashboardUrl: string) {
  const subject = 'SEAI needs a little more information';
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">Quick question on your request</h1>
<p style="${SUB}">For “${title}” we need a little more information before continuing:</p>
<p style="font-size:14px;line-height:1.6;">${missing}</p>
<p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">Reply in your dashboard</a></p>`);
  const text = `SEAI — we need a little more information for "${title}":\n\n${missing}\n\nReply in your dashboard:\n\n${dashboardUrl}`;
  return { subject, html, text };
}

export function coldOutreachEmail(businessName: string, issue: string) {
  const subject = `A better website for ${businessName}`;
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">A better website for ${businessName}</h1>
<p style="${SUB}">Hi — I looked at ${businessName} online and noticed ${issue}. First impressions now happen on Google before anyone walks in, and a slow or missing site quietly sends customers elsewhere.</p>
<p style="${SUB}">SEAI builds premium one-page business websites in about a week — copy, design, domain, and launch handled, with an owner dashboard for changes and maintenance afterwards.</p>
<p style="${SUB}">Would you like a free homepage mockup for ${businessName}? Reply “yes” and I will send one over.</p>
<p style="color:#63636b;font-size:12px;">— SEAI · workwithseai@gmail.com</p>`);
  const text = `A better website for ${businessName}\n\nHi — I looked at ${businessName} online and noticed ${issue}.\n\nSEAI builds premium one-page business websites in about a week: copy, design, domain, and launch handled, plus an owner dashboard for changes and maintenance.\n\nWant a free homepage mockup for ${businessName}? Reply "yes" and I'll send one over.\n\n— SEAI · workwithseai@gmail.com`;
  const whatsapp = `Hi ${businessName}! I noticed ${issue} — quick one: SEAI builds premium business websites in ~a week (design + copy + launch handled). Want a free homepage mockup? No charge, no catch. — SEAI`;
  return { subject, html, text, whatsapp };
}

export function maintenancePaymentIssueEmail(planName: string, dashboardUrl: string) {
  const subject = `Action needed: maintenance payment for ${planName}`;
  const html = PAGE(`<h1 style="font-size:22px;margin:0 0 12px;">Payment needs attention</h1>
<p style="${SUB}">There is a payment issue with ${planName}. Update payment to keep maintenance active and avoid interruption.</p>
<p style="margin:28px 0;"><a href="${dashboardUrl}" style="${BTN}">Fix payment</a></p>`);
  const text = `SEAI — payment issue with ${planName}. Update payment to keep maintenance active.\n\nFix it:\n\n${dashboardUrl}`;
  return { subject, html, text };
}
