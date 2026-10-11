import test from "node:test";
import assert from "node:assert/strict";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ValidationError, NotFoundError } from "./errors";
import { handleError } from "./response";

async function statusOf(res: NextResponse): Promise<number> {
  return res.status;
}

async function bodyOf(res: NextResponse): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

test("P2023 (non-UUID in path) maps to 400 INVALID_IDENTIFIER", async () => {
  const err = Object.assign(new Error("Inconsistent column data: Failed to decode Uuid..."), { code: "P2023" });
  const res = handleError(err);
  assert.equal(await statusOf(res), 400);
  const body = await bodyOf(res);
  assert.equal((body.error as { code: string }).code, "INVALID_IDENTIFIER");
});

test("P2023 duck-typed (string code on object) still maps to 400", async () => {
  const err = { code: "P2023", message: "raw" } as unknown;
  const res = handleError(err);
  assert.equal(await statusOf(res), 400);
});

test("P2002 or other Prisma errors are NOT misclassified as 400", async () => {
  const err = Object.assign(new Error("Unique constraint"), { code: "P2002" });
  const res = handleError(err);
  assert.equal(await statusOf(res), 500);
});

test("ZodError maps to 400 VALIDATION_ERROR", async () => {
  const schema = ZodError.create([
    { code: "custom", path: ["x"], message: "bad" },
  ]);
  const res = handleError(schema);
  assert.equal(await statusOf(res), 400);
  const body = await bodyOf(res);
  assert.equal((body.error as { code: string }).code, "VALIDATION_ERROR");
});

test("AppError preserves its status code", async () => {
  const res = handleError(new ValidationError([{ message: "nope" }]));
  assert.equal(await statusOf(res), 400);
  const nf = handleError(new NotFoundError("Lead", "id"));
  assert.equal(await statusOf(nf), 404);
});

test("unknown error stays a generic 500", async () => {
  const res = handleError(new Error("boom"));
  assert.equal(await statusOf(res), 500);
});