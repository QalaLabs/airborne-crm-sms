import { z } from "zod";

// ─── Template variables (Section 5: no arbitrary unsafe interpolation) ───────
//
// Templates may only reference a known, curated variable set. Anything else is
// rejected at creation/toggle time. The known set covers the CRM person, their
// counselor, the course and ledger facts that notification composition can
// provide today. Unknown placeholders fail loudly instead of silently leaking
// raw `{{...}}` into composed messages.

export const ALLOWED_TEMPLATE_VARIABLES = [
  "leadName",
  "firstName",
  "lastName",
  "phone",
  "email",
  "courseName",
  "counselorName",
  "amount",
  "dueDate",
  "link",
] as const;

export type AllowedTemplateVariable = (typeof ALLOWED_TEMPLATE_VARIABLES)[number];

/** All `{{var}}` placeholders found in a text, deduped, insertion ordered. */
export function extractTemplateVariables(text: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[1] !== undefined) found.add(m[1]);
  }
  return [...found];
}

/**
 * Validate that every placeholder used in subject/body is part of the known
 * variable set. Returns the list of offending placeholder names (empty when OK)
 * plus the declared-variable entries that are not on the allowlist.
 */
export function validateTemplatePlaceholders(input: {
  subject?: string | null;
  body: string;
  variables?: string[];
}): { invalidPlaceholders: string[]; invalidDeclared: string[] } {
  const used = extractTemplateVariables(`${input.subject ?? ""}\n${input.body}`);
  const allowlist = new Set<string>(ALLOWED_TEMPLATE_VARIABLES);
  const declared = [...new Set((input.variables ?? []).map((v) => v.trim()).filter(Boolean))];

  const invalidPlaceholders = used.filter((v) => !allowlist.has(v));
  const invalidDeclared = declared.filter((v) => !allowlist.has(v));

  return { invalidPlaceholders, invalidDeclared };
}

export const outreachTemplateSchema = z
  .object({
    id: z.string().uuid().optional(),
    event: z.enum([
      "NEW_LEAD",
      "LEAD_ASSIGNED",
      "LEAD_STATUS_CHANGED",
      "ADMISSION_STAGE_CHANGED",
      "JOB_PUBLISHED",
      "TESTIMONIAL_SUBMITTED",
      "PAYMENT_RECEIVED",
      "PLACEMENT_ADDED",
      "ENQUIRY_RECEIVED",
      "USER_INVITED",
      "TASK_DUE",
      "WORKFLOW_TRIGGERED",
    ]),
    channel: z.enum(["EMAIL", "SMS", "WHATSAPP", "IN_APP"]),
    name: z.string().min(1).max(255),
    subject: z.string().max(500).nullable().optional(),
    body: z.string().min(1),
    variables: z.array(z.string()).default([]),
    isActive: z.boolean().optional(),
  })
  .superRefine((val, ctx) => {
    const { invalidPlaceholders, invalidDeclared } = validateTemplatePlaceholders(val);
    const problems = [...new Set([...invalidPlaceholders, ...invalidDeclared])];
    if (problems.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["body"],
        message: `Unsafe template variables: ${problems.join(", ")}. Allowed: ${ALLOWED_TEMPLATE_VARIABLES.join(", ")}`,
      });
    }
  });

export const toggleTemplateSchema = z.object({
  id: z.string().uuid(),
  isActive: z.boolean(),
});