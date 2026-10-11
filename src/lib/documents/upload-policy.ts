/**
 * Admission dossier document upload policy. Types are decided by the file's leading
 * bytes, never by the browser-supplied MIME type or extension alone.
 */

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_TYPES = {
  "application/pdf": { ext: "pdf", label: "PDF" },
  "image/jpeg": { ext: "jpg", label: "JPEG" },
  "image/png": { ext: "png", label: "PNG" },
  "image/webp": { ext: "webp", label: "WEBP" },
} as const;

export type AllowedDocumentMime = keyof typeof ALLOWED_DOCUMENT_TYPES;

const EXTENSION_TO_MIME: Record<string, AllowedDocumentMime> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const DOCUMENT_ACCEPT_ATTR = ".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp";

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((b, i) => bytes[offset + i] === b);
}

export function sniffDocumentMime(bytes: Uint8Array): AllowedDocumentMime | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return "application/pdf"; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

/** Display name only: strips any directory part, control and reserved characters. */
export function sanitizeDocumentFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 150);
  return cleaned || "document";
}

export function fileExtension(name: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name);
  return m?.[1] ? m[1].toLowerCase() : "";
}

export type DocumentFileCheck =
  | { ok: true; mime: AllowedDocumentMime; ext: string; displayName: string }
  | { ok: false; code: "EMPTY_FILE" | "FILE_TOO_LARGE" | "UNSUPPORTED_FILE_TYPE" | "FILE_TYPE_MISMATCH"; message: string };

export function checkDocumentFile(input: { name: string; declaredType?: string; bytes: Uint8Array }): DocumentFileCheck {
  const { bytes } = input;
  if (bytes.length === 0) return { ok: false, code: "EMPTY_FILE", message: "The selected file is empty." };
  if (bytes.length > MAX_DOCUMENT_BYTES) {
    return { ok: false, code: "FILE_TOO_LARGE", message: `Documents must be ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB or smaller.` };
  }
  const displayName = sanitizeDocumentFileName(input.name);
  const ext = fileExtension(displayName);
  const extMime = EXTENSION_TO_MIME[ext];
  if (!extMime) {
    return { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "Only PDF, JPG, PNG or WEBP documents can be uploaded." };
  }
  const sniffed = sniffDocumentMime(bytes);
  if (!sniffed) {
    return { ok: false, code: "UNSUPPORTED_FILE_TYPE", message: "The file content is not a valid PDF, JPG, PNG or WEBP document." };
  }
  const declared = (input.declaredType ?? "").toLowerCase();
  if (sniffed !== extMime || (declared && declared !== "application/octet-stream" && declared !== sniffed && !(declared === "image/jpg" && sniffed === "image/jpeg"))) {
    return { ok: false, code: "FILE_TYPE_MISMATCH", message: "The file extension or type does not match its content." };
  }
  return { ok: true, mime: sniffed, ext: ALLOWED_DOCUMENT_TYPES[sniffed].ext, displayName };
}

export function documentStorageKey(orgId: string, admissionId: string, objectId: string, ext: string): string {
  return `documents/${orgId}/${admissionId}/${objectId}.${ext}`;
}
