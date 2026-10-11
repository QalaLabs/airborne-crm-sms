const DEFAULT_PER_MINUTE = 480;

function perMinuteLimit(): number {
  const raw = process.env.INTERAKT_RATE_LIMIT_PER_MINUTE?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : DEFAULT_PER_MINUTE;
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_PER_MINUTE;
  return Math.min(parsed, 600);
}

/** In-process token bucket — caps burst per Cloud Run instance. */
export class InteraktRateLimiter {
  private tokens: number;
  private lastRefillMs: number;
  private readonly maxTokens: number;
  private readonly refillPerMs: number;

  constructor(maxPerMinute = perMinuteLimit()) {
    this.maxTokens = Math.max(1, Math.floor(maxPerMinute / 6));
    this.tokens = this.maxTokens;
    this.lastRefillMs = Date.now();
    this.refillPerMs = maxPerMinute / 60_000;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefillMs;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillPerMs);
    this.lastRefillMs = now;
  }

  async acquire(): Promise<void> {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

let sharedLimiter: InteraktRateLimiter | null = null;

export function getInteraktRateLimiter(): InteraktRateLimiter {
  if (!sharedLimiter) sharedLimiter = new InteraktRateLimiter();
  return sharedLimiter;
}

/** Test-only reset. */
export function resetInteraktRateLimiterForTests(): void {
  sharedLimiter = null;
}
