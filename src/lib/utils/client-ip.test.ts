import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isIpLiteral,
  parseXForwardedFor,
  resolveClientIp,
  resolveIntakeRateLimitIp,
  resolveTrustedProxyMode,
} from "./client-ip";

test("intake rate limit keys on the visitor IP reported by the key-holding marketing server", () => {
  const r = reqWith({ "x-intake-client-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1" });
  assert.equal(resolveIntakeRateLimitIp(r), "203.0.113.9");
});

test("intake rate limit ignores a non-IP reported value and falls back to the peer IP", () => {
  const r = reqWith({ "x-intake-client-ip": "evil; drop", "x-forwarded-for": "10.0.0.1" });
  assert.equal(resolveIntakeRateLimitIp(r), resolveClientIp(r));
});

function reqWith(headers: Record<string, string | null>) {
  return {
    headers: {
      get(name: string): string | null {
        return headers[name.toLowerCase()] ?? null;
      },
    },
  } as unknown as Parameters<typeof resolveClientIp>[0];
}

function withTrustedProxy(env: Record<string, string | undefined>) {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(env)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  return () => {
    for (const key of Object.keys(env)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
}

test("ip literals parsed correctly", () => {
  assert.equal(isIpLiteral("203.0.113.42"), true);
  assert.equal(isIpLiteral("1.2.3.4"), true);
  assert.equal(isIpLiteral(" 203.0.113.42 "), true);
  assert.equal(isIpLiteral("999.1.1.1"), false);
  assert.equal(isIpLiteral("1.2.3"), false);
  assert.equal(isIpLiteral("not-an-ip"), false);
  assert.equal(isIpLiteral(""), false);
  assert.equal(isIpLiteral("2001:db8::1"), true);
  assert.equal(isIpLiteral("[2001:db8::1]"), true);
  assert.equal(isIpLiteral("garbage:xyz"), false);
});

test("parseXForwardedFor splits comma list", () => {
  assert.deepEqual(parseXForwardedFor("1.2.3.4, 203.0.113.9"), ["1.2.3.4", "203.0.113.9"]);
  assert.deepEqual(parseXForwardedFor(null), []);
});

test("cloud-run mode trusts only the rightmost XFF element", () => {
  const restore = withTrustedProxy({ TRUSTED_PROXY: "cloud-run" });
  try {
    assert.equal(resolveTrustedProxyMode(), "cloud-run");

    // GFE appended the peer IP at the END; client-supplied values sit left.
    const req = reqWith({
      "x-forwarded-for": "6.7.8.9, 10.0.0.1, 203.0.113.42",
    });
    assert.equal(resolveClientIp(req), "203.0.113.42");

    // Spoofing a rightmost junk value cannot win.
    const spoofed = reqWith({ "x-forwarded-for": "1.1.1.1, 'evil', 99.98.97.96" });
    assert.equal(resolveClientIp(spoofed), "99.98.97.96");
  } finally {
    restore();
  }
});

test("cloud-run mode falls back to x-real-ip when no XFF", () => {
  const restore = withTrustedProxy({ TRUSTED_PROXY: "cloud-run" });
  try {
    const req = reqWith({ "x-real-ip": "198.51.100.5" });
    assert.equal(resolveClientIp(req), "198.51.100.5");
  } finally {
    restore();
  }
});

test("none mode (default) uses first XFF value as a correlation token only", () => {
  const restore = withTrustedProxy({ TRUSTED_PROXY: "none" });
  try {
    assert.equal(resolveTrustedProxyMode(), "none");
    const req = reqWith({ "x-forwarded-for": "198.51.100.5, 203.0.113.42" });
    assert.equal(resolveClientIp(req), "198.51.100.5");
  } finally {
    restore();
  }
});

test("unknown when no usable IP header", async () => {
  const restore = withTrustedProxy({ TRUSTED_PROXY: "none" });
  try {
    const req = reqWith({ "x-forwarded-for": "" });
    assert.equal(resolveClientIp(req), "unknown");
  } finally {
    restore();
  }
});