import { z } from 'zod';

// Product sourcing connector architecture.
// SEAI never invents suppliers or availability. A catalog is grounded by exactly one of:
//   1. manual import (this file) — user/system supplies real product data rows
//   2. a future SourcingProvider (PIM/ERP/supplier API) implementing the interface below
// Without grounded rows, the creation pipeline builds strategy+brand but flags
// catalog as awaiting a legitimate product source.
export interface SourcingProvider {
  name: string;
  fetchProducts(input: { market: string; limit: number }): Promise<SourcedRow[]>;
}

export interface SourcedRow {
  title: string;
  descriptionHtml?: string;
  vendor?: string;
  productType?: string;
  tags?: string;
  price?: string;
  openingStock?: number;
  collection?: string;
}

export const SourcedRowSchema = z.object({
  title: z.string().min(2).max(200),
  descriptionHtml: z.string().max(20000).optional(),
  vendor: z.string().max(100).optional(),
  productType: z.string().max(100).optional(),
  tags: z.string().max(500).optional(),
  price: z.string().regex(/^\d+(\.\d{1,2})?$/, 'price must be a plain number like 29.99').optional(),
  openingStock: z.number().int().min(0).max(100000).optional(),
  collection: z.string().max(100).optional(),
});

export function validateImport(rows: unknown): { ok: boolean; rows?: SourcedRow[]; error?: string } {
  if (!Array.isArray(rows) || !rows.length) return { ok: false, error: 'rows must be a non-empty array' };
  if (rows.length > 100) return { ok: false, error: 'max 100 rows per import' };
  const out: SourcedRow[] = [];
  for (let i = 0; i < rows.length; i++) {
    const p = SourcedRowSchema.safeParse(rows[i]);
    if (!p.success) return { ok: false, error: `row ${i}: ${p.error.message.slice(0, 200)}` };
    out.push(p.data);
  }
  return { ok: true, rows: out };
}
