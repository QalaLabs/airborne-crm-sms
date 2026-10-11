import test from "node:test";
import assert from "node:assert/strict";
import { splitIndianPhone, normalizePhone } from "./phone";
import { encodeCorrelation, decodeCorrelation } from "./providers/interakt/correlation";
import {
  buildTrackUserPayload,
  buildTrackEventPayload,
  buildSendTemplatePayload,
  buildGetUsersPayload,
  sanitizeTraitValue,
} from "./providers/interakt/payloads";
import { InteraktError } from "./providers/interakt/errors";
import { InteraktClient } from "./providers/interakt/client";
import { InteraktProvider } from "./providers/interakt.provider";
import {
  parseInteraktWebhook,
  verifyInteraktSignature,
  signInteraktPayload,
  mapProviderStatus,
  shouldUpgradeStatus,
  providerEventId,
} from "./providers/interakt/webhooks";
import { isOptOutKeyword, parseInboundWhatsApp } from "./inbound";
import { leadToUserTraits, interaktEventName } from "./providers/interakt/mapping";

test("normalizePhone strips non-digits", () => {
  assert.equal(normalizePhone("+91 98765-43210"), "919876543210");
});

test("splitIndianPhone accepts 10-digit, 91-prefixed, and +91 forms", () => {
  assert.deepEqual(splitIndianPhone("9876543210"), {
    countryCode: "+91",
    phoneNumber: "9876543210",
    digits: "919876543210",
  });
  assert.deepEqual(splitIndianPhone("+91 98765 43210"), {
    countryCode: "+91",
    phoneNumber: "9876543210",
    digits: "919876543210",
  });
  assert.deepEqual(splitIndianPhone("0919876543210"), {
    countryCode: "+91",
    phoneNumber: "9876543210",
    digits: "919876543210",
  });
  assert.equal(splitIndianPhone("12345"), null);
});

test("Get Users payload always includes created_at_utc filter", () => {
  const payload = buildGetUsersPayload({ limit: 1 });
  assert.equal(Array.isArray(payload.filters), true);
  assert.equal(payload.filters.length, 1);
  assert.equal(payload.filters[0]?.trait, "created_at_utc");
  assert.equal(payload.filters[0]?.op, "gt");
});

test("user track payload uses lead id + +91 split + traits/tags", () => {
  const payload = buildTrackUserPayload({
    userId: "lead-uuid",
    phone: "+919876543210",
    traits: { name: "Riya", email: "riya@test.com", course: "CPL", leadStatus: "NEW" },
    tags: ["cpl", "status:NEW"],
  });
  assert.equal(payload.userId, "lead-uuid");
  assert.equal(payload.countryCode, "+91");
  assert.equal(payload.phoneNumber, "9876543210");
  assert.equal(payload.traits.name, "Riya");
  assert.deepEqual(payload.tags, ["cpl", "status:NEW"]);
});

test("event track payload maps canonical event name", () => {
  const payload = buildTrackEventPayload({
    userId: "lead-uuid",
    phone: "9876543210",
    event: "lead_created",
    traits: { source: "GOOGLE_ADS" },
  });
  assert.equal(payload.event, "lead_created");
  assert.equal(payload.phoneNumber, "9876543210");
  assert.equal(payload.traits.source, "GOOGLE_ADS");
});

test("template send payload matches Interakt public message API", () => {
  const payload = buildSendTemplatePayload({
    phone: "9876543210",
    templateName: "new_lead_welcome",
    languageCode: "en",
    bodyValues: ["Riya", "CPL"],
    callbackData: '{"v":1,"l":"abc"}',
  });
  assert.equal(payload.type, "Template");
  assert.equal(payload.countryCode, "+91");
  assert.equal(payload.phoneNumber, "9876543210");
  assert.equal(payload.template.name, "new_lead_welcome");
  assert.deepEqual(payload.template.bodyValues, ["Riya", "CPL"]);
  assert.equal(payload.callbackData, '{"v":1,"l":"abc"}');
});

test("template send without name throws TEMPLATE_REQUIRED", () => {
  assert.throws(
    () => buildSendTemplatePayload({ phone: "9876543210", templateName: "  " }),
    (err: unknown) => err instanceof InteraktError && err.code === "TEMPLATE_REQUIRED",
  );
});

test("sanitizeTraitValue strips newlines/tabs/triple spaces", () => {
  assert.equal(sanitizeTraitValue("hello\n\tworld   x"), "hello world  x");
});

