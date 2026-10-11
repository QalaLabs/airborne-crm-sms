import { test } from "node:test";
import assert from "node:assert/strict";
import { toPublicResource, resolveGatedDownloadUrl } from "./public-resource";
import { safeHttpUrl } from "../utils/safe-url";
import { createResourceSchema } from "../validations/resource.schema";

const base = { id: "r1", isGated: false, fileUrl: null, externalUrl: null };

test("non-gated external resource keeps its http(s) externalUrl", () => {
  const out = toPublicResource({ ...base, externalUrl: "https://example.com/guide" });
  assert.equal(out.externalUrl, "https://example.com/guide");
  assert.equal(out.fileUrl, null);
});

test("non-gated file resource keeps fileUrl", () => {
  const out = toPublicResource({ ...base, fileUrl: "https://storage.googleapis.com/b/f.pdf" });
  assert.equal(out.fileUrl, "https://storage.googleapis.com/b/f.pdf");
});

test("gated resource never exposes fileUrl or externalUrl", () => {
  const out = toPublicResource({ ...base, isGated: true, fileUrl: "https://x/f.pdf", externalUrl: "https://x/e" });
  assert.equal(out.fileUrl, null);
  assert.equal(out.externalUrl, null);
});

test("malicious or relative URLs are dropped", () => {
  for (const bad of ["javascript:alert(1)", "data:text/html,<script>", "//evil.com", "/relative", "ftp://x/y", "  "]) {
    assert.equal(safeHttpUrl(bad), null, bad);
    assert.equal(toPublicResource({ ...base, externalUrl: bad }).externalUrl, null, bad);
  }
});

test("gated download prefers file, falls back to external, rejects unsafe", () => {
  assert.equal(resolveGatedDownloadUrl({ fileUrl: "https://a/f.pdf", externalUrl: "https://b" }), "https://a/f.pdf");
  assert.equal(resolveGatedDownloadUrl({ fileUrl: null, externalUrl: "https://b/" }), "https://b/");
  assert.equal(resolveGatedDownloadUrl({ fileUrl: "javascript:x", externalUrl: null }), null);
});

test("admin resource schema rejects non-http externalUrl", () => {
  const ok = createResourceSchema.safeParse({ title: "t", type: "LINK", externalUrl: "https://example.com" });
  assert.equal(ok.success, true);
  const bad = createResourceSchema.safeParse({ title: "t", type: "LINK", externalUrl: "javascript:alert(1)" });
  assert.equal(bad.success, false);
});
