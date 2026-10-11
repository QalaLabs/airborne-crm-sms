/**
 * M-05 remediation gate: presign/register/replace must reject any content type
 * outside the ALLOWED_MEDIA_MIME_TYPES allowlist — a free-form MIME used to be
 * accepted, defeating the media type policy. Pure unit test — no DB required.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  presignMediaSchema,
  registerAssetSchema,
  replaceAssetSchema,
  isAllowedMediaType,
} from "./media.schema";

const validRegister = {
  name: "hero",
  originalName: "hero.png",
  fileKey: "media/org/a.png",
  fileUrl: "https://cdn/a.png",
  mimeType: "image/png",
  sizeBytes: 1024,
};

test("M-05: isAllowedMediaType allowlist is case-insensitive", () => {
  assert.equal(isAllowedMediaType("image/png"), true);
  assert.equal(isAllowedMediaType("IMAGE/PNG"), true);
  assert.equal(isAllowedMediaType("application/pdf"), true);
  assert.equal(isAllowedMediaType("text/html"), false);
  assert.equal(isAllowedMediaType("application/x-msdownload"), false);
  assert.equal(isAllowedMediaType(""), false);
});

test("M-05: presignMediaSchema rejects disallowed contentType", () => {
  const ok = presignMediaSchema.safeParse({ fileName: "a.png", contentType: "image/png" });
  assert.equal(ok.success, true);

  const bad = presignMediaSchema.safeParse({ fileName: "a.html", contentType: "text/html" });
  assert.equal(bad.success, false, "text/html must be rejected for presign");
  assert.equal(bad.success ? "" : (bad.error.issues[0]?.message ?? ""), "This file type is not supported");
});

test("M-05: registerAssetSchema rejects disallowed mimeType", () => {
  const ok = registerAssetSchema.safeParse({ ...validRegister });
  assert.equal(ok.success, true);

  const bad = registerAssetSchema.safeParse({ ...validRegister, mimeType: "text/html" });
  assert.equal(bad.success, false, "text/html must be rejected for register");
});

test("M-05: replaceAssetSchema rejects disallowed mimeType", () => {
  const base = {
    fileKey: "media/org/a.png",
    fileUrl: "https://cdn/a.png",
    mimeType: "image/png",
    sizeBytes: 1024,
  };
  const ok = replaceAssetSchema.safeParse(base);
  assert.equal(ok.success, true);

  const bad = replaceAssetSchema.safeParse({ ...base, mimeType: "application/x-msdownload" });
  assert.equal(bad.success, false, "exe type must be rejected for replace");
});
