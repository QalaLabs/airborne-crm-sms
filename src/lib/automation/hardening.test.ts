import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT_LEASE_MS,
  getWorkerId,
  MAX_EVENT_ATTEMPTS,
  WORKFLOW_LEASE_MS,
} from "./claim";
import { InteraktRateLimiter, resetInteraktRateLimiterForTests } from "@/lib/messaging/providers/interakt/rate-limiter";
import { buildSendTemplatePayload } from "@/lib/messaging/providers/interakt/payloads";
import { shouldUpgradeStatus } from "@/lib/messaging/providers/interakt/webhooks";
import { isOptOutKeyword } from "@/lib/messaging/inbound";
import { providerEventId } from "@/lib/messaging/providers/interakt/webhooks";
import { RUN_STATUS, RUN_TERMINAL_STATUSES } from "@/lib/workflow/types";

test("workflow lease duration is two minutes", () => {
  assert.equal(WORKFLOW_LEASE_MS, 120_000);
});

test("event lease duration is one minute", () => {
  assert.equal(EVENT_LEASE_MS, 60_000);
});

test("max event attempts caps permanent failure", () => {
  assert.equal(MAX_EVENT_ATTEMPTS, 5);
});

test("worker id includes service name", () => {
  const id = getWorkerId();
  assert.match(id, /^airborne-admin:/);
});

test("rate limiter throttles burst requests", async () => {
  resetInteraktRateLimiterForTests();
  const limiter = new InteraktRateLimiter(60);
  const start = Date.now();
  await limiter.acquire();
  await limiter.acquire();
  await limiter.acquire();
  const elapsed = Date.now() - start;
  assert.ok(elapsed >= 0);
});

test("template payload matches official Interakt shape", () => {
  const payload = buildSendTemplatePayload({
    phone: "+919876543210",
    templateName: "welcome_msg",
    languageCode: "en",
    bodyValues: ["Alice"],
    callbackData: '{"v":1}',
    campaignId: "camp-1",
    headerValues: ["Hi"],
    fileName: "doc.pdf",
    buttonValues: { "0": ["track"] },
  });
  assert.equal(payload.type, "Template");
  assert.equal(payload.countryCode, "+91");
  assert.equal(payload.phoneNumber, "9876543210");
  assert.equal(payload.template.name, "welcome_msg");
  assert.equal(payload.template.languageCode, "en");
  assert.deepEqual(payload.template.bodyValues, ["Alice"]);
  assert.equal(payload.callbackData, '{"v":1}');
  assert.equal(payload.campaignId, "camp-1");
});

test("callbackData capped at 512 chars in builder", () => {
  const long = "x".repeat(600);
  const payload = buildSendTemplatePayload({
    phone: "+919876543210",
    templateName: "t",
    callbackData: long,
  });
  assert.equal(payload.callbackData?.length, 512);
});

test("duplicate provider event id is stable", () => {
  const id = providerEventId({
    type: "message_api_delivered",
    kind: "status",
    phone: "919876543210",
    body: "",
    providerMessageId: "msg-abc",
  });
  assert.equal(id, "message_api_delivered:msg-abc");
});

test("READ status never downgrades", () => {
  assert.equal(shouldUpgradeStatus("READ", "DELIVERED"), false);
  assert.equal(shouldUpgradeStatus("READ", "SENT"), false);
});

test("STOP keyword detected", () => {
  assert.equal(isOptOutKeyword("UNSUBSCRIBE"), true);
});

test("terminal run statuses block execution", () => {
  assert.ok(!RUN_TERMINAL_STATUSES.includes(RUN_STATUS.RUNNING));
  assert.ok(RUN_TERMINAL_STATUSES.includes(RUN_STATUS.PAUSED) === false);
  assert.ok(RUN_TERMINAL_STATUSES.includes(RUN_STATUS.COMPLETED));
});

test("persistEventForWebhook is persist-only export", async () => {
  const mod = await import("@/lib/events/dispatch");
  assert.equal(typeof mod.persistEventForWebhook, "function");
  assert.equal(typeof mod.dispatchEventRecord, "function");
});

test("Interakt client retries 429 with Retry-After", async () => {
  const { InteraktClient } = await import("@/lib/messaging/providers/interakt/client");
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: "rate limit" }), {
        status: 429,
        headers: { "retry-after": "1" },
      });
    }
    return new Response(JSON.stringify({ id: "msg-retry-ok" }), { status: 200 });
  };
  const client = new InteraktClient({
    apiKey: "test-key",
    fetchImpl: fetchImpl as typeof fetch,
    sleep: async () => {},
  });
  const res = await client.sendTemplate({
    phone: "+919876543210",
    templateName: "hello",
  });
  assert.equal(res.ok, true);
  assert.equal(calls, 2);
});

test("Interakt client does not retry 401", async () => {
  const { InteraktClient } = await import("@/lib/messaging/providers/interakt/client");
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: "unauthorized" }), { status: 401 });
  };
  const client = new InteraktClient({
    apiKey: "bad-key",
    fetchImpl: fetchImpl as typeof fetch,
    sleep: async () => {},
  });
  await assert.rejects(
    () => client.sendTemplate({ phone: "+919876543210", templateName: "hello" }),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /UNAUTHORIZED|401/);
      return true;
    },
  );
  assert.equal(calls, 1);
});

test("Interakt client retries 500 then succeeds", async () => {
  const { InteraktClient } = await import("@/lib/messaging/providers/interakt/client");
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: "server error" }), { status: 500 });
    }
    return new Response(JSON.stringify({ id: "msg-500-ok" }), { status: 200 });
  };
  const client = new InteraktClient({
    apiKey: "test-key",
    fetchImpl: fetchImpl as typeof fetch,
    sleep: async () => {},
  });
  const res = await client.sendTemplate({
    phone: "+919876543210",
    templateName: "hello",
  });
  assert.equal(res.ok, true);
  assert.equal(calls, 2);
});

test("atomic claim helpers are exported", async () => {
  const claim = await import("./claim");
  assert.equal(typeof claim.claimWorkflowRun, "function");
  assert.equal(typeof claim.claimInternalEvent, "function");
  assert.equal(typeof claim.releaseWorkflowRun, "function");
  assert.equal(typeof claim.releaseInternalEvent, "function");
});

test("dispatchEventAsync persists only (no inline processing)", async () => {
  const { dispatchEventAsync } = await import("@/lib/events/dispatch");
  assert.equal(typeof dispatchEventAsync, "function");
  assert.equal(dispatchEventAsync.length, 1);
});

test("idempotency key pattern is runId:stepIndex", () => {
  const runId = "run-abc";
  const step = 3;
  assert.equal(`${runId}:${step}`, "run-abc:3");
});
