import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PUBLIC_ORG_SETTINGS_KEYS,
  buildPublicOrgPayload,
  projectPublicOrgSettings,
} from "./org.public";

// A settings blob shaped like the real production value: arbitrary JSON that
// has historically carried live credentials and provider secrets.
const SECRETS_FIXTURE = {
  envVars: {
    DATABASE_URL: "postgresql://user:pass@prod.example.com:5432/academy",
    AUTH_SECRET: "auth-secret-XXXX",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_XXXX",
    INTERAKT_API_KEY: "interakt-api-key",
    CRON_SECRET: "cron-secret",
    RESEND_API_KEY: "re_live_XXXX",
    GOOGLE_ADS_WEBHOOK_SECRET: "ads-webhook-secret",
  },
  googleAdsWebhookSecret: "ads-webhook-secret",
  interaktApiKey: "interakt-api-key",
  whatsappToken: "wa-token",
  razorpayWebhook: "https://hooks.example.com/razorpay?key=secret-param",
  vapiWebhook: "https://hooks.example.com/vapi?token=abc",
  whatsappWebhook: "https://hooks.example.com/wa?token=xyz",
  resend: { apiKey: "re_live_123", from: "no-reply@academy.in" },
  credentials: { username: "airborne", password: "hunter2" },
  applicationIntake: true,
  maintenanceMode: false,
  website: "https://www.example.in",
  phone: "+91 90000 00000",
  email: "info@example.in",
};

const SECRET_TOKENS = [
  "postgresql://user:pass@prod.example.com",
  "auth-secret-XXXX",
  "sb_secret_XXXX",
  "interakt-api-key",
  "cron-secret",
  "re_live_XXXX",
  "re_live_123",
  "ads-webhook-secret",
  "wa-token",
  "secret-param",
  "hunter2",
];

const ORG = {
  id: "org_123",
  name: "Airborne Aviation",
  slug: "airborne-aviation",
  logoUrl: "https://cdn.example.com/logo.png",
  domain: "www.airborne.example",
  settings: SECRETS_FIXTURE,
};

test("projectPublicOrgSettings keeps ONLY allow-listed keys", () => {
  const projected = projectPublicOrgSettings(SECRETS_FIXTURE);
  assert.deepEqual(
    Object.keys(projected).sort(),
    [...PUBLIC_ORG_SETTINGS_KEYS].sort(),
    "projected keys must be exactly the allow-list, nothing more",
  );
  assert.equal(projected.applicationIntake, true);
  assert.equal(projected.maintenanceMode, false);
});

test("projectPublicOrgSettings tolerates non-object input", () => {
  assert.deepEqual(projectPublicOrgSettings(null), {});
  assert.deepEqual(projectPublicOrgSettings(undefined), {});
  assert.deepEqual(projectPublicOrgSettings("string"), {});
  assert.deepEqual(projectPublicOrgSettings([1, 2]), {});
  assert.deepEqual(projectPublicOrgSettings(42), {});
});

test("buildPublicOrgPayload keeps org identity + navMenus + projected settings", () => {
  const navMenus = [{ id: "n1", location: "header", items: [] }];
  const payload = buildPublicOrgPayload(ORG, navMenus);

  assert.equal(payload.id, "org_123");
  assert.equal(payload.name, "Airborne Aviation");
  assert.equal(payload.slug, "airborne-aviation");
  assert.equal(payload.logoUrl, "https://cdn.example.com/logo.png");
  assert.equal(payload.domain, "www.airborne.example");
  assert.deepEqual(payload.navMenus, navMenus);
  assert.deepEqual(Object.keys(payload.settings).sort(), [...PUBLIC_ORG_SETTINGS_KEYS].sort());
});

test("GET /api/public/settings response body leaks NO secrets", () => {
  const navMenus = [{ id: "n1", location: "header", items: [] }];
  const body = JSON.stringify({ data: buildPublicOrgPayload(ORG, navMenus) });

  for (const token of SECRET_TOKENS) {
    assert.ok(!body.includes(token), `response leaked secret token: ${token}`);
  }

  // Public fields / allow-listed flags still present.
  assert.ok(body.includes('"applicationIntake":true'));
  assert.ok(body.includes('"maintenanceMode":false'));
  assert.ok(body.includes('"name":"Airborne Aviation"'));
  assert.ok(body.includes('"location":"header"'));
  // Sensitive-looking top-level settings keys must NOT appear anywhere.
  assert.ok(!body.includes("webhookSecret"));
  assert.ok(!body.includes("envVars"));
  assert.ok(!body.includes("interaktApiKey"));
});

test("settings key absence is not re-added as null", () => {
  const payload = buildPublicOrgPayload(
    { ...ORG, settings: { forceDebugLogs: true } },
    [],
  );
  const body = JSON.stringify(payload.settings);
  assert.ok(!body.includes("forceDebugLogs"), "arbitrary keys must never appear");
  assert.deepEqual(payload.settings, {});
});