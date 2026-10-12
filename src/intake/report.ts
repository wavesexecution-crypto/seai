// Internal client-intake report.
//
// This is NOT a customer email. It is an operations briefing for the SEAI team
// who will build the site, so it is laid out for scanning: one labelled block
// per intake section, every client answer preserved, and nothing technical
// leaking through (no ids, no storage plumbing, no raw payloads).
//
// Renders through the same premium design system as every customer email.

import { cta, heading, infoBlock, note, paragraph, statusBadge } from '../mail/design.js';
import type { Block, InfoRow } from '../mail/design.js';
import { config } from '../config.js';

export const NOT_PROVIDED = 'Not provided';

export function shown(value: unknown): string {
  const s = String(value ?? '').trim();
  return s.length ? s : NOT_PROVIDED;
}

export function shownList(values: unknown): string {
  if (Array.isArray(values)) {
    const clean = values.map((v) => String(v ?? '').trim()).filter(Boolean);
    return clean.length ? clean.join(', ') : NOT_PROVIDED;
  }
  return shown(values);
}

function rows(pairs: [string, unknown][]): InfoRow[] {
  return pairs.map(([label, value]) => ({ label, value: shown(value) }));
}

export interface IntakeFileView {
  filename: string;
  slot: string;
  contentTypeLabel: string;
  sizeBytes: number;
  sizeLabel: string;
  href: string | null;
}

export interface IntakeReportInput {
  submittedAtLabel: string;
  business: [string, unknown][];
  direction: [string, unknown][];
  content: [string, unknown][];
  files: IntakeFileView[];
  plan: string;
  amount: string;
  clientName: string;
  businessName: string;
  intakeRef: string;
  dashboardUrl: string;
}

export function buildIntakeReportBlocks(input: IntakeReportInput): Block[] {
  const blocks: Block[] = [];

  blocks.push(statusBadge('Client intake received', 'positive'));
  blocks.push(heading('New website project received'));
  blocks.push(
    paragraph(
      `${input.businessName || input.clientName || 'A new client'} has completed the website intake. Everything below is what they submitted.`,
    ),
  );

  blocks.push(
    infoBlock('Client', [
      ...rows([
        ['Name', input.clientName],
        ['Business', input.businessName],
      ]),
      { label: 'Submitted', value: shown(input.submittedAtLabel) },
    ]),
  );

  blocks.push(heading('Business'));
  blocks.push(infoBlock(null, rows(input.business)));

  blocks.push(heading('Website direction'));
  blocks.push(infoBlock(null, rows(input.direction)));

  blocks.push(heading('Content supplied'));
  if (input.content.length === 0) {
    blocks.push(paragraph(`No copy was supplied — ${NOT_PROVIDED.toLowerCase()}.`));
  } else {
    blocks.push(infoBlock(null, rows(input.content)));
  }

  blocks.push(heading('Uploaded files'));
  if (input.files.length === 0) {
    blocks.push(paragraph('No files uploaded.'));
  } else {
    for (const f of input.files) {
      const detail: InfoRow[] = [
        { label: 'Type', value: f.contentTypeLabel },
        { label: 'Size', value: f.sizeLabel },
        { label: 'Category', value: f.slot },
      ];
      if (f.href) {
        detail.push({ label: 'File', value: 'Open file', href: f.href });
      }
      blocks.push(infoBlock(f.filename, detail));
    }
  }

  blocks.push(heading('Delivery'));
  blocks.push(
    infoBlock(null, [
      { label: 'Plan', value: shown(input.plan) },
      { label: 'Amount', value: shown(input.amount) },
      { label: 'Expected first demo', value: 'Demo site' },
      { label: 'Demo environment', value: config.demoUrl },
      { label: 'Reference', value: input.intakeRef },
    ]),
  );
  blocks.push(cta('Open client dashboard', input.dashboardUrl));
  blocks.push(note('Ready for the production build. Ask the client anything missing in the dashboard thread.'));
  return blocks;
}

export const INTERNAL_INTAKE_SUBJECT = 'Client intake received — {{business_name}}';
