// ─── Inbound WhatsApp payload normalization ──────────────────────────────────
//
// Webhook receivers speak many provider dialects. This module reduces them to
// one shape before any persistence happens:
//   { phone, body, externalId?, profileName? }
//
// Supported dialects:
// 1. Interakt message_received — data.customer + data.message
// 2. Meta WhatsApp Cloud API — entry[].changes[].value.messages[]
//    { from, id, text: { body }, type: "text" }
// 3. Generic flat JSON — every provider that can POST
//    { phone|from|customerPhone, text|message|body, id? }

import { normalizePhone } from "./phone";

export { normalizePhone };

export interface InboundWhatsAppMessage {
  phone: string;
  body: string;
  externalId?: string;
  profileName?: string;
  providerCustomerId?: string;
  userIdTrait?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

// ─── Dialect parsers ───────────────────────────────────────────────────────────

interface MetaMessage {
  from?: string;
  id?: string;
  type?: string;
  text?: { body?: string };
}

function fromInteraktReceived(payload: Record<string, unknown>): InboundWhatsAppMessage | null {
  const type = str(payload.type);
  if (type !== "message_received") return null;
  const data = asRecord(payload.data) ?? payload;
  const customer = asRecord(data.customer);
  const message = asRecord(data.message);
  if (!customer || !message) return null;

  const phone = normalizePhone(
    str(customer.channel_phone_number) ??
      `${str(customer.country_code) ?? ""}${str(customer.phone_number) ?? ""}`,
  );
  const content = message.message;
  const body =
    typeof content === "string" && content.trim()
      ? content.trim()
      : str(message.message_content_type)
        ? `[${str(message.message_content_type)}]`
        : undefined;
  if (!phone || !body) return null;

  const traits = asRecord(customer.traits);
  return {
    phone,
    body,
    externalId: str(message.id),
    profileName: traits ? str(traits.name) : undefined,
    providerCustomerId: str(customer.id),
    userIdTrait: traits ? str(traits["User Id"]) ?? str(traits.userId) : undefined,
  };
}

function fromMetaCloudApi(payload: Record<string, unknown>): InboundWhatsAppMessage | null {
  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const entryRec = asRecord(entry);
    const changes = entryRec && Array.isArray(entryRec.changes) ? entryRec.changes : [];
    for (const change of changes) {
      const changeRec = asRecord(change);
      const value = changeRec ? asRecord(changeRec.value) : null;
      const messages = value && Array.isArray(value.messages) ? (value.messages as MetaMessage[]) : [];
      for (const msg of messages) {
        const body = str(msg.text?.body);
        const from = str(msg.from);
        if (!from || !body) continue;
        return {
          phone: normalizePhone(from),
          body,
          externalId: str(msg.id),
        };
      }
    }
  }
  return null;
}

function fromFlatJson(payload: Record<string, unknown>): InboundWhatsAppMessage | null {
  const phone = normalizePhone(
    str(payload.phone) ?? str(payload.from) ?? str(payload.customerPhone) ?? str(payload.waPhone) ?? "",
  );
  const body =
    str(payload.text) ??
    str(payload.message) ??
    str(payload.body) ??
    (asRecord(payload.text) ? str(asRecord(payload.text)!.body) : undefined);
  if (!phone || !body) return null;
  return {
    phone,
    body,
    externalId: str(payload.id) ?? str(payload.messageId) ?? str(payload.externalId),
    profileName: str(payload.profileName) ?? str(payload.name),
  };
}

/**
 * Parse an arbitrary webhook payload into an inbound message.
 * Returns null when no known dialect matches — callers decide whether to
 * skip or reject.
 */
export function parseInboundWhatsApp(payload: unknown): InboundWhatsAppMessage | null {
  const rec = asRecord(payload);
  if (!rec) return null;
  return fromInteraktReceived(rec) ?? fromMetaCloudApi(rec) ?? fromFlatJson(rec);
}

// ─── Opt-out / opt-in keyword detection ────────────────────────────────────────
//
// Whole-word matches on the uppercased body. Kept deliberately conservative —
// a wrong opt-out silently kills every automation for that contact.

const OPT_OUT_RE = /\b(STOP|STOPALL|UNSUBSCRIBE|OPTOUT|OPT\s+OUT|CANCEL|END|QUIT)\b/;
const OPT_IN_RE = /\b(START|SUBSCRIBE|OPTIN|OPT\s+IN|RESUME)\b/;

export function isOptOutKeyword(body: string): boolean {
  return OPT_OUT_RE.test(body.toUpperCase());
}

export function isOptInKeyword(body: string): boolean {
  return OPT_IN_RE.test(body.toUpperCase());
}
