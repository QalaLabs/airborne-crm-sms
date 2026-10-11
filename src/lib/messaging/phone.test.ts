import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, contactCandidates, splitIndianPhone } from "./phone";

test("normalizePhone strips all non-digits", () => {
  assert.equal(normalizePhone("+91 98765 43210"), "919876543210");
  assert.equal(normalizePhone("919876543210"), "919876543210");
  assert.equal(normalizePhone("(91) 98-765-43210"), "919876543210");
  assert.equal(normalizePhone(""), "");
});

test("contactCandidates covers raw/digits/+91/national/last-10 forms", () => {
  const c = contactCandidates("+91 98765 43210");
  assert.ok(c.includes("919876543210"));
  assert.ok(c.includes("+919876543210"));
  assert.ok(c.includes("9876543210"), "national 10-digit form present");
  // Every candidate must be a plausible storage/matching string.
  for (const candidate of c) {
    assert.ok(candidate.replace(/\D+/g, "").length >= 10);
  }
});

test("contactCandidates handles already-normalized 10-digit input", () => {
  const c = contactCandidates("9876543210");
  assert.ok(c.includes("9876543210"));
  assert.ok(c.includes("919876543210"), "international form derived");
  assert.ok(c.includes("+919876543210"));
});

test("contactCandidates handles 91-prefixed 12-digit input", () => {
  const c = contactCandidates("919876543210");
  assert.ok(c.includes("919876543210"));
  assert.ok(c.includes("9876543210"));
  assert.ok(c.includes("+919876543210"));
});

test("contactCandidates returns empty for junk / empty input", () => {
  assert.deepEqual(contactCandidates(""), []);
  assert.deepEqual(contactCandidates("abc"), []);
});

test("splitIndianPhone resolves +91 and 91-prefixed numbers", () => {
  assert.deepEqual(splitIndianPhone("+919876543210"), {
    countryCode: "+91",
    phoneNumber: "9876543210",
    digits: "919876543210",
  });
  assert.deepEqual(splitIndianPhone("919876543210"), {
    countryCode: "+91",
    phoneNumber: "9876543210",
    digits: "919876543210",
  });
  assert.equal(splitIndianPhone("12345"), null);
  assert.equal(splitIndianPhone(""), null);
});