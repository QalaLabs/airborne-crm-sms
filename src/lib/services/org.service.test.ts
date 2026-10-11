/**
 * M-04 remediation gate: write-only organization settings keys (webhook
 * authenticators, legacy envVars) are stripped when an org's settings are
 * serialized, so they never reach the browser even via the authenticated org
 * API. Pure unit test — no DB required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeOrgSettings, ORG_SETTINGS_WRITE_ONLY_KEYS } from "./org.service";

test("M-04: write-only keys are never echoed in org settings output", () => {
  const out = sanitizeOrgSettings({
    applicationIntake: "open",
    logoUrl: "https://cdn/x.png",
    googleAdsWebhookSecret: "ads-secret",
    envVars: { DATABASE_URL: "postgres://prod/" },
    interaktWebhookSecret: "interakt-secret",
    whatsappWebhookSecret: "wa-secret",
  });

  assert.equal(out.applicationIntake, "open");
  assert.equal(out.logoUrl, "https://cdn/x.png");
  assert.equal("googleAdsWebhookSecret" in out, false, "googleAdsWebhookSecret must be stripped");
  assert.equal("envVars" in out, false, "envVars must be stripped");
  assert.equal("interaktWebhookSecret" in out, false, "interaktWebhookSecret must be stripped");
  assert.equal("whatsappWebhookSecret" in out, false, "whatsappWebhookSecret must be stripped");
});

test("M-04: every declared write-only key is actually stripped", () => {
  const src: Record<string, unknown> = {};
  for (const key of ORG_SETTINGS_WRITE_ONLY_KEYS) src[key] = "value";
  const out = sanitizeOrgSettings(src);
  for (const key of ORG_SETTINGS_WRITE_ONLY_KEYS) {
    assert.equal(key in out, false, `${key} must be stripped`);
  }
});

test("M-04: non-object / empty settings produce an empty object", () => {
  assert.deepEqual(sanitizeOrgSettings(null), {});
  assert.deepEqual(sanitizeOrgSettings("nope"), {});
  assert.deepEqual(sanitizeOrgSettings([1, 2]), {});
});
