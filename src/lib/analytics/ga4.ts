import { createSign } from "node:crypto";
import type { AnalyticsRange } from "@/lib/analytics/date-range";

/**
 * Website traffic from the Google Analytics 4 Data API (server-side only).
 *
 * The property is the one the marketing website tags (NEXT_PUBLIC_GA4_ID on the
 * website) and belongs to the public website organization (PUBLIC_ORG_SLUG).
 * Credentials are a service account read from server env; neither the key nor
 * the property id ever comes from, or goes to, the browser.
 *
 * Env (admin service):
 *   GA4_PROPERTY_ID            numeric GA4 property id ("123456789" or "properties/123456789")
 *   GA4_SERVICE_ACCOUNT_JSON   service-account key JSON (raw or base64); needs Viewer on the property
 *   GA4_DATA_API_URL           optional API origin override (https, or http on loopback for tests)
 */

export const GA4_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DEFAULT_TOKEN_URI = "https://oauth2.googleapis.com/token";
const DEFAULT_API_BASE = "https://analyticsdata.googleapis.com";
const GA4_EARLIEST_DATE = "2015-08-14";
const IST_OFFSET_MS = 330 * 60_000;
export const GA4_TIMEOUT_MS = 8_000;
const TOP_PAGES = 25;
const TOP_SOURCES = 15;

type Env = Record<string, string | undefined>;

export interface Ga4Credentials {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

export interface Ga4Config {
  propertyId: string;
  credentials: Ga4Credentials;
  apiBase: string;
}

export type Ga4ConfigResult =
  | { ok: true; config: Ga4Config }
  | { ok: false; status: "not_configured"; message: string }
  | { ok: false; status: "error"; reason: "invalid_config"; message: string };

export type Ga4FailureReason =
  | "invalid_config"
  | "unauthorized"
  | "forbidden"
  | "invalid_property"
  | "unavailable"
  | "timeout";

export class Ga4Error extends Error {
  constructor(
    public readonly reason: Ga4FailureReason,
    message: string,
  ) {
    super(message);
    this.name = "Ga4Error";
  }
}

/** https anywhere, plain http only on loopback (local mocks). */
function isAllowedEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === "https:") return true;
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
}

function parseServiceAccount(raw: string): Ga4Credentials | null {
  const text = raw.trim();
  const candidates = [text];
  if (!text.startsWith("{")) {
    try {
      candidates.push(Buffer.from(text, "base64").toString("utf8"));
    } catch {
      return null;
    }
  }
  for (const candidate of candidates) {
    try {
      const json = JSON.parse(candidate) as Record<string, unknown>;
      const clientEmail = typeof json.client_email === "string" ? json.client_email.trim() : "";
      const privateKey = typeof json.private_key === "string" ? json.private_key.replace(/\\n/g, "\n") : "";
      const tokenUri = typeof json.token_uri === "string" && json.token_uri.trim() ? json.token_uri.trim() : DEFAULT_TOKEN_URI;
      if (!clientEmail || !privateKey.includes("PRIVATE KEY")) return null;
      return { clientEmail, privateKey, tokenUri };
    } catch {
      // try the next encoding
    }
  }
  return null;
}

/**
 * GA4 is linked to the public website organization only: any other org gets
 * "not configured", so one tenant can never read another's website traffic.
 */
export function resolveGa4Config(orgSlug: string, env: Env = process.env): Ga4ConfigResult {
  const publicOrg = env.PUBLIC_ORG_SLUG?.trim() || "airborne-aviation";
  if (orgSlug !== publicOrg) {
    return { ok: false, status: "not_configured", message: "Google Analytics is not connected for this organization." };
  }

  const rawProperty = env.GA4_PROPERTY_ID?.trim() ?? "";
  const rawCredentials = env.GA4_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  const missing = [!rawProperty && "GA4_PROPERTY_ID", !rawCredentials && "GA4_SERVICE_ACCOUNT_JSON"].filter(Boolean);
  if (missing.length > 0) {
    return {
      ok: false,
      status: "not_configured",
      message: `Google Analytics is not connected. Set ${missing.join(" and ")} on the admin service.`,
    };
  }

  const propertyId = rawProperty.replace(/^properties\//, "");
  if (!/^\d{1,20}$/.test(propertyId)) {
    return { ok: false, status: "error", reason: "invalid_config", message: "GA4_PROPERTY_ID must be a numeric GA4 property id." };
  }
  const credentials = parseServiceAccount(rawCredentials);
  if (!credentials) {
    return {
      ok: false,
      status: "error",
      reason: "invalid_config",
      message: "GA4_SERVICE_ACCOUNT_JSON is not a valid service-account key (needs client_email and private_key).",
    };
  }
  const apiBase = (env.GA4_DATA_API_URL?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
  if (!isAllowedEndpoint(credentials.tokenUri) || !isAllowedEndpoint(apiBase)) {
    return { ok: false, status: "error", reason: "invalid_config", message: "GA4 endpoints must use https." };
  }
  return { ok: true, config: { propertyId, credentials, apiBase } };
}

// ─── Auth ────────────────────────────────────────────────────────────────────

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

export function signServiceAccountJwt(credentials: Ga4Credentials, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ iss: credentials.clientEmail, scope: GA4_SCOPE, aud: credentials.tokenUri, iat, exp: iat + 3600 }),
  );
  let signature: string;
  try {
    signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(credentials.privateKey).toString("base64url");
  } catch {
    throw new Ga4Error("invalid_config", "The GA4 service-account private key could not be used to sign.");
  }
  return `${header}.${claims}.${signature}`;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export function clearGa4TokenCache(): void {
  tokenCache.clear();
}

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

