import { pino, type Logger } from 'pino';
import type { LogLevel } from './config.js';

export type AppLogger = Logger;

/**
 * Structured logger foundation (pino). Every log record automatically carries
 * the service name; per-request context (request id, store, latency) is added
 * by the middleware layer at request time.
 */
export function createLogger(logLevel: LogLevel): AppLogger {
  return pino({
    name: 'seai-shopify-gateway',
    level: logLevel,
  });
}