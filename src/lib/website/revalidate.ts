import { after } from "next/server";

/** Website cache tags (see the marketing app's src/lib/cmsCache.js). */
export type WebsiteResource =
  | "testimonials"
  | "courses"
  | "blogs"
  | "resources"
  | "jobs"
  | "settings"
  | "pages"
  | "placements";

const ENTITY_RESOURCES: Record<string, WebsiteResource[]> = {
  testimonial: ["testimonials"],
  course: ["courses"],
  resource: ["resources", "blogs"],
  job: ["jobs"],
  page: ["pages"],
  content_block: ["pages"],
  nav_menu: ["settings"],
  organization: ["settings"],
  placement: ["placements"],
  hiring_partner: ["placements"],
};

/** Website content affected by an audited change to `entityType` (empty when none). */
export function websiteResourcesFor(entityType: string): WebsiteResource[] {
  return ENTITY_RESOURCES[entityType] ?? [];
}

export function websiteRevalidateConfig(env: Record<string, string | undefined> = process.env) {
  const url = env.WEBSITE_REVALIDATE_URL?.trim();
  const secret = env.WEBSITE_REVALIDATE_SECRET?.trim();
  return url && secret ? { url, secret } : null;
}

export type RevalidateResult = { status: "skipped" | "ok" | "failed"; detail?: string };

/**
 * Ask the public website to purge cached CMS content. A no-op when the website
 * endpoint is not configured; failures are logged and never thrown, because the
 * website still self-refreshes on its 60s revalidate window.
 */
export async function revalidateWebsite(
  resources: WebsiteResource[],
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<RevalidateResult> {
  const config = websiteRevalidateConfig(env);
  if (!config || resources.length === 0) return { status: "skipped" };
  try {
    const res = await fetchImpl(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-revalidate-secret": config.secret },
      body: JSON.stringify({ resources: [...new Set(resources)] }),
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      console.warn(`[website-revalidate] website responded ${res.status}`);
      return { status: "failed", detail: `HTTP ${res.status}` };
    }
    return { status: "ok" };
  } catch (err) {
    console.warn("[website-revalidate] request failed", err instanceof Error ? err.message : err);
    return { status: "failed", detail: err instanceof Error ? err.message : String(err) };
  }
}

/** What the admin UI is told about the public website after a content change. */
export interface WebsiteSync {
  status: "ok" | "skipped" | "failed";
  message: string;
}

/** `${requestId}|${resource}` claimed (in flight or done) by an explicit sync in this request. */
const syncedInRequest = new Map<string, number>();
const SYNC_MEMORY_MS = 120_000;

function claim(requestId: string, resources: WebsiteResource[], now: number) {
  for (const [key, at] of syncedInRequest) if (now - at > SYNC_MEMORY_MS) syncedInRequest.delete(key);
  for (const r of resources) syncedInRequest.set(`${requestId}|${r}`, now);
}

function release(requestId: string, resources: WebsiteResource[]) {
  for (const r of resources) syncedInRequest.delete(`${requestId}|${r}`);
}

/**
 * Purge the website now and report the outcome. Call only after the mutation has
 * committed (i.e. after the service call returned). Never throws.
 */
export async function syncWebsiteContent(
  entityType: string,
  requestId?: string,
  fetchImpl: typeof fetch = fetch,
  env: Record<string, string | undefined> = process.env,
): Promise<WebsiteSync> {
  const resources = websiteResourcesFor(entityType);
  if (resources.length === 0) return { status: "skipped", message: "Not shown on the website." };
  if (!websiteRevalidateConfig(env)) {
    return { status: "skipped", message: "Instant website refresh is not configured; the website updates within 60 seconds." };
  }
  if (requestId) claim(requestId, resources, Date.now());
  const result = await revalidateWebsite(resources, fetchImpl, env);
  if (result.status === "ok") return { status: "ok", message: "The public website was refreshed." };
  // Let the after-response hook retry once.
  if (requestId) release(requestId, resources);
  return { status: "failed", message: "Saved, but the website could not be refreshed now; it updates within 60 seconds." };
}

/**
 * Schedule a purge for an audited entity change. Runs after the response is
 * sent, so after the mutation has completed; outside a request scope (scripts,
 * tests) it falls back to the next tick. Resources an explicit sync claimed in
 * the same request are skipped; a failed explicit sync releases its claim.
 */
export function scheduleWebsiteRevalidation(entityType: string, requestId?: string): void {
  if (websiteResourcesFor(entityType).length === 0 || !websiteRevalidateConfig()) return;
  const run = async () => {
    const pending = websiteResourcesFor(entityType).filter((r) => !requestId || !syncedInRequest.has(`${requestId}|${r}`));
    if (pending.length > 0) await revalidateWebsite(pending);
  };
  try {
    after(run);
  } catch {
    setTimeout(() => void run(), 0);
  }
}
