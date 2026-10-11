import assert from "node:assert/strict";
import { test } from "node:test";
import { safeEqualString, sha256 } from "./crypto";

test("safeEqualString matches equal strings", () => {
  assert.equal(safeEqualString("abc", "abc"), true);
  assert.equal(safeEqualString("", ""), true);
  assert.equal(safeEqualString("sup3r-secret!", "sup3r-secret!"), true);
});

test("safeEqualString rejects mismatches", () => {
  assert.equal(safeEqualString("abc", "abd"), false);
  assert.equal(safeEqualString("abc", "abcd"), false);
  assert.equal(safeEqualString("", "a"), false);
  assert.equal(safeEqualString("a", ""), false);
});

test("safeEqualString rejects null/undefined", () => {
  assert.equal(safeEqualString(null, "abc"), false);
  assert.equal(safeEqualString("abc", null), false);
  assert.equal(safeEqualString(undefined, undefined), false);
  assert.equal(safeEqualString(null, null), false);
});

test("safeEqualString compares unicode as utf-8 bytes", () => {
  assert.equal(safeEqualString("héllo", "héllo"), true);
  assert.equal(safeEqualString("héllo", "hello"), false);
});

test("sha256 produces stable hex", () => {
  assert.equal(sha256("attacker@example.com"), sha256("attacker@example.com"));
  assert.equal(sha256("attacker@example.com").length, 64);
  assert.notEqual(sha256("a@example.com"), sha256("b@example.com"));
});