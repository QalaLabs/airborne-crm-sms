import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_TEMPLATE_VARIABLES,
  extractTemplateVariables,
  validateTemplatePlaceholders,
  outreachTemplateSchema,
} from "./outreach.schema";

test("extractTemplateVariables finds deduped insertion-ordered placeholders", () => {
  assert.deepEqual(
    extractTemplateVariables("Hi {{ leadName }}, pay {{ amount }} by {{dueDate}}"),
    ["leadName", "amount", "dueDate"],
  );
  assert.deepEqual(extractTemplateVariables("no variables"), []);
  assert.deepEqual(extractTemplateVariables("{{ leadName }} and {{ leadName }} again"), ["leadName"]);
});

test("allowlist contains the documented CRM variables", () => {
  assert.ok(ALLOWED_TEMPLATE_VARIABLES.includes("leadName"));
  assert.ok(ALLOWED_TEMPLATE_VARIABLES.includes("counselorName"));
  assert.ok(ALLOWED_TEMPLATE_VARIABLES.includes("amount"));
  assert.ok(ALLOWED_TEMPLATE_VARIABLES.includes("dueDate"));
  assert.ok(ALLOWED_TEMPLATE_VARIABLES.includes("link"));
});

test("validateTemplatePlaceholders flags unknown placeholders and declarations", () => {
  const bad = validateTemplatePlaceholders({
    subject: "Hi {{firstName}}",
    body: "Balance {{amount}} due {{dueDate}}. System {{dbHost}}.",
    variables: ["firstName", "notAllowed"],
  });
  assert.deepEqual(bad.invalidPlaceholders, ["dbHost"]);
  assert.deepEqual(bad.invalidDeclared, ["notAllowed"]);
});

test("validateTemplatePlaceholders passes clean templates (empty arrays)", () => {
  const ok = validateTemplatePlaceholders({
    subject: "Hi {{firstName}}",
    body: "Your {{amount}} payment is due {{dueDate}} — {{link}}",
    variables: ["firstName", "amount", "dueDate", "link"],
  });
  assert.deepEqual(ok, { invalidPlaceholders: [], invalidDeclared: [] });
});

test("outreachTemplateSchema rejects unsafe placeholders at parse", () => {
  const res = outreachTemplateSchema.safeParse({
    event: "NEW_LEAD",
    channel: "WHATSAPP",
    name: "Unsafe",
    body: "Hi {{leadName}} from {{hacker_var}}",
  });
  assert.equal(res.success, false);
  if (!res.success) {
    assert.ok(JSON.stringify(res.error.issues).includes("Unsafe template variables"));
  }
});

test("outreachTemplateSchema rejects unallowed declared variables", () => {
  const res = outreachTemplateSchema.safeParse({
    event: "NEW_LEAD",
    channel: "WHATSAPP",
    name: "Declared bad",
    body: "Hi {{leadName}}",
    variables: ["leadName", "secretVar"],
  });
  assert.equal(res.success, false);
});

test("outreachTemplateSchema accepts a clean template", () => {
  const res = outreachTemplateSchema.safeParse({
    event: "NEW_LEAD",
    channel: "WHATSAPP",
    name: "Clean",
    body: "Hi {{leadName}} — your {{amount}} payment is due {{dueDate}}.",
    variables: ["leadName", "amount", "dueDate"],
  });
  assert.equal(res.success, true);
});