import { randomUUID } from 'node:crypto';
import type { Request, RequestHandler, Response } from 'express';
import type { AppLogger } from '../logger.js';

declare global {
  namespace Express {
    interface Request {
      /**
       * Correlates every log/audit record for a request. Set by the ledger
       * middleware; valued in later phases (sessions, proxy, webhooks).
       */
      requestId: string;
    }
  }
}

/** Per-request audit context attached to `res.locals` by the ledger middleware. */
export interface RequestLocals {
  requestId: string;
}

/**
 * Ledger foundation: assigns every request a unique `requestId` (honouring an
 * incoming `x-request-id` header when present), stamps `x-request-id` on the
 * response, and emits one structured access-log line per completed request.
 *
 * Later phases extend this into a durable audit ledger (persisting policy-gated
 * tool actions + SEAI identity) — see implementation plan §5/§16.
 */
export function createLedgerMiddleware(logger: AppLogger): RequestHandler {
  return (req: Request, res: Response, next) => {
    const incoming = req.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && incoming.trim().length > 0
        ? incoming.trim()
        : randomUUID();

    req.requestId = requestId;
    res.locals = { ...res.locals, requestId } as RequestLocals;
    res.setHeader('X-Request-Id', requestId);

    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info(
        {
          requestId,
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
          ip: req.ip,
        },
        'request completed',
      );
    });
    next();
  };
}