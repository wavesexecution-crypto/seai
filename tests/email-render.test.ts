import { describe, it, expect } from 'vitest';
import {
  renderTemplate,
  listTemplates,
  getTemplate,
  templateNames,
  templateForChangeStatus,
  EmailRenderError,
} from '../src/mail/registry.js';
import { PREVIEW_FIXTURES, previewContext } from '../src/mail/fixtures.js';
import {
  assertNoSecrets,
  findSecrets,
  escapeHtml,
  escapeAttr,
  safeUrl,
  isSafeUrl,
  isUnsafeHost,
  redactSecrets,
  subjectSafe,
  stripControl,
  EmailSafetyError,
} from '../src/mail/safety.js';
import { dashboardUrl, websiteUrl, changeRequestUrl, supportUrl, privacyUrl, termsUrl } from '../src/mail/urls.js';

describe('template registry', () => {
  it('exposes 31 templates with unique names and non-empty subjects', () => {
    const all = listTemplates();
    expect(all).toHaveLength(31);
    expect(new Set(all.map((t) => t.name)).size).toBe(31);
    for (const def of all) {
      expect(def.subject.trim(), def.name).not.toBe('');
      expect(def.preheader.trim(), def.name).not.toBe('');
      expect(def.wired === true || def.wired === false).toBe(true);
    }
  });

  it('marks the internal/reserved templates as unwired', () => {
    const reserved = listTemplates().filter((t) => !t.wired).map((t) => t.name).sort();
    expect(reserved).toEqual([
      'account.new_sign_in_alert',
      'maintenance.payment_reminder',
      'report.performance',
      'sales.cold_outreach',
      'website.domain_manage',
    ]);
  });

  it('has exactly one fixture per template', () => {
    const fixtureTemplates = PREVIEW_FIXTURES.map((f) => f.template).sort();
    const templateNames = listTemplates().map((t) => t.name).sort();
    expect(fixtureTemplates).toEqual(templateNames);
  });

  it('renders every template into html and text without unresolved placeholders', () => {
    for (const fixture of PREVIEW_FIXTURES) {
      const out = renderTemplate(fixture.template, previewContext(fixture.context));
      expect(out.subject.trim(), fixture.name).not.toBe('');
      expect(out.html.length, fixture.name).toBeGreaterThan(2000);
      expect(out.text.length, fixture.name).toBeGreaterThan(200);
      expect(out.html, fixture.name).not.toMatch(/\{\{|\}\}/);
      expect(out.text, fixture.name).not.toMatch(/\{\{|\}\}/);
      expect(out.text, fixture.name).not.toContain('<');
    }
  });

  it('rejects an unknown template name', () => {
    expect(() => getTemplate('does.not.exist')).toThrow(EmailRenderError);
    expect(templateNames()).toHaveLength(31);
    expect(() => renderTemplate('does.not.exist', {})).toThrow(EmailRenderError);
  });

  it('maps change statuses to their templates', () => {
    expect(templateForChangeStatus('submitted')?.name).toBe('change.received');
    expect(templateForChangeStatus('reviewing')?.name).toBe('change.reviewing');
    expect(templateForChangeStatus('in_progress')?.name).toBe('change.in_progress');
    expect(templateForChangeStatus('waiting_for_client')?.name).toBe('change.waiting_for_client');
    expect(templateForChangeStatus('completed')?.name).toBe('change.completed');
    expect(templateForChangeStatus('nonsense')).toBeNull();
  });

  it('fails when a required variable is missing', () => {
    expect(() => renderTemplate('account.password_reset', previewContext({ reset_url: '' }))).toThrow(/reset_url/);
    expect(() => renderTemplate('change.received', previewContext({ request_id: '' }))).toThrow(/request_id/);
  });

  it('rejects a URL variable that is not a safe production link', () => {
    expect(() => renderTemplate('account.password_reset', previewContext({ reset_url: 'http://localhost:3000/reset?token=x' }))).toThrow(EmailSafetyError);
    expect(() => renderTemplate('account.password_reset', previewContext({ reset_url: 'javascript:alert(1)' }))).toThrow(EmailSafetyError);
  });

  it('strips control characters from customer copy', () => {
    const out = renderTemplate('account.welcome', previewContext({ customer_name: 'Aarav Sharma\u0007\u001b[31m' }));
    expect(out.html).toContain('Aarav Sharma');
    expect(out.html).not.toContain('\u001b');
    expect(out.html).not.toContain('\u0007');
  });

  it('keeps a subject on one line', () => {
    const out = renderTemplate('account.welcome', previewContext({ customer_name: 'Aarav\r\nBcc: victim@example.com' }));
    expect(out.subject).not.toMatch(/[\r\n]/);
    expect(subjectSafe('Welcome\u0000 to SEAI')).not.toContain('\u0000');
  });
});

