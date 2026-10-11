import { AppError, StorageUnavailableError } from "@/lib/utils/errors";

// ─── Supabase Storage (server-only) ──────────────────────────────────────────
// Canonical object storage for the media library. Uses the Supabase Storage
// REST API directly (no supabase-js dependency) with the service-role key.
// SUPABASE_SERVICE_ROLE_KEY is a server-only credential and is never exposed
// to the browser. All operations are scoped to the configured bucket.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "media";

const BUCKET_FILE_SIZE_LIMIT = 50 * 1024 * 1024;

let bucketEnsure: Promise<void> | null = null;

export function isStorageConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}

function getHeaders(): Record<string, string> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new StorageUnavailableError(
      "Media storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
}

// Best-effort: create the public bucket on first use if it does not exist.
// Failures are non-fatal here; the subsequent object call surfaces real errors.
async function ensureBucket(): Promise<void> {
  if (!bucketEnsure) {
    bucketEnsure = (async () => {
      try {
        const headers = getHeaders();
        const listRes = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, { headers });
        if (!listRes.ok) return;
        const buckets = (await listRes.json()) as { id: string; name: string }[];
        if (buckets.some((b) => b.id === STORAGE_BUCKET || b.name === STORAGE_BUCKET)) return;
        await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            id: STORAGE_BUCKET,
            name: STORAGE_BUCKET,
            public: true,
            file_size_limit: BUCKET_FILE_SIZE_LIMIT,
          }),
        });
      } catch {
        // ignored — object uploads will surface a real error if the bucket is missing
      }
    })();
  }
  return bucketEnsure;
}

export function getPublicUrl(path: string): string {
  if (!SUPABASE_URL) {
    throw new StorageUnavailableError(
      "Media storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${STORAGE_BUCKET}/${path}`;
}

// Server-side upload — stream bytes from the admin API to Supabase Storage.
export async function uploadObject(
  path: string,
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  const headers = getHeaders();
  await ensureBucket();

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: "POST",
    headers: { ...headers, "Content-Type": contentType },
    body: data as BodyInit,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError("UPLOAD_FAILED", `Storage upload failed (HTTP ${res.status}). ${detail}`, 502);
  }

  return getPublicUrl(path);
}

// Signed upload URL — lets the client PUT bytes directly to storage without
// exposing the service-role key. Used by the existing presign→PUT flow.
export async function createSignedUploadUrl(
  path: string,
  contentType: string,
  expiresIn = 900,
): Promise<string> {
  const headers = getHeaders();
  await ensureBucket();

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/upload/sign/${STORAGE_BUCKET}/${path}`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn }),
    },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError("UPLOAD_FAILED", `Storage presign failed (HTTP ${res.status}). ${detail}`, 502);
  }

  const json = (await res.json()) as { url?: string };
  if (!json.url) {
    throw new AppError("UPLOAD_FAILED", "Storage presign returned no upload URL.", 502);
  }

  return `${SUPABASE_URL}/storage/v1${json.url}`;
}

// Delete an object. Missing objects (404) are treated as already-deleted so
// legacy assets that were never stored in Supabase can still be removed.
export async function deleteObject(path: string): Promise<void> {
  const headers = getHeaders();

  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${STORAGE_BUCKET}/${path}`, {
    method: "DELETE",
    headers,
  });

  if (res.status === 404) return;
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new AppError("UPLOAD_FAILED", `Storage delete failed (HTTP ${res.status}). ${detail}`, 502);
  }
}
