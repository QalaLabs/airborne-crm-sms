import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_DOCUMENT_BYTES,
  checkDocumentFile,
  documentStorageKey,
  sanitizeDocumentFileName,
  sniffDocumentMime,
} from "@/lib/documents/upload-policy";

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

test("B1: magic-byte sniffing", () => {
  assert.equal(sniffDocumentMime(PDF), "application/pdf");
  assert.equal(sniffDocumentMime(PNG), "image/png");
  assert.equal(sniffDocumentMime(JPG), "image/jpeg");
  assert.equal(sniffDocumentMime(WEBP), "image/webp");
  assert.equal(sniffDocumentMime(EXE), null);
  assert.equal(sniffDocumentMime(new Uint8Array([0x25, 0x50])), null);
});

test("B1: accepts valid PDF/JPG/PNG/WEBP", () => {
  assert.deepEqual(checkDocumentFile({ name: "aadhaar.pdf", declaredType: "application/pdf", bytes: PDF }), {
    ok: true,
    mime: "application/pdf",
    ext: "pdf",
    displayName: "aadhaar.pdf",
  });
  assert.equal(checkDocumentFile({ name: "photo.JPEG", declaredType: "image/jpeg", bytes: JPG }).ok, true);
  assert.equal(checkDocumentFile({ name: "photo.png", declaredType: "", bytes: PNG }).ok, true);
  assert.equal(checkDocumentFile({ name: "photo.webp", declaredType: "application/octet-stream", bytes: WEBP }).ok, true);
});

test("B1: rejects empty, oversized, dangerous and mismatched files", () => {
  const code = (r: ReturnType<typeof checkDocumentFile>) => (r.ok ? "OK" : r.code);
  assert.equal(code(checkDocumentFile({ name: "a.pdf", bytes: new Uint8Array() })), "EMPTY_FILE");
  const big = new Uint8Array(MAX_DOCUMENT_BYTES + 1);
  big.set(PDF);
  assert.equal(code(checkDocumentFile({ name: "a.pdf", bytes: big })), "FILE_TOO_LARGE");
  assert.equal(code(checkDocumentFile({ name: "setup.exe", bytes: EXE })), "UNSUPPORTED_FILE_TYPE");
  assert.equal(code(checkDocumentFile({ name: "page.html", bytes: new TextEncoder().encode("<script>") })), "UNSUPPORTED_FILE_TYPE");
  assert.equal(code(checkDocumentFile({ name: "renamed.pdf", bytes: EXE })), "UNSUPPORTED_FILE_TYPE");
  assert.equal(code(checkDocumentFile({ name: "image.pdf", bytes: PNG })), "FILE_TYPE_MISMATCH");
  assert.equal(code(checkDocumentFile({ name: "a.pdf", declaredType: "text/html", bytes: PDF })), "FILE_TYPE_MISMATCH");
  assert.equal(code(checkDocumentFile({ name: "noext", bytes: PDF })), "UNSUPPORTED_FILE_TYPE");
});

test("B1: filename sanitization strips paths and control/reserved characters", () => {
  assert.equal(sanitizeDocumentFileName("../../etc/passwd.pdf"), "passwd.pdf");
  assert.equal(sanitizeDocumentFileName("C:\\Users\\x\\scan<1>.pdf"), "scan1.pdf");
  assert.equal(sanitizeDocumentFileName("..hidden.pdf"), "hidden.pdf");
  assert.equal(sanitizeDocumentFileName("a\u0000b\r\n.pdf"), "ab.pdf");
  assert.equal(sanitizeDocumentFileName("///"), "document");
  assert.ok(sanitizeDocumentFileName("x".repeat(400) + ".pdf").length <= 150);
});

test("B1: storage key is server-generated and org/admission scoped", () => {
  assert.equal(documentStorageKey("org-1", "adm-1", "doc-1", "pdf"), "documents/org-1/adm-1/doc-1.pdf");
});
