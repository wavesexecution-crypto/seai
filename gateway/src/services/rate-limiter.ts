/**
 * Per-key rate limiter (token bucket). Used for per-shop GraphQL proxy
 * limits and for the global auth/webhook surface.
 *
 * Safe for horizontal scaling ONLY when backed by a shared counter store
 * (Redis). The in-memory bucket is a per-instance limit — sufficient for the
 * single-instance local/dev path; production deployments must run with a
 * shared store to keep limits exact across replicas.
 *
 * When a bucket is exhausted, `take()` returns a positive `retryAfterSeconds`
 * so the caller can emit `Retry-After` correctly.
 */

export class RateLimitExceededError extends Error {
  override readonly name = 'RateLimitExceededError';
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number) {
    super(`Rate limit exceeded; retry in ${retryAfterSeconds}s`);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export interface BucketStore {
  take(key: string, cost: number, nowMs: number): { allowed: boolean; retryAfterSeconds: number };
}

/** Fixed-size token bucket: refills `ratePerMinute / 60` tokens per second. */
export class TokenBucketStore implements BucketStore {
  private readonly buckets = new Map<string, { tokens: number; lastRefillMs: number }>();

  constructor(private readonly capacity: number, private readonly refillPerSecond: number) {}

  take(key: string, cost = 1, nowMs = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const now = nowMs;
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefillMs: now };
      this.buckets.set(key, bucket);
    }
    const elapsedMs = now - bucket.lastRefillMs;
    const refill = Math.min(this.capacity, (elapsedMs / 1000) * this.refillPerSecond);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + refill);
    bucket.lastRefillMs = now;
    if (bucket.tokens < cost) {
      const retryAfterMs = Math.ceil((this.capacity / this.refillPerSecond) * 1000);
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }
    bucket.tokens -= cost;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  size(): number {
    return this.buckets.size;
  }
}

export function createRateLimiter(perMinute: number): TokenBucketStore {
  return new TokenBucketStore(perMinute, perMinute / 60);
}