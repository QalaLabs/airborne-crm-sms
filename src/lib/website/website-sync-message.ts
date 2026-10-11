import type { WebsiteSync } from "@/lib/website/revalidate";

/** The website refresh outcome a CMS mutation response carries, for toasts. */
export function websiteSyncMessage(response: unknown): string | undefined {
  const sync = (response as { websiteSync?: WebsiteSync } | null | undefined)?.websiteSync;
  return sync?.message;
}
