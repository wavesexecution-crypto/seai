import { renderDocument, type Block, type RenderedEmail } from './design.js';
import {
  buildContext,
  fillVars,
  unresolvedVars,
  EMAIL_VARIABLES,
  type EmailContext,
  type EmailVariable,
} from './context.js';
import { assertNoSecrets, subjectSafe } from './safety.js';
import type { EmailTemplateDef } from './types.js';
import { accountTemplates } from './templates/account.js';
import { websiteTemplates } from './templates/website.js';
import { changeTemplates, changeStatusTemplate } from './templates/change.js';
import { maintenanceTemplates } from './templates/maintenance.js';
import { paymentTemplates } from './templates/payment.js';
import { serviceTemplates } from './templates/service.js';
import { internalTemplates } from './templates/internal.js';

export const TEMPLATES: EmailTemplateDef[] = [
  ...accountTemplates,
  ...websiteTemplates,
  ...changeTemplates,
  ...maintenanceTemplates,
  ...paymentTemplates,
  ...serviceTemplates,
  ...internalTemplates,
];

export const TEMPLATE_BY_NAME: Map<string, EmailTemplateDef> = new Map(TEMPLATES.map((t) => [t.name, t]));

const VAR_RE = /\{\{[^}]*\}\}/g;

export class EmailRenderError extends Error {
  readonly template: string;
  readonly code: string;
  constructor(template: string, code: string, message: string) {
    super(message);
    this.name = 'EmailRenderError';
    this.template = template;
    this.code = code;
  }
}

export function listTemplates(): EmailTemplateDef[] {
  return TEMPLATES;
}

export function getTemplate(name: string): EmailTemplateDef {
  const found = TEMPLATE_BY_NAME.get(name);
  if (!found) throw new EmailRenderError(name, 'TEMPLATE_UNKNOWN', `Unknown email template: ${name}`);
  return found;
}

export function templateNames(): string[] {
  return TEMPLATES.map((t) => t.name);
}

export function templateForChangeStatus(status: string): EmailTemplateDef | null {
  const mapped = changeStatusTemplate[status];
  return mapped ? TEMPLATE_BY_NAME.get(mapped.name) ?? null : null;
}

export interface RenderResult extends RenderedEmail {
  template: string;
  subjectSource: string;
  context: EmailContext;
}

export interface RenderOptions {
  strict?: boolean;
  skipSecretScan?: boolean;
}

function collectBlockVars(blocks: Block[], into: Set<string>): void {
  for (const block of blocks) {
    for (const source of [block.html, block.text]) {
      for (const v of unresolvedVars(source)) into.add(v);
    }
  }
}

export function renderTemplate(name: string, patch: Partial<EmailContext> = {}, options: RenderOptions = {}): RenderResult {
  const def = getTemplate(name);
  const strict = options.strict !== false;
  const ctx = buildContext(patch);

  const missing = def.required.filter((key) => !String(ctx[key] ?? '').trim());
  if (missing.length > 0) {
    throw new EmailRenderError(
      name,
      'MISSING_VARIABLE',
      `Template ${name} is missing required variables: ${missing.join(', ')}`,
    );
  }

  const blocks = def.build(ctx);

  const referenced = new Set<string>();
  collectBlockVars(blocks, referenced);
  for (const source of [def.subject, def.preheader, def.reason]) {
    for (const v of unresolvedVars(source)) referenced.add(v);
  }
  for (const variable of referenced) {
    if (!(EMAIL_VARIABLES as readonly string[]).includes(variable)) {
      throw new EmailRenderError(name, 'UNKNOWN_VARIABLE', `Template ${name} references unknown variable {{${variable}}}`);
    }
  }

  const subjectSource = def.subject;
  const subject = subjectSafe(fillVars(subjectSource, ctx, { escape: (v) => v.replace(/[\r\n<>]/g, '') }));
  const preheader = subjectSafe(fillVars(def.preheader, ctx, { escape: (v) => v.replace(/[\r\n<>]/g, ' ') }));
  const reason = fillVars(def.reason, ctx);

  const rendered = renderDocument({ preheader, blocks, reason, title: subject });
  const html = strict ? rendered.html : rendered.html.replace(VAR_RE, '');
  if (/\{\{[^}]*\}\}/.test(html)) {
    throw new EmailRenderError(name, 'UNRESOLVED_VARIABLE', `Template ${name} rendered unresolved variables`);
  }
  if (/\{\{[^}]*\}\}/.test(rendered.text)) {
    throw new EmailRenderError(name, 'UNRESOLVED_VARIABLE', `Template ${name} rendered unresolved variables in plain text`);
  }

  if (!options.skipSecretScan) {
    assertNoSecrets(html, `${name} html`);
    assertNoSecrets(rendered.text, `${name} text`);
  }

  return { ...rendered, html, subject, template: name, subjectSource, context: ctx };
}

export { changeStatusTemplate };
export type { EmailTemplateDef, EmailCategory } from './types.js';
export { DEFAULT_REASON } from './types.js';
export type { EmailContext, EmailVariable };
