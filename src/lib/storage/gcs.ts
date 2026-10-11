import { Storage } from "@google-cloud/storage";
import { promises as fs } from "node:fs";
import nodePath from "node:path";
import { AppError } from "@/lib/utils/errors";

const GCS_BUCKET = process.env.GCS_BUCKET ?? "airborne-aviation-media-prod";

/** Filesystem driver for isolated test runs only; never set in deployed environments. */
function localStorageDir(): string | null {
  return process.env.STORAGE_LOCAL_DIR?.trim() || null;
}

export function isLocalStorageDriver(): boolean {
  return localStorageDir() !== null;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

function assertSafeKey(path: string): void {
  if (!SAFE_KEY.test(path) || path.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
    throw new AppError("INVALID_STORAGE_KEY", "Invalid storage object key", 400);
  }
}

function localObjectPath(path: string): string {
  assertSafeKey(path);
  const root = nodePath.resolve(localStorageDir()!);
  const full = nodePath.resolve(root, path);
  if (!full.startsWith(root + nodePath.sep)) {
    throw new AppError("INVALID_STORAGE_KEY", "Invalid storage object key", 400);
  }
  return full;
}

// Lazy initialize Storage client
let storageClient: Storage | null = null;

function getStorageClient(): Storage {
  if (!storageClient) {
    storageClient = new Storage();
  }
  return storageClient;
}

export function isStorageConfigured(): boolean {
  // GCS is assumed to be configured on Cloud Run using ambient credentials
  return true;
}

export function storageBucketName(): string {
  return GCS_BUCKET;
}

const HEALTH_TTL_MS = 5 * 60 * 1000;
let healthCache: { at: number; result: { ok: boolean; error?: string } } | null = null;

/** Live probe: lists at most one object, which needs only objects.list on the bucket. */
export async function checkStorageHealth(): Promise<{ ok: boolean; error?: string }> {
  if (healthCache && Date.now() - healthCache.at < HEALTH_TTL_MS) return healthCache.result;
  let result: { ok: boolean; error?: string };
  try {
    await getStorageClient().bucket(GCS_BUCKET).getFiles({ maxResults: 1, autoPaginate: false });
    result = { ok: true };
  } catch (err: any) {
    result = { ok: false, error: err?.message ?? "unknown error" };
  }
  healthCache = { at: Date.now(), result };
  return result;
}

export function getPublicUrl(path: string): string {
  return `https://storage.googleapis.com/${GCS_BUCKET}/${path}`;
}

export async function uploadObject(
  path: string,
  data: Uint8Array,
  contentType: string,
): Promise<string> {
  if (isLocalStorageDriver()) {
    try {
      const full = localObjectPath(path);
      await fs.mkdir(nodePath.dirname(full), { recursive: true });
      await fs.writeFile(full, Buffer.from(data));
      return getPublicUrl(path);
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError("UPLOAD_FAILED", `Storage upload failed: ${err.message}`, 502);
    }
  }
  try {
    const bucket = getStorageClient().bucket(GCS_BUCKET);
    const file = bucket.file(path);
    await file.save(Buffer.from(data), {
      metadata: { contentType },
      resumable: false,
    });
    return getPublicUrl(path);
  } catch (err: any) {
    throw new AppError("UPLOAD_FAILED", `Storage upload failed: ${err.message}`, 502);
  }
}

export async function createSignedUploadUrl(
  path: string,
  contentType: string,
  expiresIn = 900,
): Promise<string> {
  try {
    const bucket = getStorageClient().bucket(GCS_BUCKET);
    const file = bucket.file(path);
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + expiresIn * 1000,
      contentType,
    });
    return url;
  } catch (err: any) {
    throw new AppError("UPLOAD_FAILED", `Storage presign failed: ${err.message}`, 502);
  }
}

/** Reads an object through the local test driver; GCS callers use createSignedReadUrl. */
export async function readLocalObject(path: string): Promise<Buffer | null> {
  if (!isLocalStorageDriver()) return null;
  try {
    return await fs.readFile(localObjectPath(path));
  } catch (err: any) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
}

export async function createSignedReadUrl(path: string, fileName: string, expiresIn = 300): Promise<string> {
  assertSafeKey(path);
  try {
    const [url] = await getStorageClient()
      .bucket(GCS_BUCKET)
      .file(path)
      .getSignedUrl({
        version: "v4",
        action: "read",
        expires: Date.now() + expiresIn * 1000,
        responseDisposition: `inline; filename="${fileName.replace(/["\\\r\n]/g, "_")}"`,
      });
    return url;
  } catch (err: any) {
    throw new AppError("DOWNLOAD_FAILED", `Storage signed read failed: ${err.message}`, 502);
  }
}

export async function deleteObject(path: string): Promise<void> {
  if (isLocalStorageDriver()) {
    try {
      await fs.unlink(localObjectPath(path));
    } catch (err: any) {
      if (err?.code !== "ENOENT") throw new AppError("UPLOAD_FAILED", `Storage delete failed: ${err.message}`, 502);
    }
    return;
  }
  try {
    const bucket = getStorageClient().bucket(GCS_BUCKET);
    const file = bucket.file(path);
    await file.delete();
  } catch (err: any) {
    if (err.code === 404) return;
    throw new AppError("UPLOAD_FAILED", `Storage delete failed: ${err.message}`, 502);
  }
}
