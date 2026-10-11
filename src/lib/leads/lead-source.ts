import { LeadSource } from "@prisma/client";

const SOURCE_LABEL_OVERRIDES: Partial<Record<LeadSource, string>> = {
  HOMEPAGE_CTA: "Homepage CTA",
  WHATSAPP: "WhatsApp",
  WALK_IN: "Walk-in",
  VOICE_AGENT: "Voice Agent",
};

export function leadSourceLabel(source: string): string {
  const override = SOURCE_LABEL_OVERRIDES[source as LeadSource];
  if (override) return override;
  return source
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Every canonical lead source, in enum order, for selects and filters. */
export const LEAD_SOURCE_OPTIONS: { value: LeadSource; label: string }[] = Object.values(LeadSource).map((value) => ({
  value,
  label: leadSourceLabel(value),
}));
