import test from "node:test";
import assert from "node:assert/strict";
import { userFiltersSchema } from "@/lib/validations/user.schema";

test("users filter: isActive=false means inactive (not coerced to true)", () => {
  assert.equal(userFiltersSchema.parse({ isActive: "false" }).isActive, false);
  assert.equal(userFiltersSchema.parse({ isActive: "true" }).isActive, true);
  assert.equal(userFiltersSchema.parse({}).isActive, undefined);
  assert.throws(() => userFiltersSchema.parse({ isActive: "maybe" }));
});
