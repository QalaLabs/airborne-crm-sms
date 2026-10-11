import test from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import {
  buildWebsiteTraffic,
  clearGa4TokenCache,
  ga4DateRange,
  resolveGa4Config,
  GA4_SCOPE,
} from "./ga4";
import { parseAnalyticsRange } from "./date-range";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const TOKEN_URI = "https://oauth2.test.invalid/token";
const API = "https://ga4.test.invalid";

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    PUBLIC_ORG_SLUG: "airborne-aviation",
    GA4_PROPERTY_ID: "123456789",
    GA4_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: "reporter@test.invalid",
      private_key: PRIVATE_PEM.replace(/\n/g, "\\n"),
      token_uri: TOKEN_URI,
    }),
    GA4_DATA_API_URL: API,
    ...overrides,
  };
}

const range = (from: string, to: string) =>
  parseAnalyticsRange(new URLSearchParams({ from, to }), new Date("2026-10-02T06:00:00Z"));

const REPORT = {
  reports: [
    { rows: [{ metricValues: [{ value: "120" }, { value: "40" }, { value: "55" }] }], metadata: { timeZone: "Asia/Kolkata" } },
    {
      rows: [
        { dimensionValues: [{ value: "/courses/cpl" }, { value: "CPL" }], metricValues: [{ value: "80" }, { value: "30" }, { value: "35" }] },
        { dimensionValues: [{ value: "/" }, { value: "Home" }], metricValues: [{ value: "40" }, { value: "20" }, { value: "22" }] },
      ],
      metadata: { timeZone: "Asia/Kolkata" },
    },
    { rows: [{ dimensionValues: [{ value: "google" }, { value: "organic" }], metricValues: [{ value: "50" }, { value: "38" }] }] },
  ],
};

type Call = { url: string; init: RequestInit };

