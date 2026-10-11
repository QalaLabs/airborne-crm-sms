/**
 * Single admin entry point for WhatsApp: the Interakt dashboard.
 *
 * The destination is a public, non-secret URL. An optional build-time override
 * (`NEXT_PUBLIC_INTERAKT_DASHBOARD_URL`) is accepted only when it is an https URL
 * on interakt.ai, so a misconfigured value can never turn the button into an
 * open redirect.
 */
export const DEFAULT_INTERAKT_DASHBOARD_URL = "https://app.interakt.ai/";

function isInteraktHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "interakt.ai" || host.endsWith(".interakt.ai");
}

export function interaktDashboardUrl(configured?: string | null): string {
  const raw = configured?.trim();
  if (!raw) return DEFAULT_INTERAKT_DASHBOARD_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || !isInteraktHost(url.hostname)) {
      return DEFAULT_INTERAKT_DASHBOARD_URL;
    }
    return url.toString();
  } catch {
    return DEFAULT_INTERAKT_DASHBOARD_URL;
  }
}

export const INTERAKT_DASHBOARD_URL = interaktDashboardUrl(process.env.NEXT_PUBLIC_INTERAKT_DASHBOARD_URL);
