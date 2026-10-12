import type { Block } from './design.js';
import type { EmailContext, EmailVariable } from './context.js';

export type EmailCategory =
  | 'account'
  | 'website'
  | 'change'
  | 'maintenance'
  | 'payment'
  | 'service'
  | 'internal';

export interface EmailTemplateDef {
  name: string;
  category: EmailCategory;
  subject: string;
  preheader: string;
  reason: string;
  required: EmailVariable[];
  optional: EmailVariable[];
  wired: boolean;
  trigger: string;
  build: (ctx: EmailContext) => Block[];
}

export const DEFAULT_REASON =
  'You are receiving this service email because you have a SEAI account and this message relates to it.';