test("correlation round-trips under 512 chars", () => {
  const encoded = encodeCorrelation({
    v: 1,
    l: "11111111-1111-1111-1111-111111111111",
    c: "22222222-2222-2222-2222-222222222222",
    m: "33333333-3333-3333-3333-333333333333",
    w: "44444444-4444-4444-4444-444444444444",
    s: "0",
    k: "55555555-5555-5555-5555-555555555555",
  });
  assert.ok(encoded.length < 512);
  const decoded = decodeCorrelation(encoded);
  assert.equal(decoded?.l, "11111111-1111-1111-1111-111111111111");
  assert.equal(decoded?.w, "44444444-4444-4444-4444-444444444444");
});

test("HMAC Interakt-Signature verifies official sha256= form", () => {
  const body = '{"foo":1,"bar":2}';
  const secret = "examplekey";
  const header = signInteraktPayload(body, secret);
  assert.ok(header.startsWith("sha256="));
  assert.equal(verifyInteraktSignature(body, header, secret), true);
  assert.equal(verifyInteraktSignature(body, header, "wrong"), false);
  assert.equal(verifyInteraktSignature(body + "x", header, secret), false);
});

test("webhook normalization maps Interakt delivery statuses", () => {
  const sent = parseInteraktWebhook({
    version: "1.0",
    type: "message_api_sent",
    data: {
      customer: { id: "cust-1", channel_phone_number: "919876543210", traits: { name: "Riya" } },
      message: {
        id: "msg-1",
        message_status: "Sent",
        meta_data: { source_data: { callback_data: JSON.stringify({ v: 1, l: "lead-1", m: "internal-1" }) } },
      },
    },
  });
  assert.equal(sent?.kind, "status");
  assert.equal(sent?.internalStatus, "SENT");
  assert.equal(sent?.phone, "919876543210");
  assert.equal(sent?.callbackData?.m, "internal-1");

  const delivered = parseInteraktWebhook({
    type: "message_api_delivered",
    data: { customer: { channel_phone_number: "919876543210" }, message: { id: "msg-1", message_status: "Delivered" } },
  });
  assert.equal(delivered?.internalStatus, "DELIVERED");

  const read = parseInteraktWebhook({
    type: "message_campaign_read",
    data: { customer: { channel_phone_number: "919876543210" }, message: { id: "msg-1", message_status: "Read" } },
  });
  assert.equal(read?.internalStatus, "READ");

  const failed = parseInteraktWebhook({
    type: "message_api_failed",
    data: {
      customer: { channel_phone_number: "919876543210" },
      message: { id: "msg-1", message_status: "Failed", channel_failure_reason: "not a wa user" },
    },
  });
  assert.equal(failed?.internalStatus, "FAILED");
  assert.equal(failed?.failureReason, "not a wa user");
});

test("incoming Interakt customer message normalizes to inbound", () => {
  const inbound = parseInteraktWebhook({
    type: "message_received",
    data: {
      customer: {
        id: "cust-1",
        channel_phone_number: "919876543210",
        traits: { name: "Riya", "User Id": "lead-uuid" },
      },
      message: { id: "in-1", message: "Hello", message_content_type: "Text" },
    },
  });
  assert.equal(inbound?.kind, "inbound");
  assert.equal(inbound?.body, "Hello");
  assert.equal(inbound?.userIdTrait, "lead-uuid");
  assert.equal(inbound?.providerMessageId, "in-1");

  const viaInboundParser = parseInboundWhatsApp({
    type: "message_received",
    data: {
      customer: { id: "cust-1", channel_phone_number: "919876543210", traits: { name: "Riya" } },
      message: { id: "in-1", message: "Hello" },
    },
  });
  assert.equal(viaInboundParser?.body, "Hello");
  assert.equal(viaInboundParser?.phone, "919876543210");
});

test("STOP keyword detection", () => {
  assert.equal(isOptOutKeyword("STOP"), true);
  assert.equal(isOptOutKeyword("please unsubscribe me"), true);
  assert.equal(isOptOutKeyword("hello there"), false);
});

test("duplicate webhook uses stable providerEventId", () => {
  const a = parseInteraktWebhook({
    type: "message_received",
    data: {
      customer: { channel_phone_number: "919876543210" },
      message: { id: "in-1", message: "Hi" },
    },
  });
  const b = parseInteraktWebhook({
    type: "message_received",
    data: {
      customer: { channel_phone_number: "919876543210" },
      message: { id: "in-1", message: "Hi" },
    },
  });
  assert.equal(providerEventId(a!), providerEventId(b!));
  assert.equal(providerEventId(a!), "message_received:in-1");
});

test("delivery status mapping does not downgrade READ", () => {
  assert.equal(mapProviderStatus("Sent", "message_api_sent"), "SENT");
  assert.equal(shouldUpgradeStatus("SENT", "DELIVERED"), true);
  assert.equal(shouldUpgradeStatus("DELIVERED", "READ"), true);
  assert.equal(shouldUpgradeStatus("READ", "DELIVERED"), false);
  assert.equal(shouldUpgradeStatus("READ", "FAILED"), false);
  assert.equal(shouldUpgradeStatus("SENT", "FAILED"), true);
});