describe('html and plain-text safety', () => {
  it('escapes hostile input in html and strips tags from plain text', () => {
    const hostile = '<script>alert("x")</script>"><img src=x onerror=alert(1)>';
    const out = renderTemplate('change.received', previewContext({ request_title: hostile, request_summary: hostile }));
    expect(out.html).not.toContain(hostile);
    expect(out.html).toContain('&lt;script&gt;');
    expect(out.html).not.toMatch(/href\s*=\s*["']javascript:/i);
    expect(out.text).not.toMatch(/<script/i);
    expect(out.text).not.toContain(hostile);
  });

  it('escapes html and attribute characters', () => {
    expect(escapeHtml('<b>"x"</b>')).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
    expect(escapeAttr('a"b\'c')).toBe('a&quot;b&#39;c');
  });

  it('blocks secret material in rendered content but tolerates ordinary copy', () => {
    expect(() => assertNoSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz')).toThrow(EmailSafetyError);
    expect(() => assertNoSecrets('MAIL_SMTP_PASS=supersecret1')).toThrow(EmailSafetyError);
    expect(() => assertNoSecrets('If the button does not work, paste this address into your browser:')).not.toThrow();
    expect(findSecrets('copy this link into your browser')[0]?.confidence).toBe('low');
  });

  it('redacts secrets in log output', () => {
    const redacted = redactSecrets('failed for AKIA0123456789ABCDEF');
    expect(redacted).toContain('[redacted:aws_key]');
    expect(redacted).not.toContain('AKIA0123456789ABCDEF');
  });

  it('strips control characters and flags private hosts', () => {
    expect(stripControl('a\u0000b\u001bc')).toBe('abc');
    expect(isUnsafeHost('localhost')).toBe(true);
    expect(isUnsafeHost('127.0.0.1')).toBe(true);
    expect(isUnsafeHost('192.168.1.10')).toBe(true);
    expect(isUnsafeHost('10.0.0.1')).toBe(true);
    expect(isUnsafeHost('seai.store')).toBe(false);
    expect(isSafeUrl('https://seai.store/privacy')).toBe(true);
    expect(isSafeUrl('http://seai.store/privacy')).toBe(false);
  });
});

describe('url builders', () => {
  it('builds production urls', () => {
    expect(dashboardUrl('/overview')).toBe('https://dash.seai.store/overview');
    expect(websiteUrl('sharmadental.example.com')).toBe('https://sharmadental.example.com/');
    expect(changeRequestUrl('req_1')).toBe('https://dash.seai.store/modify?id=req_1');
    expect(supportUrl()).toMatch(/^https:\/\/seai\.store\//);
    expect(privacyUrl()).toMatch(/privacy/);
    expect(termsUrl()).toMatch(/terms/);
  });

  it('rejects javascript, data, relative, and private links', () => {
    expect(() => safeUrl('javascript:alert(1)')).toThrow(EmailSafetyError);
    expect(() => safeUrl('data:text/html,<script>')).toThrow(EmailSafetyError);
    expect(() => safeUrl('/relative')).toThrow(EmailSafetyError);
    expect(() => safeUrl('http://localhost:3000/x')).toThrow(EmailSafetyError);
    expect(() => safeUrl('https://user:pass@seai.store/x')).toThrow(EmailSafetyError);
  });
});