async function getAccessToken(credentials: Ga4Credentials, fetchImpl: typeof fetch, now: Date, timeoutMs: number) {
  const key = `${credentials.clientEmail}|${credentials.tokenUri}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt > now.getTime() + 60_000) return cached.token;

  let res: Response;
  try {
    res = await fetchImpl(credentials.tokenUri, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: signServiceAccountJwt(credentials, now),
      }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Ga4Error) throw err;
    if (isTimeout(err)) throw new Ga4Error("timeout", "Google sign-in timed out.");
    throw new Ga4Error("unavailable", "Google sign-in could not be reached.");
  }
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new Ga4Error("unauthorized", "Google rejected the GA4 service-account credentials.");
  }
  if (!res.ok) throw new Ga4Error("unavailable", `Google sign-in responded ${res.status}.`);
  const body = (await res.json().catch(() => null)) as { access_token?: unknown; expires_in?: unknown } | null;
  if (!body || typeof body.access_token !== "string") {
    throw new Ga4Error("unavailable", "Google sign-in returned an unexpected response.");
  }
  const ttl = typeof body.expires_in === "number" ? body.expires_in : 3600;
  tokenCache.set(key, { token: body.access_token, expiresAt: now.getTime() + ttl * 1000 });
  return body.access_token;
}

// ─── Report ──────────────────────────────────────────────────────────────────

function istDate(d: Date): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * GA4 reports whole calendar days in the property's reporting time zone. The
 * analytics range is IST, so its IST calendar dates are sent as-is; a range
 * with clock times is widened to whole days (flagged as `widenedToWholeDays`).
 */
export function ga4DateRange(range: AnalyticsRange | null) {
  if (!range) return { startDate: GA4_EARLIEST_DATE, endDate: "today", widenedToWholeDays: false };
  const fromTime = range.fromInput.split("T")[1];
  const toTime = range.toInput.split("T")[1];
  return {
    startDate: istDate(range.from),
    endDate: istDate(range.to),
    widenedToWholeDays: (fromTime !== undefined && fromTime !== "00:00") || (toTime !== undefined && toTime !== "23:59"),
  };
}

export function buildGa4BatchRequest(dateRange: { startDate: string; endDate: string }) {
  const dateRanges = [{ startDate: dateRange.startDate, endDate: dateRange.endDate }];
  return {
    requests: [
      {
        dateRanges,
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "sessions" }],
      },
      {
        dateRanges,
        dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }, { name: "sessions" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: TOP_PAGES,
      },
      {
        dateRanges,
        dimensions: [{ name: "sessionSource" }, { name: "sessionMedium" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: TOP_SOURCES,
      },
    ],
  };
}

interface Ga4Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}
interface Ga4Report {
  rows?: Ga4Row[];
  metadata?: { timeZone?: string };
}

function num(row: Ga4Row | undefined, i: number): number {
  const n = Number(row?.metricValues?.[i]?.value ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function dim(row: Ga4Row, i: number): string {
  return row.dimensionValues?.[i]?.value ?? "";
}

export function parseGa4BatchResponse(body: unknown) {
  const reports = (body as { reports?: Ga4Report[] } | null)?.reports;
  if (!Array.isArray(reports) || reports.length < 3) {
    throw new Ga4Error("unavailable", "Google Analytics returned an unexpected response.");
  }
  const [totalsReport, pagesReport, sourcesReport] = reports as [Ga4Report, Ga4Report, Ga4Report];
  const totalsRow = totalsReport.rows?.[0];
  const totals = { pageViews: num(totalsRow, 0), users: num(totalsRow, 1), sessions: num(totalsRow, 2) };
  const pages = (pagesReport.rows ?? []).map((r) => ({
    path: dim(r, 0) || "(not set)",
    title: dim(r, 1) || "(not set)",
    pageViews: num(r, 0),
    users: num(r, 1),
    sessions: num(r, 2),
  }));
  const sources = (sourcesReport.rows ?? []).map((r) => ({
    source: dim(r, 0) || "(not set)",
    medium: dim(r, 1) || "(not set)",
    sessions: num(r, 0),
    users: num(r, 1),
  }));
  const timeZone = totalsReport.metadata?.timeZone ?? pagesReport.metadata?.timeZone ?? null;
  return { totals, pages, sources, timeZone };
}

async function runBatchReport(config: Ga4Config, body: unknown, fetchImpl: typeof fetch, now: Date, timeoutMs: number) {
  const token = await getAccessToken(config.credentials, fetchImpl, now, timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(`${config.apiBase}/v1beta/properties/${config.propertyId}:batchRunReports`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (isTimeout(err)) throw new Ga4Error("timeout", "Google Analytics did not respond in time.");
    throw new Ga4Error("unavailable", "Google Analytics could not be reached.");
  }
  if (res.status === 401) {
    tokenCache.delete(`${config.credentials.clientEmail}|${config.credentials.tokenUri}`);
    throw new Ga4Error("unauthorized", "Google Analytics rejected the access token.");
  }
  if (res.status === 403) {
    throw new Ga4Error("forbidden", "The service account has no access to the configured GA4 property.");
  }
  if (res.status === 400 || res.status === 404) {
    throw new Ga4Error("invalid_property", "Google Analytics rejected the configured GA4 property id.");
  }
  if (!res.ok) throw new Ga4Error("unavailable", `Google Analytics is temporarily unavailable (HTTP ${res.status}).`);
  return parseGa4BatchResponse(await res.json().catch(() => null));
}

export type WebsiteTrafficResult =
  | {
      status: "ok";
      source: "ga4";
      dateRange: { startDate: string; endDate: string };
      widenedToWholeDays: boolean;
      propertyTimeZone: string | null;
      timeZoneMatchesIST: boolean;
      empty: boolean;
      totals: { pageViews: number; users: number; sessions: number };
      pages: { path: string; title: string; pageViews: number; users: number; sessions: number }[];
      sources: { source: string; medium: string; sessions: number; users: number }[];
    }
  | { status: "not_configured"; message: string }
  | { status: "error"; reason: Ga4FailureReason; message: string };

export interface WebsiteTrafficDeps {
  fetchImpl?: typeof fetch;
  env?: Env;
  now?: Date;
  timeoutMs?: number;
}

/** Never throws: configuration and upstream failures become a typed state, never zeros. */
export async function buildWebsiteTraffic(
  orgSlug: string,
  range: AnalyticsRange | null,
  deps: WebsiteTrafficDeps = {},
): Promise<WebsiteTrafficResult> {
  const resolved = resolveGa4Config(orgSlug, deps.env ?? process.env);
  if (!resolved.ok) {
    return resolved.status === "not_configured"
      ? { status: "not_configured", message: resolved.message }
      : { status: "error", reason: resolved.reason, message: resolved.message };
  }
  const dateRange = ga4DateRange(range);
  try {
    const report = await runBatchReport(
      resolved.config,
      buildGa4BatchRequest(dateRange),
      deps.fetchImpl ?? fetch,
      deps.now ?? new Date(),
      deps.timeoutMs ?? GA4_TIMEOUT_MS,
    );
    return {
      status: "ok",
      source: "ga4",
      dateRange: { startDate: dateRange.startDate, endDate: dateRange.endDate },
      widenedToWholeDays: dateRange.widenedToWholeDays,
      propertyTimeZone: report.timeZone,
      timeZoneMatchesIST: report.timeZone === null || ["Asia/Kolkata", "Asia/Calcutta"].includes(report.timeZone),
      empty: report.totals.pageViews === 0 && report.totals.sessions === 0 && report.pages.length === 0,
      totals: report.totals,
      pages: report.pages,
      sources: report.sources,
    };
  } catch (err) {
    const e = err instanceof Ga4Error ? err : new Ga4Error("unavailable", "Google Analytics request failed.");
    console.warn(`[ga4] website traffic unavailable: ${e.reason}`);
    return { status: "error", reason: e.reason, message: e.message };
  }
}
