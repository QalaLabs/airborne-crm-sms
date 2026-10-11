/**
 * Pluggable rate limiter (F04 fix).
 *
 * Backends:
 *   - memory (default): per-process Map with a fixed window. Safe for
 *     development and for burst protection on a single warm instance, but NOT
 *     shared across Cloud Run instances. Only used in production when no
 *     distributed store is configured.
 *   - upstash: distributed fixed-window limits shared across all instances,
 *     via the Upstash REST API (HTTPS `fetch`, pipeline of `INCR` + `EXPIRE`).
 *     No extra dependency is required. Enabled automatically when
 *     UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are configured
 *     (RATE_LIMIT_STORE=auto), or explicitly via RATE_LIMIT_STORE=upstash.
 *
 * Failure policy: if the configured backend throws, the request FAILS OPEN by
 * degrading to the in-memory backend and logging — rate limiting must never
 * lock legitimate traffic out because the store went down.
 */

import { NextResponse } from "next/server";

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: number; // epoch ms
}

interface RateLimitBackend {
  consume(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;
}

// ─── In-memory backend ────────────────────────────────────────────────────────

const memoryStore = new Map<string, { count: number; resetAt: number }>();

const MEMORY_MAX_KEYS = 5_000;

function memoryConsume(key: string, windowMs: number): { count: number; resetAt: number } {
  const now = Date.now();

  if (memoryStore.size > MEMORY_MAX_KEYS) {
    for (const [k, v] of memoryStore) {
      if (v.resetAt <= now) memoryStore.delete(k);
    }
  }

  const entry = memoryStore.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryStore.set(key, { count: 1, resetAt: now + windowMs });
    return { count: 1, resetAt: now + windowMs };
  }

  entry.count += 1;
  return { count: entry.count, resetAt: entry.resetAt };
}

const memoryBackend: RateLimitBackend = {
  consume: async (key, windowMs) => memoryConsume(key, windowMs),
};

// ─── Upstash REST backend ─────────────────────────────────────────────────────

export class UpstashRestBackend implements RateLimitBackend {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(url: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = url.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  async consume(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const seconds = Math.max(1, Math.ceil(windowMs / 1000));
    const response = await this.fetchImpl(`${this.baseUrl}/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        ["INCR", key],
        ["EXPIRE", key, seconds],
      ]),
    });

    if (!response.ok) {
      throw new Error(`Upstash rate-limit backend responded ${response.status}`);
    }

    const rows = (await response.json()) as unknown;
    const countRow = Array.isArray(rows) ? rows[0] : undefined;
    const ttlRow = Array.isArray(rows) ? rows[1] : undefined;
    const count = Array.isArray(countRow) && typeof countRow[0] === "number" ? countRow[0] : 1;
    const ttl =
      Array.isArray(ttlRow) && typeof ttlRow[0] === "number" && ttlRow[0] > 0
        ? ttlRow[0]
        : seconds;
    return { count, resetAt: Date.now() + ttl * 1000 };
  }
}

// ─── Backend selection ────────────────────────────────────────────────────────

/** Resolve the backend from env, or null for the in-memory default. */
export function configuredBackend(
  env: NodeJS.ProcessEnv = process.env,
): RateLimitBackend | null {
  const store = (env.RATE_LIMIT_STORE ?? "auto").trim().toLowerCase();
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();

  const wantsDistributed =
    store === "auto" || store === "upstash" || store === "redis" || store === "rest";

  if (wantsDistributed && url && token) {
    return new UpstashRestBackend(url, token);
  }
  if (store === "upstash" && (!url || !token)) {
    console.warn(
      "[rate-limit] RATE_LIMIT_STORE=upstash requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN. Falling back to in-memory.",
    );
  }
  return null;
}

let activeBackend: RateLimitBackend | undefined;

function getBackend(): RateLimitBackend {
  if (activeBackend === undefined) {
    activeBackend = configuredBackend() ?? memoryBackend;
  }
  return activeBackend;
}

/** Re-resolve the backend from env — used by tests and config reloads. */
export function resetRateLimitBackendForTests(): void {
  activeBackend = undefined;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function consumeRateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitDecision> {
  const backend = getBackend();
  let window: { count: number; resetAt: number };
  try {
    window = await backend.consume(key, windowMs);
  } catch (err) {
    console.error(
      `[rate-limit] backend failed; degraded to in-memory for key '${key}'`,
      err instanceof Error ? err.message : err,
    );
    window = memoryConsume(key, windowMs);
  }
  return {
    allowed: window.count <= limit,
    remaining: Math.max(0, limit - window.count),
    limit,
    resetAt: window.resetAt,
  };
}

export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  return {
    "Retry-After": String(Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000))),
    "X-RateLimit-Limit": String(decision.limit),
    "X-RateLimit-Remaining": String(decision.remaining),
    "X-RateLimit-Reset": String(Math.ceil(decision.resetAt / 1000)),
  };
}

export type RateLimitOk = { ok: true };
export type RateLimitBlocked = { ok: false; response: NextResponse };

export async function enforceRateLimit(input: {
  key: string;
  limit: number;
  windowMs: number;
  message?: string;
}): Promise<RateLimitOk | RateLimitBlocked> {
  const decision = await consumeRateLimit(input.key, input.limit, input.windowMs);
  if (decision.allowed) return { ok: true };
  return {
    ok: false,
    response: NextResponse.json(
      { error: input.message ?? "Too many requests. Please try again later." },
      { status: 429, headers: rateLimitHeaders(decision) },
    ),
  };
}