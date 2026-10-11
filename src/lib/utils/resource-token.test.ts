/**
 * M-06 remediation gate: the signed-download / intake gate token must be
 * fail-closed. With PUBLIC_INTAKE_KEY unset (or left on the legacy placeholder)
 * we must refuse to mint a token and refuse to validate any token — never fall
 * back to the known committed dev secret.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { generateResourceToken, verifyResourceToken } from "./resource-token";

function unsetKey(): void {
  delete (process.env as Record<string, string | undefined>).PUBLIC_INTAKE_KEY;
}

function setKey(v: string): void {
  (process.env as Record<string, string | undefined>).PUBLIC_INTAKE_KEY = v;
}

test("M-06: generate throws when PUBLIC_INTAKE_KEY is unset (no dev-fallback literal)", () => {
  unsetKey();
  assert.throws(() => generateResourceToken("91 9999999999"), /PUBLIC_INTAKE_KEY is not configured/);
});

test("M-06: generate throws when PUBLIC_INTAKE_KEY is the legacy placeholder", () => {
  setKey("dev-fallback-secret");
  assert.throws(() => generateResourceToken("91 9999999999"), /PUBLIC_INTAKE_KEY is not configured/);
});

test("M-06: verify fails closed (invalid) when PUBLIC_INTAKE_KEY is unset", () => {
  unsetKey();
  const res = verifyResourceToken("abc.def");
  assert.equal(res.valid, false, "token must verify as invalid without a configured key");
});

test("M-06: happy path round-trips when a real key is configured", () => {
  setKey(`real-${Date.now()}-secret`);
  const token = generateResourceToken("91 9999999999");
  assert.ok(token.includes("."));
  const res = verifyResourceToken(token);
  assert.equal(res.valid, true);
  assert.equal(res.phone, "91 9999999999");
});

test("M-06: tampered token fails under a real key", () => {
  setKey(`real-${Date.now()}-secret2`);
  const token = generateResourceToken("91 9999999999");
  const tampered = `${token.slice(0, -3)}fff`;
  const res = verifyResourceToken(tampered);
  assert.equal(res.valid, false);
});
