import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { HONEYPOT_FIELD, isHoneypotTripped } from "./honeypot";

test("empty / missing honeypot passes, filled honeypot trips", () => {
  assert.equal(isHoneypotTripped({}), false);
  assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD]: "" }), false);
  assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD]: " " }), false);
  assert.equal(isHoneypotTripped(null), false);
  assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD]: "spam" }), true);
  assert.equal(isHoneypotTripped({ [HONEYPOT_FIELD]: 1 }), true);
});

test("admin and marketing site agree on the honeypot field name", () => {
  const web = readFileSync(path.resolve(process.cwd(), "../src/utils/honeypot.js"), "utf8");
  assert.match(web, new RegExp(`HONEYPOT_FIELD = '${HONEYPOT_FIELD}'`));
});
