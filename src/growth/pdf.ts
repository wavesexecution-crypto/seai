/**
 * PDF text extraction for lead import.
 *
 * Honesty contract: this uses pdf-parse for TEXT-LAYER extraction only.
 * Scanned PDFs (image-only pages) yield no text and are rejected with a clear
 * error — SEAI does not have OCR in this build and never pretends to.
 */
// Import the inner module: the package's index.js runs debug-mode file
// access when loaded without a CommonJS parent (breaks under ESM/vitest).
// @ts-expect-error no type declarations for the inner path
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

export interface PdfExtraction {
  text: string;
  pages: number;
}

export class ScannedPdfError extends Error {
  constructor() {
    super('This PDF has no extractable text — it appears to be scanned images. OCR is not enabled on this system, so the file cannot be imported. Upload a text-based PDF or a CSV export instead.');
    this.name = 'ScannedPdfError';
  }
}

const MIN_TEXT_CHARS = 24;

export async function extractPdfText(buffer: Buffer): Promise<PdfExtraction> {
  let result: { text?: string; numpages?: number };
  try {
    result = await pdfParse(buffer);
  } catch (err) {
    throw new Error(`Could not parse this PDF (${String((err as Error)?.message ?? err).slice(0, 120)}). The file may be corrupt, password-protected, or not a real PDF.`);
  }
  const text = String(result.text ?? '').trim();
  if (text.length < MIN_TEXT_CHARS) throw new ScannedPdfError();
  return { text, pages: result.numpages ?? 0 };
}

export interface PdfLeadRow {
  business_name: string;
  phone?: string;
  email?: string;
  location?: string;
  raw: string;
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}|\+\d{1,3}[\s-]?\d{6,12}|\b\d{10}\b/;

/**
 * Heuristic per-line parser for lead-list PDFs. A line becomes a record when
 * it carries at least one machine-identifiable signal (email or phone).
 */
export function parseLeadLines(text: string): { rows: PdfLeadRow[]; skipped: number } {
  const rows: PdfLeadRow[] = [];
  let skipped = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length < 6) { skipped += 1; continue; }
    const email = line.match(EMAIL_RE)?.[0];
    const phone = line.match(PHONE_RE)?.[0]?.replace(/[\s-]/g, '');
    if (!email && !phone) { skipped += 1; continue; }
    let name = line
      .replace(EMAIL_RE, '')
      .replace(PHONE_RE, '')
      .replace(/[|,;\t•]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
      .replace(/^[-–—\s]+|[-–—\s]+$/g, '');
    if (name.length > 120) name = name.slice(0, 120).trim();
    if (!name) { skipped += 1; continue; }
    rows.push({ business_name: name, phone, email, raw: line.slice(0, 300) });
  }
  return { rows, skipped };
}
