import type { ConditionSpec } from "./types";

// ─── Condition evaluation ─────────────────────────────────────────────────────
//
// Conditions are evaluated against a flat context object built from the entity
// snapshot plus the triggering event payload under the `event` key:
//   { id, name, status, score, ..., event: { leadId, newStatus, ... } }
// Field paths support dots: "status", "event.newStatus", "admissions.0.stage".

export function resolvePath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function compare(op: string, actual: unknown, expected: unknown): boolean {
  switch (op) {
    case "eq":
      return actual === expected || String(actual) === String(expected);
    case "neq":
      return !(actual === expected || String(actual) === String(expected));
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const a = typeof actual === "string" && !isNaN(Date.parse(actual)) ? Date.parse(actual) : Number(actual);
      const b =
        typeof expected === "string" && !isNaN(Date.parse(expected)) ? Date.parse(expected) : Number(expected);
      if (typeof a !== "number" || typeof b !== "number" || isNaN(a) || isNaN(b)) return false;
      if (op === "gt") return a > b;
      if (op === "gte") return a >= b;
      if (op === "lt") return a < b;
      return a <= b;
    }
    case "contains":
      if (actual === null || actual === undefined) return false;
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case "in":
      return Array.isArray(expected) && expected.some((v) => String(v) === String(actual));
    case "notIn":
      return !(Array.isArray(expected) && expected.some((v) => String(v) === String(actual)));
    case "exists":
      return actual !== undefined && actual !== null;
    case "notExists":
      return actual === undefined || actual === null;
    default:
      return false;
  }
}

/** Structural check of the canonical grammar; stored JSON is never trusted. */
export function isConditionSpec(spec: unknown): spec is ConditionSpec {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return false;
  const s = spec as Record<string, unknown>;
  if ("all" in s) return Array.isArray(s.all) && s.all.length > 0 && s.all.every(isConditionSpec);
  if ("any" in s) return Array.isArray(s.any) && s.any.length > 0 && s.any.every(isConditionSpec);
  if ("not" in s) return isConditionSpec(s.not);
  return typeof s.field === "string" && s.field.length > 0 && typeof s.op === "string";
}

// A malformed spec evaluates to false (fail closed) instead of throwing, so one
// bad stored workflow can never abort matching for every other workflow.
export function evaluateCondition(spec: ConditionSpec | undefined, ctx: Record<string, unknown>): boolean {
  if (!spec) return true;
  if (!isConditionSpec(spec)) return false;

  if ("all" in spec) return spec.all.every((c) => evaluateCondition(c, ctx));
  if ("any" in spec) return spec.any.some((c) => evaluateCondition(c, ctx));
  if ("not" in spec) return !evaluateCondition(spec.not, ctx);

  const actual = resolvePath(ctx, spec.field);
  return compare(spec.op, actual, spec.value);
}
