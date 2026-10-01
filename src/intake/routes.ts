import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { db } from '../db/db.js';
import { config } from '../config.js';
import { storage, storageErrorMessage } from '../storage/client.js';
import { dispatchRenderedEmail } from '../mail/dispatch.js';
import { buildIntakeReportBlocks, shown, shownList, INTERNAL_INTAKE_SUBJECT, type IntakeFileView } from './report.js';
import { dashboardUrl } from '../mail/urls.js';

// Public intake intake endpoint, called by the seai.store intake form.
//
// Order of operations is deliberate: validate -> persist -> resolve assets ->
// report -> send. The intake row is written BEFORE any mail work, so a provider
// outage can never lose a client's submission.
export const intakeRouter = Router();

const MAX_TEXT = 8000;
const MAX_FILES = 12;

// Fixed-window rate limit. Every accepted intake emails the operations inbox,
// so submissions are capped per client IP.
const WINDOW_MS = 60 * 60 * 1000;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= config.intakeRateLimitPerHour) {
    hits.set(key, list);
    return true;
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

const str = (max: number) => z.string().max(max).optional().default('');
const listOf = z.array(z.string().max(200)).max(40).optional().default([]);

const fileSchema = z.object({
  fileId: z.string().min(1).max(120),
  slot: z.string().max(40).optional().default('other'),
});

const intakeSchema = z.object({
  // Client-generated so a double submit / retry cannot create two intakes.
  idempotencyKey: z.string().min(8).max(120),
  submittedAt: z.string().max(60).optional(),

  clientName: str(160),
  businessName: z.string().min(1, 'Business name is required').max(160),
  email: z.string().email('A valid email is required'),
  phone: str(60),
  whatsapp: str(60),
  instagram: str(160),
  existingSite: str(300),
  domain: str(253),

  businessType: str(120),
  industry: str(120),
  location: str(160),
  whatYouDo: str(MAX_TEXT),
  targetCustomers: str(MAX_TEXT),
  businessDescription: str(MAX_TEXT),
  sellingPoints: str(MAX_TEXT),
  goals: str(MAX_TEXT),

  preferredStyle: str(200),
  preferredColors: str(200),
  preferredTypography: str(200),
  pagesRequested: listOf,
  featuresRequested: listOf,
  references: str(MAX_TEXT),
  competitors: str(MAX_TEXT),
  specialInstructions: str(MAX_TEXT),

  // Free-form supplied copy. Kept verbatim: the report never truncates it.
  content: z.record(z.union([z.string().max(MAX_TEXT), z.array(z.string().max(400)).max(60)]))
    .optional()
    .default({}),

  plan: str(80),
  amount: str(40),
  intakeSession: str(120),
  files: z.array(fileSchema).max(MAX_FILES).optional().default([]),
});

const CONTENT_LABELS: [string, string][] = [
  ['headlines', 'Headlines'],
  ['headline', 'Headlines'],
  ['about', 'About / business description'],
  ['services', 'Services'],
  ['products', 'Products'],
  ['pricing', 'Pricing'],
  ['contact', 'Contact information'],
  ['social', 'Social links'],
  ['testimonials', 'Testimonials'],
  ['faqs', 'FAQs'],
  ['copy', 'Other supplied copy'],
  ['other', 'Other supplied copy'],
];

function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function typeLabel(mime: string, filename: string): string {
  const m = String(mime || '').toLowerCase();
  const ext = String(filename || '').split('.').pop()?.toLowerCase() ?? '';
  if (m.startsWith('image/')) return `Image (${ext.toUpperCase() || 'image'})`;
  if (m === 'application/pdf') return 'PDF document';
  if (m.includes('word') || ext === 'doc' || ext === 'docx') return 'Word document';
  if (m.includes('sheet') || m.includes('excel') || ext === 'xls' || ext === 'xlsx' || ext === 'csv') return 'Spreadsheet';
  if (m.startsWith('text/')) return 'Text file';
  if (m.startsWith('video/')) return 'Video';
  return ext ? ext.toUpperCase() : 'File';
}

/** Resolves each uploaded file against real storage records. */
async function resolveFiles(
  intakeId: string,
  scopeCustomerId: string,
  files: { fileId: string; slot: string }[],
): Promise<IntakeFileView[]> {
  const views: IntakeFileView[] = [];
  for (const f of files) {
    let filename = f.fileId;
    let mime = '';
    let size = 0;
    let href: string | null = null;
    let lookupError: string | null = null;

    try {
      const meta = await storage.getFile({ customerId: scopeCustomerId }, f.fileId);
      if (meta.status === 200 && meta.body) {
        const file = meta.body.file ?? meta.body;
        filename = String(file.original_filename ?? file.filename ?? f.fileId);
        mime = String(file.mime_type ?? file.content_type ?? '');
        size = Number(file.size_bytes ?? file.size ?? 0) || 0;
      } else {
        lookupError = storageErrorMessage(meta, 'Not available in storage');
      }
    } catch (err) {
      lookupError = (err as Error).message === 'Storage service is not configured'
        ? 'Storage not configured'
        : 'Storage unavailable';
    }

    // Signed link for internal use. Rendered as a labelled action, never as
    // visible URL text.
    try {
      const dl = await storage.downloadUrl({ customerId: scopeCustomerId }, f.fileId);
      if (dl.status === 200) {
        const url = dl.body?.url ?? dl.body?.download_url ?? dl.body?.signed_url;
        if (typeof url === 'string' && /^https:\/\//.test(url)) href = url;
      }
    } catch {
      /* no signed link available; metadata is still reported */
    }

    await db.insert('intake_files', {
      id: randomUUID(),
      intake_id: intakeId,
      storage_file_id: f.fileId,
      slot: f.slot,
      filename,
      mime_type: mime,
      size_bytes: size,
      category: f.slot === 'logo' ? 'logo' : f.slot === 'photos' ? 'image' : 'intake_attachment',
      content_type_label: typeLabel(mime, filename),
      lookup_error: lookupError,
      created_at: new Date().toISOString(),
    }).catch(() => undefined);

    views.push({
      filename,
      slot: f.slot,
      contentTypeLabel: typeLabel(mime, filename),
      sizeBytes: size,
      sizeLabel: humanSize(size),
      href,
    });
  }
  return views;
}

intakeRouter.post('/intake', async (req: Request, res: Response) => {
  const ip = String(req.ip ?? req.socket.remoteAddress ?? 'unknown');

  // Honeypot: a real browser never fills a hidden field.
  const parsed = intakeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ ok: false, error: parsed.error.errors[0]?.message ?? 'Invalid submission' });
    return;
  }
  if (String((req.body as Record<string, unknown>)?.website ?? '') !== '') {
    res.status(202).json({ ok: true, received: true });
    return;
  }
  if (rateLimited(ip)) {
    res.status(429).json({ ok: false, error: 'Too many submissions. Please try again later.' });
    return;
  }

  const d = parsed.data;
  const now = new Date();
  const intakeId = randomUUID();

  // seai.store stores intake uploads under `intake:<session>` but hands the
  // browser a bare session id. Accept either spelling so the two deployments
  // do not have to agree on the storage scope format; getting this wrong would
  // silently resolve every attachment as "not available in storage".
  const rawSession = d.intakeSession.trim();
  const scopeCustomerId = rawSession
    ? rawSession.startsWith('intake:') ? rawSession : `intake:${rawSession}`
    : `intake:${intakeId}`;

  // 1. Persist first. Nothing after this point can lose the submission.
  //
  // `idempotency_key` is UNIQUE, but db.insert() issues ON CONFLICT DO NOTHING
  // and hands back the input row instead of throwing, so a replayed submission
  // is NOT detectable from a failed insert. It has to be looked up explicitly,
  // otherwise the retry would be answered with a fresh reference and would do
  // all of the file/report work a second time.
  const alreadyAccepted = await db
    .list('intakes', { idempotency_key: d.idempotencyKey }, 1)
    .catch(() => []);
  if (alreadyAccepted.length > 0) {
    res.status(200).json({ ok: true, duplicate: true });
    return;
  }

  const row = {
    id: intakeId,
    idempotency_key: d.idempotencyKey,
    status: 'received',
    submitted_at: d.submittedAt ? new Date(d.submittedAt).toISOString() : now.toISOString(),
    client_name: d.clientName.trim(),
    business_name: d.businessName.trim(),
    email: d.email.trim().toLowerCase(),
    phone: d.phone.trim(),
    whatsapp: d.whatsapp.trim(),
    instagram: d.instagram.trim(),
    existing_site: d.existingSite.trim(),
    domain: d.domain.trim(),
    business_type: d.businessType.trim(),
    industry: d.industry.trim(),
    location: d.location.trim(),
    what_you_do: d.whatYouDo.trim(),
    target_customers: d.targetCustomers.trim(),
    business_description: d.businessDescription.trim(),
    selling_points: d.sellingPoints.trim(),
    goals: d.goals.trim(),
    preferred_style: d.preferredStyle.trim(),
    preferred_colors: d.preferredColors.trim(),
    preferred_typography: d.preferredTypography.trim(),
    pages_requested: JSON.stringify(d.pagesRequested ?? []),
    features_requested: JSON.stringify(d.featuresRequested ?? []),
    reference_links: d.references.trim(),
    competitors: d.competitors.trim(),
    special_instructions: d.specialInstructions.trim(),
    content: JSON.stringify(d.content ?? {}),
    plan: d.plan.trim(),
    amount: d.amount.trim(),
    intake_session: d.intakeSession.trim(),
    storage_scope: scopeCustomerId,
    report_status: 'pending',
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  };

  try {
    await db.insert('intakes', row);
    // Close the race between the lookup above and this insert: if a concurrent
    // request won the unique key, our row was not stored and this submission is
    // a replay, not a new client.
    const stored = await db.list('intakes', { idempotency_key: d.idempotencyKey }, 1).catch(() => []);
    if (stored.length > 0 && stored[0].id !== intakeId) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
  } catch (err) {
    // Unique violation on the idempotency key means this exact intake was
    // already accepted: report success, send nothing.
    if (String((err as Error).message).includes('duplicate') || String((err as Error).message).includes('unique')) {
      res.status(200).json({ ok: true, duplicate: true });
      return;
    }
    res.status(500).json({ ok: false, error: 'Could not save your submission. Please try again.' });
    return;
  }

  // 2. Assets: resolve against real storage records.
  let files: IntakeFileView[] = [];
  try {
    files = await resolveFiles(intakeId, scopeCustomerId, d.files ?? []);
  } catch {
    files = [];
  }

  // 3. Build the internal report from the persisted row (never browser state).
  const contentPairs: [string, unknown][] = [];
  for (const [key, label] of CONTENT_LABELS) {
    if (key in d.content) {
      const value = (d.content as Record<string, unknown>)[key];
      contentPairs.push([label, Array.isArray(value) ? shownList(value) : shown(value)]);
    }
  }
  if (d.businessDescription.trim()) contentPairs.push(['About / business description', d.businessDescription]);

  const subject = INTERNAL_INTAKE_SUBJECT.replace('{{business_name}}', d.businessName.trim() || 'New client');
  const blocks = buildIntakeReportBlocks({
    submittedAtLabel: new Date(row.submitted_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }),
    business: [
      ['Business type', d.businessType],
      ['Industry', d.industry],
      ['Location', d.location],
      ['What they sell / offer', d.whatYouDo],
      ['Target customers', d.targetCustomers],
      ['Business description', d.businessDescription],
      ['Unique selling points', d.sellingPoints],
      ['Goals for the website', d.goals],
      ['Email', d.email],
      ['Phone', d.phone],
      ['WhatsApp', d.whatsapp],
      ['Instagram', d.instagram],
      ['Existing website', d.existingSite],
      ['Domain', d.domain],
    ],
    direction: [
      ['Style / aesthetic', d.preferredStyle],
      ['Preferred colours', d.preferredColors],
      ['Typography', d.preferredTypography],
      ['Pages requested', shownList(d.pagesRequested)],
      ['Features requested', shownList(d.featuresRequested)],
      ['References / inspiration', d.references],
      ['Competitor / reference sites', d.competitors],
      ['Special instructions', d.specialInstructions],
    ],
    content: contentPairs,
    files,
    plan: d.plan,
    amount: d.amount,
    clientName: d.clientName,
    businessName: d.businessName,
    intakeRef: intakeId.slice(0, 8).toUpperCase(),
    dashboardUrl: dashboardUrl(),
  });

  // 4. Send to the internal operations inbox. Idempotent on the intake key.
  const result = await dispatchRenderedEmail({
    eventName: 'internal.intake_report',
    to: config.opsInbox,
    subject,
    preheader: `${d.businessName || 'New client'} submitted a website intake.`,
    blocks,
    dedupeKey: `intake:${d.idempotencyKey}`,
    correlationId: intakeId,
  });

  // 5. Record delivery on the intake row.
  await db.update('intakes', intakeId, {
    report_status: result.status,
    report_event_id: result.eventId,
    report_delivery_id: result.deliveryId,
    report_message_id: result.messageId ?? null,
    report_error: result.reason ?? null,
    updated_at: new Date().toISOString(),
  }).catch(() => undefined);

  // The client never learns where the internal report went, or that it failed.
  res.status(201).json({ ok: true, reference: intakeId.slice(0, 8).toUpperCase() });
});
