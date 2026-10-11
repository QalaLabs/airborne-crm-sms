import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizeWhatsAppWebhookPost,
  computeInteraktSignatureHex,
  inspectInteraktSignature,
  loadInteraktWebhookSecret,
  signInteraktPayload,
  verifyInteraktSignature,
} from "./webhooks";

// Official Interakt docs vector:
// payload '{"foo":1,"bar":2}', key examplekey
// Interakt-Signature: sha256=b84783d10ede5bd6ed771e8b16fbe5a7093340159d6e49ec4248350b6ec2c7b4
const OFFICIAL_BODY = '{"foo":1,"bar":2}';
const OFFICIAL_KEY = "examplekey";
const OFFICIAL_SIG = "sha256=b84783d10ede5bd6ed771e8b16fbe5a7093340159d6e49ec4248350b6ec2c7b4";

test("official Interakt HMAC vector verifies", () => {
  assert.equal(computeInteraktSignatureHex(OFFICIAL_BODY, OFFICIAL_KEY), OFFICIAL_SIG.slice("sha256=".length));
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, OFFICIAL_SIG, OFFICIAL_KEY), true);
  assert.equal(signInteraktPayload(OFFICIAL_BODY, OFFICIAL_KEY), OFFICIAL_SIG);
});

test("valid Interakt-Signature is accepted", () => {
  const body = '{"type":"message_received","data":{"message":{"id":"1"}}}';
  const header = signInteraktPayload(body, OFFICIAL_KEY);
  assert.equal(header.startsWith("sha256="), true);
  assert.equal(verifyInteraktSignature(body, header, OFFICIAL_KEY), true);
  assert.equal(verifyInteraktSignature(Buffer.from(body, "utf8"), header, OFFICIAL_KEY), true);
});

test("invalid signature is rejected", () => {
  const body = '{"type":"message_api_delivered"}';
  const header = signInteraktPayload(body, OFFICIAL_KEY);
  assert.equal(verifyInteraktSignature(body, header, "wrong-secret"), false);
  assert.equal(verifyInteraktSignature(`${body} `, header, OFFICIAL_KEY), false);
});

test("missing signature is rejected", () => {
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, null, OFFICIAL_KEY), false);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, "", OFFICIAL_KEY), false);
});

test("malformed signature is rejected", () => {
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, "sha256=", OFFICIAL_KEY), false);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, "not-a-signature", OFFICIAL_KEY), false);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, "md5=deadbeef", OFFICIAL_KEY), false);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, "sha256=zzzz", OFFICIAL_KEY), false);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, "sha256=abcd", OFFICIAL_KEY), false);
});

test("sha256= prefix is case-insensitive and hex may be uppercase", () => {
  const hex = OFFICIAL_SIG.slice("sha256=".length);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, `SHA256=${hex}`, OFFICIAL_KEY), true);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, `sha256=${hex.toUpperCase()}`, OFFICIAL_KEY), true);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, hex, OFFICIAL_KEY), true);
});

test("HMAC uses exact raw JSON; re-stringification cannot be used", () => {
  const raw = '{ "foo": 1, "bar": 2 }';
  const header = signInteraktPayload(raw, OFFICIAL_KEY);
  assert.equal(verifyInteraktSignature(raw, header, OFFICIAL_KEY), true);

  const restringified = JSON.stringify(JSON.parse(raw));
  assert.notEqual(restringified, raw);
  assert.equal(restringified, '{"foo":1,"bar":2}');
  assert.equal(verifyInteraktSignature(restringified, header, OFFICIAL_KEY), false);

  const reordered = '{"bar":2,"foo":1}';
  assert.notEqual(reordered, JSON.stringify({ foo: 1, bar: 2 }));
  const compactHeader = signInteraktPayload('{"foo":1,"bar":2}', OFFICIAL_KEY);
  assert.equal(verifyInteraktSignature(reordered, compactHeader, OFFICIAL_KEY), false);
});

test("inspect diagnostics never include hmac or secret values", () => {
  const result = inspectInteraktSignature(OFFICIAL_BODY, OFFICIAL_SIG, "wrong");
  assert.equal(result.ok, false);
  if (result.ok) return;
  const json = JSON.stringify(result.diagnostics);
  assert.equal(json.includes("wrong"), false);
  assert.equal(json.includes(OFFICIAL_SIG.slice("sha256=".length)), false);
  assert.equal(result.diagnostics.secretConfigured, true);
  assert.equal(result.diagnostics.secretLength, "wrong".length);
  assert.equal(result.diagnostics.receivedPrefix, "sha256=");
  assert.equal(result.diagnostics.receivedSignatureLength, OFFICIAL_SIG.length);
  assert.equal(result.diagnostics.computedSignatureLength, OFFICIAL_SIG.length);
  assert.equal(result.diagnostics.comparisonFailed, true);
});

test("loadInteraktWebhookSecret trims BOM and trailing newline", () => {
  assert.equal(loadInteraktWebhookSecret({ INTERAKT_WEBHOOK_SECRET: `${OFFICIAL_KEY}\n` }), OFFICIAL_KEY);
  assert.equal(loadInteraktWebhookSecret({ INTERAKT_WEBHOOK_SECRET: `\uFEFF${OFFICIAL_KEY}  ` }), OFFICIAL_KEY);
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, OFFICIAL_SIG, `${OFFICIAL_KEY}\n`), false);
  const trimmed = loadInteraktWebhookSecret({ INTERAKT_WEBHOOK_SECRET: `${OFFICIAL_KEY}\n` });
  assert.equal(verifyInteraktSignature(OFFICIAL_BODY, OFFICIAL_SIG, trimmed!), true);
});

test("authorizeWhatsAppWebhookPost: Interakt HMAC uses INTERAKT_WEBHOOK_SECRET only", () => {
  const body = OFFICIAL_BODY;
  const ok = authorizeWhatsAppWebhookPost({
    rawBody: body,
    interaktSignature: OFFICIAL_SIG,
    sharedSecretHeader: null,
    querySecret: null,
    interaktWebhookSecret: OFFICIAL_KEY,
    legacyWebhookSecret: "legacy-unused",
  });
  assert.equal(ok.ok, true);

  const wrongEnv = authorizeWhatsAppWebhookPost({
    rawBody: body,
    interaktSignature: OFFICIAL_SIG,
    sharedSecretHeader: null,
    querySecret: null,
    interaktWebhookSecret: undefined,
    legacyWebhookSecret: OFFICIAL_KEY,
  });
  assert.equal(wrongEnv.ok, false);
  if (!wrongEnv.ok) assert.equal(wrongEnv.error, "not_configured");

  const missing = authorizeWhatsAppWebhookPost({
    rawBody: body,
    interaktSignature: null,
    sharedSecretHeader: null,
    querySecret: null,
    interaktWebhookSecret: OFFICIAL_KEY,
    legacyWebhookSecret: undefined,
  });
  assert.equal(missing.ok, false);
  if (!missing.ok) assert.equal(missing.error, "invalid_secret");

  const malformed = authorizeWhatsAppWebhookPost({
    rawBody: body,
    interaktSignature: "sha256=",
    sharedSecretHeader: null,
    querySecret: null,
    interaktWebhookSecret: OFFICIAL_KEY,
    legacyWebhookSecret: undefined,
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.error, "invalid_signature");
});
