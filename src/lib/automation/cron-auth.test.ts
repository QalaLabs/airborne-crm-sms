import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyCronSecret } from "./cron-auth";
import {
  CRON_AUTOMATION_PATH,
  isCronAutomationPath,
  shouldRunSessionMiddleware,
} from "./cron-paths";

const SECRET = "test-cron-secret-value";

type CronReq = Pick<import("next/server").NextRequest, "headers">;

function mockReq(headers: Record<string, string> = {}): CronReq {
  return {
    headers: {
      get(name: string) {
        const key = Object.keys(headers).find((h) => h.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : null;
      },
    } as Headers,
  };
}

test("only /api/cron/automation skips session middleware", () => {
  assert.equal(isCronAutomationPath(CRON_AUTOMATION_PATH), true);
  assert.equal(shouldRunSessionMiddleware(CRON_AUTOMATION_PATH), false);
  assert.equal(shouldRunSessionMiddleware("/api/cron/other"), true);
  assert.equal(shouldRunSessionMiddleware("/api/v1/workflows"), true);
  assert.equal(shouldRunSessionMiddleware("/whatsapp/inbox"), true);
});

test("no CRON_SECRET configured is rejected", () => {
  const result = verifyCronSecret(mockReq({ authorization: "Bearer anything" }), "");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure, "missing_config");
});

test("missing credential is rejected", () => {
  const result = verifyCronSecret(mockReq(), SECRET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure, "missing_credential");
});

test("wrong CRON_SECRET is rejected", () => {
  const result = verifyCronSecret(mockReq({ authorization: "Bearer wrong-secret" }), SECRET);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure, "invalid_credential");
});

test("correct Bearer CRON_SECRET is accepted", () => {
  const result = verifyCronSecret(mockReq({ authorization: `Bearer ${SECRET}` }), SECRET);
  assert.equal(result.ok, true);
});

test("correct x-cron-secret header is accepted", () => {
  const result = verifyCronSecret(mockReq({ "x-cron-secret": SECRET }), SECRET);
  assert.equal(result.ok, true);
});

test("cron automation route handler rejects without secret", async () => {
  const prev = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    const { POST } = await import("@/app/api/cron/automation/route");
    const res = await POST(mockReq() as import("next/server").NextRequest);
    assert.equal(res.status, 403);
  } finally {
    if (prev !== undefined) process.env.CRON_SECRET = prev;
  }
});

test("cron automation route handler accepts valid secret", async () => {
  const prev = process.env.CRON_SECRET;
  process.env.CRON_SECRET = SECRET;
  try {
    const { POST } = await import("@/app/api/cron/automation/route");
    const res = await POST(
      mockReq({ authorization: `Bearer ${SECRET}` }) as import("next/server").NextRequest,
    );
    assert.notEqual(res.status, 401);
    assert.notEqual(res.status, 403);
    const body = (await res.json()) as { ok?: boolean; error?: string };
    assert.equal(body.ok, true);
  } finally {
    if (prev !== undefined) process.env.CRON_SECRET = prev;
    else delete process.env.CRON_SECRET;
  }
});
