import test from "node:test";
import assert from "node:assert/strict";
import { formatApiErrorMessage } from "@/lib/api";

test("validation errors surface the field-level reasons", () => {
  const msg = formatApiErrorMessage(
    {
      message: "Request validation failed",
      details: [
        { path: ["lastName"], message: "String must contain at least 1 character(s)" },
        { path: ["guardianEmail"], message: "Invalid email" },
      ],
    },
    400,
  );
  assert.equal(
    msg,
    "Request validation failed — lastName: String must contain at least 1 character(s); guardianEmail: Invalid email",
  );
});

test("service ValidationError details without a path still show the message", () => {
  assert.equal(
    formatApiErrorMessage({ message: "Request validation failed", details: [{ message: "Cannot move ACTIVE → ALUMNI" }] }, 400),
    "Request validation failed — Cannot move ACTIVE → ALUMNI",
  );
});

test("falls back to the base message or HTTP status", () => {
  assert.equal(formatApiErrorMessage({ message: "Not found" }, 404), "Not found");
  assert.equal(formatApiErrorMessage(undefined, 502), "HTTP 502");
  assert.equal(formatApiErrorMessage({ message: "Bad", details: ["x", 1] }, 400), "Bad");
});
