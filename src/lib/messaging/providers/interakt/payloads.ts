import { splitIndianPhone } from "../../phone";
import { InteraktError } from "./errors";

// Trait sanitization per Interakt User Track docs: newline / tab / more than
// two consecutive spaces cause HTTP 400.

export function sanitizeTraitValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  const str = String(value)
    .replace(/[\n\t\r]+/g, " ")
    .replace(/ {3,}/g, "  ")
    .trim();
  return str.length ? str : null;
}

export function sanitizeTraits(traits: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, raw] of Object.entries(traits)) {
    const value = sanitizeTraitValue(raw);
    if (value === null) continue;
    out[key] = value;
  }
  return out;
}

export interface TrackUserInput {
  userId: string;
  phone: string;
  traits?: Record<string, unknown>;
  tags?: string[];
}

export interface TrackEventInput {
  userId: string;
  phone: string;
  event: string;
  traits?: Record<string, unknown>;
}

export interface SendTemplateInput {
  phone: string;
  templateName: string;
  languageCode?: string;
  bodyValues?: string[];
  headerValues?: string[];
  callbackData?: string;
  campaignId?: string;
  fileName?: string;
  buttonValues?: Record<string, string[]>;
}

export function buildTrackUserPayload(input: TrackUserInput) {
  const split = splitIndianPhone(input.phone);
  if (!split) {
    throw new InteraktError("INVALID_PHONE", `Cannot map phone to +91 national number: ${input.phone}`);
  }
  const tags = (input.tags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 50);

  return {
    userId: input.userId,
    phoneNumber: split.phoneNumber,
    countryCode: split.countryCode,
    traits: sanitizeTraits(input.traits ?? {}),
    ...(tags.length ? { tags } : {}),
  };
}

export function buildTrackEventPayload(input: TrackEventInput) {
  const split = splitIndianPhone(input.phone);
  if (!split) {
    throw new InteraktError("INVALID_PHONE", `Cannot map phone to +91 national number: ${input.phone}`);
  }
  return {
    userId: input.userId,
    phoneNumber: split.phoneNumber,
    countryCode: split.countryCode,
    event: input.event,
    traits: sanitizeTraits(input.traits ?? {}),
  };
}

export function buildSendTemplatePayload(input: SendTemplateInput) {
  const split = splitIndianPhone(input.phone);
  if (!split) {
    throw new InteraktError("INVALID_PHONE", `Cannot map phone to +91 national number: ${input.phone}`);
  }
  if (!input.templateName.trim()) {
    throw new InteraktError("TEMPLATE_REQUIRED", "Interakt Template Send requires template.name");
  }

  const callbackData = input.callbackData?.slice(0, 512);
  const languageCode = input.languageCode?.trim() || "en";

  return {
    countryCode: split.countryCode,
    phoneNumber: split.phoneNumber,
    type: "Template" as const,
    ...(callbackData ? { callbackData } : {}),
    ...(input.campaignId ? { campaignId: input.campaignId } : {}),
    template: {
      name: input.templateName.trim(),
      languageCode,
      ...(input.headerValues?.length ? { headerValues: input.headerValues } : {}),
      ...(input.fileName ? { fileName: input.fileName } : {}),
      ...(input.bodyValues?.length ? { bodyValues: input.bodyValues } : {}),
      ...(input.buttonValues && Object.keys(input.buttonValues).length
        ? { buttonValues: input.buttonValues }
        : {}),
    },
  };
}

export function buildCreateCampaignPayload(input: {
  campaignName: string;
  templateName: string;
  languageCode?: string;
}) {
  return {
    campaign_name: input.campaignName,
    campaign_type: "PublicAPI",
    template_name: input.templateName,
    language_code: input.languageCode?.trim() || "en",
  };
}

export function buildAssignChatPayload(input: {
  userPhoneNumber: string;
  agentEmail: string;
  wcId?: string;
}) {
  const split = splitIndianPhone(input.userPhoneNumber);
  const combined = split ? split.digits : input.userPhoneNumber.replace(/\D+/g, "");
  return {
    user_phone_number: combined,
    agent_email: input.agentEmail,
    ...(input.wcId ? { wc_id: input.wcId } : {}),
  };
}

export function buildGetUsersPayload(input?: { createdAfterUtc?: string; limit?: number; offset?: number }) {
  // Interakt Get Users 400s on `{ filters: [] }` (`NoneType...update`). Always send a date filter.
  const createdAfterUtc = input?.createdAfterUtc ?? "2020-01-01T00:00:00.000Z";
  return { filters: [{ trait: "created_at_utc", op: "gt", val: createdAfterUtc }] };
}
