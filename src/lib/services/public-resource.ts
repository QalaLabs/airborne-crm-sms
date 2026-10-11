import { safeHttpUrl } from "@/lib/utils/safe-url";

export interface PublicResourceRow {
  id: string;
  isGated: boolean;
  fileUrl: string | null;
  externalUrl: string | null;
  [key: string]: unknown;
}

/**
 * Gated resources never expose a direct URL (clients must go through
 * /api/public/resource-download with a gate token). Non-http(s) URLs are dropped.
 */
export function toPublicResource<T extends PublicResourceRow>(r: T): T {
  return {
    ...r,
    fileUrl: r.isGated ? null : safeHttpUrl(r.fileUrl),
    externalUrl: r.isGated ? null : safeHttpUrl(r.externalUrl),
  };
}

export function resolveGatedDownloadUrl(r: { fileUrl: string | null; externalUrl: string | null }): string | null {
  return safeHttpUrl(r.fileUrl) ?? safeHttpUrl(r.externalUrl);
}
