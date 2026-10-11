/** Server-side Interakt configuration — single source for template defaults. */

export function getInteraktDefaultTemplate(): string | undefined {
  return process.env.INTERAKT_DEFAULT_TEMPLATE?.trim() || undefined;
}

export function getInteraktTemplateLanguage(): string {
  return process.env.INTERAKT_TEMPLATE_LANGUAGE?.trim() || "en";
}

/**
 * Ordered CRM variable slots for the default inbox template when no
 * NotificationTemplate row exists. Example: "leadName" or "leadName,courseInterest".
 */
export function getDefaultInboxTemplateVariableNames(): string[] {
  const raw = process.env.INTERAKT_DEFAULT_TEMPLATE_VARIABLES?.trim();
  if (raw) {
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
  }
  // Approved nurture templates (e.g. cpl_nurture_d1_welcome_brochure) use {{1}} = lead name.
  return ["leadName"];
}
