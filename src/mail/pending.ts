import { config } from '../config.js';

// Serverless-safe background work.
//
// On a long-running Node host a fire-and-forget promise keeps running after the
// HTTP response. On Vercel the function is frozen the moment the response is
// written, so an unawaited SMTP send dies mid-flight. That is exactly how
// production email got stuck in `sending` with no provider message id.
//
// Every fire-and-forget send in notify.ts registers here, and the HTTP layer
// calls `drainPendingMail()` before responding. That keeps the sends off the
// response path in spirit (a mail failure can never fail the request) while
// guaranteeing they actually complete on a serverless runtime.

type Task = () => Promise<unknown>;

const pending = new Set<Promise<unknown>>();

export function trackPendingMail(task: Task): Promise<unknown> {
  const settled = task()
    .catch((err) => {
      // A mail failure must never surface as a request failure.
      console.error('[mail] background send failed:', (err as Error)?.message);
    })
    .finally(() => {
      pending.delete(settled);
    });
  pending.add(settled);
  return settled;
}

export function pendingMailCount(): number {
  return pending.size;
}

export async function drainPendingMail(timeoutMs?: number): Promise<void> {
  if (pending.size === 0) return;
  const budget = timeoutMs ?? Number(config.mailDrainTimeoutMs ?? 8000);
  const work = Promise.allSettled([...pending]);
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, budget);
    if (typeof timer.unref === 'function') timer.unref();
  });
  try {
    await Promise.race([work, cap]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