/** Fake Google: verifies the signed JWT, then answers the report call with `report`. */
function fakeGoogle(report: { status?: number; body?: unknown; throws?: Error }, token: { status?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url === TOKEN_URI) {
      if (token.status) return new Response("{}", { status: token.status });
      const assertion = new URLSearchParams(String(init.body)).get("assertion") ?? "";
      const [h, p, s] = assertion.split(".");
      const valid = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s ?? "", "base64url"));
      const claims = JSON.parse(Buffer.from(p ?? "", "base64url").toString());
      assert.equal(valid, true, "JWT must be signed with the service-account key");
      assert.equal(claims.scope, GA4_SCOPE);
      assert.equal(claims.aud, TOKEN_URI);
      return Response.json({ access_token: "tok-1", expires_in: 3600 });
    }
    if (report.throws) throw report.throws;
    return report.body !== undefined
      ? Response.json(report.body, { status: report.status ?? 200 })
      : new Response("{}", { status: report.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

test.beforeEach(() => clearGa4TokenCache());

test("configured GA4: valid response becomes page views, users, sessions, pages and sources", async () => {
  const google = fakeGoogle({ body: REPORT });
  const res = await buildWebsiteTraffic("airborne-aviation", range("2026-09-01", "2026-09-30"), { fetchImpl: google.fetchImpl, env: env() });
  assert.equal(res.status, "ok");
  if (res.status !== "ok") return;
  assert.deepEqual(res.totals, { pageViews: 120, users: 40, sessions: 55 });
  assert.equal(res.pages[0]?.path, "/courses/cpl");
  assert.equal(res.pages[0]?.pageViews, 80);
  assert.deepEqual(res.sources[0], { source: "google", medium: "organic", sessions: 50, users: 38 });
  assert.equal(res.timeZoneMatchesIST, true);
  assert.equal(res.empty, false);

  const reportCall = google.calls.find((c) => c.url.startsWith(API))!;
  assert.equal(reportCall.url, `${API}/v1beta/properties/123456789:batchRunReports`);
  assert.equal((reportCall.init.headers as Record<string, string>).authorization, "Bearer tok-1");
  const body = JSON.parse(String(reportCall.init.body));
  assert.deepEqual(body.requests[0].dateRanges, [{ startDate: "2026-09-01", endDate: "2026-09-30" }]);
  assert.deepEqual(body.requests[1].dimensions.map((d: { name: string }) => d.name), ["pagePath", "pageTitle"]);
});

test("empty GA4 response is reported as genuinely empty, not as an error", async () => {
  const google = fakeGoogle({ body: { reports: [{}, {}, {}] } });
  const res = await buildWebsiteTraffic("airborne-aviation", range("2026-09-01", "2026-09-01"), { fetchImpl: google.fetchImpl, env: env() });
  assert.equal(res.status, "ok");
  if (res.status === "ok") {
    assert.equal(res.empty, true);
    assert.deepEqual(res.totals, { pageViews: 0, users: 0, sessions: 0 });
  }
});

test("not configured / invalid config never calls Google and never returns zeros", async () => {
  const google = fakeGoogle({ body: REPORT });
  const missing = await buildWebsiteTraffic("airborne-aviation", null, { fetchImpl: google.fetchImpl, env: env({ GA4_PROPERTY_ID: "" }) });
  assert.equal(missing.status, "not_configured");
  assert.match((missing as { message: string }).message, /GA4_PROPERTY_ID/);

  const badProperty = await buildWebsiteTraffic("airborne-aviation", null, { fetchImpl: google.fetchImpl, env: env({ GA4_PROPERTY_ID: "G-KB3Y1MSLR6" }) });
  assert.deepEqual([badProperty.status, (badProperty as { reason?: string }).reason], ["error", "invalid_config"]);

  const badJson = await buildWebsiteTraffic("airborne-aviation", null, { fetchImpl: google.fetchImpl, env: env({ GA4_SERVICE_ACCOUNT_JSON: "{not json" }) });
  assert.deepEqual([badJson.status, (badJson as { reason?: string }).reason], ["error", "invalid_config"]);

  const insecure = resolveGa4Config("airborne-aviation", env({ GA4_DATA_API_URL: "http://evil.example" }));
  assert.equal(insecure.ok, false);
  assert.equal(google.calls.length, 0);
});

test("credentials are never echoed in results", async () => {
  const google = fakeGoogle({ body: REPORT }, { status: 401 });
  const res = await buildWebsiteTraffic("airborne-aviation", null, { fetchImpl: google.fetchImpl, env: env() });
  assert.deepEqual([res.status, (res as { reason?: string }).reason], ["error", "unauthorized"]);
  const text = JSON.stringify(res);
  assert.equal(text.includes("PRIVATE KEY"), false);
  assert.equal(text.includes("reporter@test.invalid"), false);
});

test("unauthorized property, invalid property, outage and timeout map to distinct states", async () => {
  const cases: [Parameters<typeof fakeGoogle>[0], string][] = [
    [{ status: 403, body: { error: { status: "PERMISSION_DENIED" } } }, "forbidden"],
    [{ status: 400, body: { error: { status: "INVALID_ARGUMENT" } } }, "invalid_property"],
    [{ status: 503, body: { error: { status: "UNAVAILABLE" } } }, "unavailable"],
    [{ status: 429, body: { error: { status: "RESOURCE_EXHAUSTED" } } }, "unavailable"],
    [{ throws: Object.assign(new Error("timed out"), { name: "TimeoutError" }) }, "timeout"],
    [{ throws: new TypeError("fetch failed") }, "unavailable"],
    [{ body: { unexpected: true } }, "unavailable"],
  ];
  for (const [report, reason] of cases) {
    clearGa4TokenCache();
    const res = await buildWebsiteTraffic("airborne-aviation", null, { fetchImpl: fakeGoogle(report).fetchImpl, env: env() });
    assert.deepEqual([res.status, (res as { reason?: string }).reason], ["error", reason], JSON.stringify(report));
  }
});

test("organization isolation: GA4 is only available to the public website organization", async () => {
  const google = fakeGoogle({ body: REPORT });
  const other = await buildWebsiteTraffic("other-campus", null, { fetchImpl: google.fetchImpl, env: env() });
  assert.equal(other.status, "not_configured");
  assert.equal(google.calls.length, 0);
});

test("IST date range: same day, multi-day, midnight edges, partial days and all time", () => {
  assert.deepEqual(ga4DateRange(range("2026-09-12", "2026-09-12")), { startDate: "2026-09-12", endDate: "2026-09-12", widenedToWholeDays: false });
  assert.deepEqual(ga4DateRange(range("2026-09-01", "2026-09-30")), { startDate: "2026-09-01", endDate: "2026-09-30", widenedToWholeDays: false });
  // 00:00 IST is 18:30 UTC of the previous day; the GA4 date must stay the IST date.
  assert.deepEqual(ga4DateRange(range("2026-09-12T00:00", "2026-09-12T23:59")), { startDate: "2026-09-12", endDate: "2026-09-12", widenedToWholeDays: false });
  assert.deepEqual(ga4DateRange(range("2026-09-12T09:00", "2026-09-12T23:59")), { startDate: "2026-09-12", endDate: "2026-09-12", widenedToWholeDays: true });
  assert.deepEqual(ga4DateRange(range("2026-09-11T23:30", "2026-09-12T00:30")), { startDate: "2026-09-11", endDate: "2026-09-12", widenedToWholeDays: true });
  assert.deepEqual(ga4DateRange(null), { startDate: "2015-08-14", endDate: "today", widenedToWholeDays: false });
  assert.throws(() => range("2026-09-30", "2026-09-01"));
  assert.throws(() => range("2027-01-01", "2027-01-02")); // future start is rejected before GA4 is called
});

test("a non-IST property time zone is flagged", async () => {
  const body = structuredClone(REPORT);
  body.reports[0]!.metadata = { timeZone: "America/Los_Angeles" };
  const res = await buildWebsiteTraffic("airborne-aviation", null, { fetchImpl: fakeGoogle({ body }).fetchImpl, env: env() });
  assert.equal(res.status === "ok" && res.timeZoneMatchesIST, false);
});

test("access tokens are cached between reports", async () => {
  const google = fakeGoogle({ body: REPORT });
  await buildWebsiteTraffic("airborne-aviation", null, { fetchImpl: google.fetchImpl, env: env() });
  await buildWebsiteTraffic("airborne-aviation", null, { fetchImpl: google.fetchImpl, env: env() });
  assert.equal(google.calls.filter((c) => c.url === TOKEN_URI).length, 1);
});
