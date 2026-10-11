import { getInteraktTemplateLanguage } from "./config";

export interface InboxSendContext {
  typedMessage: string;
  lead: { name: string | null; courseInterest: string | null } | null;
}

export type InboxTemplateBuildResult =
  | {
      ok: true;
      templateName: string;
      templateLanguage: string;
      bodyValues?: string[];
      /** Stored/displayed in CRM thread — not necessarily identical to Interakt template body. */
      displayBody: string;
    }
  | { ok: false; error: string };

/** Explicit CRM → Interakt template variable mappings supported for inbox sends. */
const INBOX_VARIABLE_RESOLVERS: Record<string, (ctx: InboxSendContext) => string | null> = {
  leadName: (ctx) => ctx.lead?.name?.trim() || null,
  courseInterest: (ctx) => ctx.lead?.courseInterest?.trim() || null,
  message: (ctx) => ctx.typedMessage.trim() || null,
};

export function buildInboxTemplatePayload(
  templateName: string,
  variableNames: string[],
  ctx: InboxSendContext,
): InboxTemplateBuildResult {
  const templateLanguage = getInteraktTemplateLanguage();

  if (variableNames.length === 0) {
    const displayBody =
      ctx.typedMessage.trim() ||
      `WhatsApp template "${templateName}" (approved template — fixed Interakt copy)`;
    return { ok: true, templateName, templateLanguage, displayBody };
  }

  const bodyValues: string[] = [];
  for (const varName of variableNames) {
    const resolve = INBOX_VARIABLE_RESOLVERS[varName];
    if (!resolve) {
      return {
        ok: false,
        error: `Template "${templateName}" uses unsupported variable "${varName}". Supported: ${Object.keys(INBOX_VARIABLE_RESOLVERS).join(", ")}.`,
      };
    }
    const value = resolve(ctx);
    if (!value) {
      return {
        ok: false,
        error: `Template "${templateName}" requires "${varName}" but this conversation has no value for it.`,
      };
    }
    bodyValues.push(value);
  }

  const displayBody = ctx.typedMessage.trim()
    ? `[${templateName}] ${bodyValues.join(" · ")} — note: ${ctx.typedMessage.trim()}`
    : `[${templateName}] ${bodyValues.join(" · ")}`;

  return { ok: true, templateName, templateLanguage, bodyValues, displayBody };
}