test("Interakt client retries 429 then succeeds", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({ message: "Rate limit exceeded for this resource" }), { status: 429 });
    }
    return new Response(JSON.stringify({ result: true, id: "ok-1" }), { status: 200 });
  };
  const client = new InteraktClient({
    apiKey: "test-key",
    fetchImpl,
    sleep: async () => undefined,
  });
  const res = await client.trackUser({ userId: "u1", phone: "9876543210" });
  assert.equal(res.ok, true);
  assert.equal(calls, 2);
});

test("Interakt client maps 401 to UNAUTHORIZED and does not retry", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: "nope" }), { status: 401 });
  };
  const client = new InteraktClient({
    apiKey: "bad",
    fetchImpl,
    sleep: async () => undefined,
  });
  await assert.rejects(
    () => client.getUsers({ limit: 1 }),
    (err: unknown) => err instanceof InteraktError && err.code === "UNAUTHORIZED" && calls === 1,
  );
});

test("InteraktProvider send without template reports FAILED TEMPLATE_REQUIRED", async () => {
  const prevKey = process.env.INTERAKT_API_KEY;
  const prevTpl = process.env.INTERAKT_DEFAULT_TEMPLATE;
  process.env.INTERAKT_API_KEY = "test-key";
  delete process.env.INTERAKT_DEFAULT_TEMPLATE;
  try {
    const provider = new InteraktProvider(
      () =>
        new InteraktClient({
          apiKey: "test-key",
          fetchImpl: async () => new Response("{}", { status: 500 }),
        }),
    );
    const result = await provider.send({ to: "9876543210", body: "hello" });
    assert.equal(result.status, "FAILED");
    assert.match(result.errorMsg ?? "", /template/i);
  } finally {
    process.env.INTERAKT_API_KEY = prevKey;
    if (prevTpl) process.env.INTERAKT_DEFAULT_TEMPLATE = prevTpl;
  }
});

test("InteraktProvider send reports SENT only when Interakt returns an id", async () => {
  const prevKey = process.env.INTERAKT_API_KEY;
  process.env.INTERAKT_API_KEY = "test-key";
  try {
    const provider = new InteraktProvider(
      () =>
        new InteraktClient({
          apiKey: "test-key",
          fetchImpl: async () =>
            new Response(JSON.stringify({ result: true, message: "Message created successfully", id: "6c2d7175" }), {
              status: 200,
            }),
          sleep: async () => undefined,
        }),
    );
    const result = await provider.send({
      to: "9876543210",
      body: "Riya",
      templateName: "new_lead_welcome",
    });
    assert.equal(result.status, "SENT");
    assert.equal(result.externalId, "6c2d7175");
  } finally {
    if (prevKey === undefined) delete process.env.INTERAKT_API_KEY;
    else process.env.INTERAKT_API_KEY = prevKey;
  }
});

test("InteraktProvider isConfigured is false without API key", () => {
  const prev = process.env.INTERAKT_API_KEY;
  delete process.env.INTERAKT_API_KEY;
  try {
    const provider = new InteraktProvider();
    assert.equal(provider.isConfigured(), false);
  } finally {
    if (prev) process.env.INTERAKT_API_KEY = prev;
  }
});

test("lead traits mapping", () => {
  const traits = leadToUserTraits({
    id: "x",
    name: "Riya",
    email: "r@test.com",
    phone: "9876543210",
    courseInterest: "DGCA CPL Ground School",
    status: "NEW",
    tags: ["hot"],
    source: "HOMEPAGE_CTA",
    landingPage: "https://airborne.example/cpl",
    utmCampaign: "spring",
    createdAt: "2026-09-02T00:00:00.000Z",
    whatsappOptOut: false,
  });
  assert.equal(traits.airborne_lead_id, "x");
  assert.equal(traits.course, "dgca_cpl");
  assert.equal(traits.course_interest, "DGCA CPL Ground School");
  assert.equal(traits.lead_source, "HOMEPAGE_CTA");
  assert.equal(traits.lead_source_group, "website");
  assert.equal(traits.landing_page, "https://airborne.example/cpl");
  assert.equal(traits.campaign, "spring");
  assert.equal(traits.email, "r@test.com");
  assert.equal(traits.lead_created_at, "2026-09-02T00:00:00.000Z");
  assert.equal(traits.leadStatus, "NEW");
  assert.equal(interaktEventName("lead/created"), "lead_created");
  assert.equal(interaktEventName("payment/received"), "payment.success");
});
