import assert from "node:assert/strict";
import { test } from "node:test";
import { getDefaultInboxTemplateVariableNames } from "./config";
import { buildInboxTemplatePayload } from "./inbox-template";

test("default inbox variables fall back to leadName", () => {
  const prev = process.env.INTERAKT_DEFAULT_TEMPLATE_VARIABLES;
  delete process.env.INTERAKT_DEFAULT_TEMPLATE_VARIABLES;
  try {
    assert.deepEqual(getDefaultInboxTemplateVariableNames(), ["leadName"]);
  } finally {
    if (prev !== undefined) process.env.INTERAKT_DEFAULT_TEMPLATE_VARIABLES = prev;
  }
});

test("buildInboxTemplatePayload maps leadName for nurture template", () => {
  const built = buildInboxTemplatePayload(
    "cpl_nurture_d1_welcome_brochure",
    ["leadName"],
    { typedMessage: "", lead: { name: "Riya Sharma", courseInterest: "CPL" } },
  );
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.templateName, "cpl_nurture_d1_welcome_brochure");
  assert.deepEqual(built.bodyValues, ["Riya Sharma"]);
});

test("buildInboxTemplatePayload fails when leadName missing", () => {
  const built = buildInboxTemplatePayload(
    "cpl_nurture_d1_welcome_brochure",
    ["leadName"],
    { typedMessage: "hello", lead: null },
  );
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.match(built.error, /leadName/);
});

test("buildInboxTemplatePayload rejects unsupported variable names", () => {
  const built = buildInboxTemplatePayload(
    "cpl_nurture_d1_welcome_brochure",
    ["unknownSlot"],
    { typedMessage: "", lead: { name: "Riya", courseInterest: null } },
  );
  assert.equal(built.ok, false);
  if (built.ok) return;
  assert.match(built.error, /unsupported variable/);
});

test("buildInboxTemplatePayload allows zero-variable templates", () => {
  const built = buildInboxTemplatePayload("static_template", [], {
    typedMessage: "",
    lead: null,
  });
  assert.equal(built.ok, true);
  if (!built.ok) return;
  assert.equal(built.bodyValues, undefined);
});
