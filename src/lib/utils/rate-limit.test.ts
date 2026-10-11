import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UpstashRestBackend,
  consumeRateLimit,
  configuredBackend,
  rateLimitHeaders,
  resetRateLimitBackendForTests,
} from "./rate-limit";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("memory limiter allows up to limit then blocks", async () => {
  resetRateLimitBackendForTests();
  const windowMs = 60_000;
  const key = "test:seq";

  const first = await consumeRateLimit(key, 2, windowMs);
  assert.equal(first.allowed, true);
  assert.equal(first.remaining, 1);

  const second = await consumeRateLimit(key, 2, windowMs);
  assert.equal(second.allowed, true);
  assert.equal(second.remaining, 0);

  const third = await consumeRateLimit(key, 2, windowMs);
  assert.equal(third.allowed, false);
  assert.equal(third.remaining, 0);
});

test("memory limiter window resets", async () => {
  resetRateLimitBackendForTests();
  const windowMs = 30;
  const key = "test:window-reset";

  await consumeRateLimit(key, 1, windowMs);
  assert.equal((await consumeRateLimit(key, 1, windowMs)).allowed, false);

  await sleep(40);
  assert.equal((await consumeRateLimit(key, 1, windowMs)).allowed, true, "new window should allow");
});

test("keys are isolated per rate-limit bucket", async () => {
  resetRateLimitBackendForTests();
  await consumeRateLimit("test:bucket-a", 1, 60_000);
  assert.equal((await consumeRateLimit("test:bucket-a", 1, 60_000)).allowed, false);
  assert.equal((await consumeRateLimit("test:bucket-b", 1, 60_000)).allowed, true);
});

test("rateLimitHeaders carries retry-after and counters", () => {
  const resetAt = Date.now() + 5_000;
  const headers = rateLimitHeaders({ allowed: false, remaining: 0, limit: 3, resetAt });
  assert.equal(headers["Retry-After"], "5");
  assert.equal(headers["X-RateLimit-Limit"], "3");
  assert.equal(headers["X-RateLimit-Remaining"], "0");
  assert.equal(headers["X-RateLimit-Reset"], String(Math.ceil(resetAt / 1000)));
});

test("upstash backend issues INCR+EXPIRE pipeline and parses TTL", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  const mockFetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify([[3], [55]]), { status: 200 });
  }) as unknown as typeof fetch;

  const backend = new UpstashRestBackend("https://rate-limit.example/", "token123", mockFetch);
  const result = await backend.consume("rate:test", 60_000);

  assert.equal(calls.length, 1);
  const firstCall = calls[0];
  assert.ok(firstCall);
  assert.equal(firstCall.url, "https://rate-limit.example/pipeline");
  const auth = (firstCall.init.headers as Record<string, string>).Authorization;
  assert.equal(auth, "Bearer token123");

  const body = JSON.parse(String(firstCall.init.body));
  assert.deepEqual(body[0], ["INCR", "rate:test"]);
  assert.deepEqual(body[1], ["EXPIRE", "rate:test", 60]);

  assert.equal(result.count, 3);
  assert.ok(result.resetAt > Date.now() + 50_000);
});

test("backend failure degrades to in-memory (fail open, never bricks traffic)", async () => {
  resetRateLimitBackendForTests();
  const previous = {
    store: process.env.RATE_LIMIT_STORE,
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  };
  try {
    process.env.RATE_LIMIT_STORE = "upstash";
    process.env.UPSTASH_REDIS_REST_URL = "https://down.example";
    process.env.UPSTASH_REDIS_REST_TOKEN = "token";
    resetRateLimitBackendForTests();

    assert.ok(configuredBackend() instanceof UpstashRestBackend);

    const decision = await consumeRateLimit("test:degraded", 1, 60_000);
    assert.equal(decision.allowed, true, "must fail open when backend is down");
    assert.equal(decision.limit, 1);
  } finally {
    process.env.RATE_LIMIT_STORE = previous.store;
    process.env.UPSTASH_REDIS_REST_URL = previous.url;
    process.env.UPSTASH_REDIS_REST_TOKEN = previous.token;
    resetRateLimitBackendForTests();
  }
});