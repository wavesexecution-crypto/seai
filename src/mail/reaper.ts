import { dispatchEmail, isValidRecipient } from './dispatch.js';
import {
  claimStaleEvent,
  decodeReapableVariables,
  hasSentDelivery,
  listStaleSendEvents,
  MAX_ATTEMPTS,
  NOT_REAPABLE_TEMPLATES,
  type EmailEventRecord,
} from './store.js';

// Recovers transactional email lost to a serverless freeze.
//
// On Vercel the function can be frozen between writing a delivery row and
// finishing the SMTP handshake. The delivery is then orphaned in
// `queued`/`sending` forever, because nothing re-drives it: the business event
// that produced it is one-shot (`account.welcome`, `change.received`) and will
// never re-fire, and `resolveExisting` only re-claims a key that is presented
// again.
//
// This sweep is the missing reaper. It finds events stuck past STALE_SEND_MS,
// takes each one with a compare-and-set (so two concurrent sweeps cannot both
// send), and re-dispatches it through the *normal* path with the original
// dedupe key. Re-dispatch therefore reuses all existing idempotency, rendering
// and delivery-logging semantics rather than a parallel implementation.
//
// Safety:
// - The sweep is bounded per invocation.
// - Events that exhausted MAX_ATTEMPTS are marked failed, never retried.
// - Templates whose variables embed a single-use token are never reapplied.
// - Nothing about a recipient, variable value, or rendered body is logged.

export interface ReapOptions {
  /** Maximum events to attempt in one sweep. */
  limit?: number;
  /** Injected in tests; defaults to the real dispatcher. */
  dispatch?: typeof dispatchEmail;
}

export interface ReapResult {
  scanned: number;
  recovered: string[];
  skipped: { id: string; reason: string }[];
  exhausted: string[];
}

/**
 * One bounded pass. Returns a summary; never throws for an individual event.
 */
export async function reapStaleSends(options: ReapOptions = {}): Promise<ReapResult> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 25));
  const send = options.dispatch ?? dispatchEmail;
  const result: ReapResult = { scanned: 0, recovered: [], skipped: [], exhausted: [] };

  const stale = await listStaleSendEvents(limit);
  result.scanned = stale.length;

  for (const event of stale) {
    // Compare-and-set first: whoever flips queued/sending -> failed owns the retry.
    if (!(await claimStaleEvent(event))) {
      result.skipped.push({ id: event.id, reason: 'claimed_by_another_worker' });
      continue;
    }

    // The authoritative duplicate guard: a successful delivery already exists for
    // this event, so no matter what its current status says, never send again.
    if (await hasSentDelivery(event.id)) {
      result.skipped.push({ id: event.id, reason: 'already_delivered' });
      continue;
    }

    if (NOT_REAPABLE_TEMPLATES.has(event.template)) {
      result.skipped.push({ id: event.id, reason: 'template_not_reapable' });
      continue;
    }
    if (!isValidRecipient(event.recipient)) {
      result.skipped.push({ id: event.id, reason: 'invalid_recipient' });
      continue;
    }
    if (Number(event.attempts ?? 0) >= MAX_ATTEMPTS) {
      result.exhausted.push(event.id);
      continue;
    }

    const variables = decodeReapableVariables(event.variables);
    if (!Object.keys(variables).length) {
      // Nothing to reconstruct from, so the event is terminal rather than
      // repeatedly re-attempted with an incomplete render.
      result.skipped.push({ id: event.id, reason: 'no_stored_variables' });
      continue;
    }

    try {
      const dispatched = await send({
        eventName: event.event_name,
        template: event.template,
        to: event.recipient,
        variables: variables as never,
        customerId: event.customer_id ?? null,
        // The original key: the unique index still guarantees one event per send.
        dedupeKey: event.dedupe_key,
        correlationId: event.correlation_id ?? null,
      });
      if (dispatched.status === 'sent') result.recovered.push(event.id);
      else if (dispatched.status === 'duplicate') result.skipped.push({ id: event.id, reason: 'already_delivered' });
      else if (dispatched.status === 'skipped') result.skipped.push({ id: event.id, reason: dispatched.reason ?? 'skipped' });
      else result.skipped.push({ id: event.id, reason: dispatched.status });
    } catch (err) {
      // The dispatcher is contractually non-throwing; guard anyway so one bad
      // event cannot abort the rest of the sweep.
      result.skipped.push({ id: event.id, reason: `dispatch_error:${(err as Error)?.message ?? 'unknown'}`.slice(0, 120) });
    }
  }

  return result;
}

/** Summarises a sweep for logging. Contains ids and reasons only — no addresses, variables or bodies. */
export function describeReapResult(r: ReapResult): string {
  const parts = [`scanned=${r.scanned}`, `recovered=${r.recovered.length}`, `skipped=${r.skipped.length}`];
  if (r.exhausted.length) parts.push(`exhausted=${r.exhausted.length}`);
  return parts.join(' ');
}
