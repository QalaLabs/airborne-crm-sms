import { createHmac, timingSafeEqual } from "node:crypto";
import { decodeCorrelation, type CorrelationPayload } from "./correlation";
import { normalizePhone } from "../../phone";
import { safeEqualString } from "../../../utils/crypto";

// Official Interakt webhook types (https://www.interakt.shop/resource-center/interakts-webhooks/)
export const INTERAKT_STATUS_TYPES = [
  "message_api_sent",
  "message_api_delivered",
  "message_api_read",
  "message_api_failed",
  "message_campaign_sent",
  "message_campaign_delivered",
  "message_campaign_read",
  "message_campaign_failed",
] as const;

export const INTERAKT_CLICK_TYPES = ["message_api_clicked"] as const;
export const INTERAKT_INBOUND_TYPES = ["message_received"] as const;

export type InteraktWebhookType =
  | (typeof INTERAKT_STATUS_TYPES)[number]
  | (typeof INTERAKT_CLICK_TYPES)[number]
  | (typeof INTERAKT_INBOUND_TYPES)[number]
  | string;

export type InternalDeliveryStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface NormalizedInteraktWebhook {
  type: InteraktWebhookType;
  kind: "inbound" | "status" | "click" | "ignored";
  phone: string;
  body: string;
  providerMessageId?: string;
  providerCustomerId?: string;
  providerStatus?: string;
  internalStatus?: InternalDeliveryStatus;
  failureReason?: string;
  channelErrorCode?: string;
  callbackData?: CorrelationPayload | null;
  campaignId?: string;
  receivedAt?: string;
  timestamp?: string;
  profileName?: string;
  userIdTrait?: string;
}

const STATUS_RANK: Record<InternalDeliveryStatus, number> = {
  SENT: 1,
  FAILED: 1,
  DELIVERED: 2,
  READ: 3,
};

export function mapProviderStatus(raw: string | undefined, type: string): InternalDeliveryStatus | undefined {
  const fromType = type.toLowerCase();
  if (fromType.endsWith("_failed")) return "FAILED";
  if (fromType.endsWith("_read")) return "READ";
  if (fromType.endsWith("_delivered")) return "DELIVERED";
  if (fromType.endsWith("_sent")) return "SENT";

  const status = (raw ?? "").toLowerCase();
  if (status === "failed") return "FAILED";
  if (status === "read") return "READ";
  if (status === "delivered") return "DELIVERED";
  if (status === "sent") return "SENT";
  return undefined;
}

/** True when `next` should overwrite `current` (never downgrade READ → DELIVERED). */
export function shouldUpgradeStatus(current: string, next: InternalDeliveryStatus): boolean {
  if (current === next) return false;
  if (next === "FAILED") return current !== "READ" && current !== "DELIVERED";
  const curRank = STATUS_RANK[current as InternalDeliveryStatus] ?? 0;
  return STATUS_RANK[next] > curRank;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Interakt Developer Settings HMAC key.
 * Secret Manager / console pastes often include a trailing newline or UTF-8 BOM;
 * those extra bytes are not part of the key Interakt uses to sign requests.
 */
type WebhookSecretEnv = {
  INTERAKT_WEBHOOK_SECRET?: string;
  WHATSAPP_WEBHOOK_SECRET?: string;
};

export function loadInteraktWebhookSecret(source?: WebhookSecretEnv): string | undefined {
  const raw = (source ?? (process.env as WebhookSecretEnv)).INTERAKT_WEBHOOK_SECRET;
  if (raw == null) return undefined;
  const normalized = raw.replace(/^\uFEFF/, "").trim();
  return normalized || undefined;
}

export function loadLegacyWhatsAppWebhookSecret(source?: WebhookSecretEnv): string | undefined {
  const raw = (source ?? (process.env as WebhookSecretEnv)).WHATSAPP_WEBHOOK_SECRET;
  if (raw == null) return undefined;
  const normalized = raw.replace(/^\uFEFF/, "").trim();
  return normalized || undefined;
}

export type InteraktSignaturePrefix = "sha256=" | "none" | "other";

export interface InteraktSignatureDiagnostics {
  secretConfigured: boolean;
  secretLength: number;
  receivedPrefix: InteraktSignaturePrefix;
  receivedSignatureLength: number;
  computedSignatureLength: number;
  rawBodyBytes: number;
  comparisonFailed: true;
  headerParseFailed: boolean;
}

function rawBodyBuffer(rawBody: string | Buffer): Buffer {
  return Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
}

/** Hex HMAC-SHA256 of the exact raw body bytes. Official Interakt form is `sha256=` + this. */
export function computeInteraktSignatureHex(rawBody: string | Buffer, secret: string): string {
  const body = rawBodyBuffer(rawBody);
  return createHmac("sha256", Buffer.from(secret, "utf8")).update(body).digest("hex");
}

export function signInteraktPayload(rawBody: string | Buffer, secret: string): string {
  return `sha256=${computeInteraktSignatureHex(rawBody, secret)}`;
}

export function describeInteraktSignaturePrefix(header: string | null | undefined): InteraktSignaturePrefix {
  if (!header) return "none";
  const trimmed = header.trim();
  if (/^sha256\s*=/i.test(trimmed)) return "sha256=";
  if (/^[0-9a-fA-F]+$/.test(trimmed)) return "none";
  return "other";
}

function parseProvidedDigest(header: string): Buffer | null {
  const trimmed = header.trim().replace(/^["']|["']$/g, "").trim();
  const prefixed = /^sha256\s*=\s*([0-9a-fA-F]+)$/i.exec(trimmed);
  const hex = prefixed?.[1] ?? (/^[0-9a-fA-F]{64}$/.test(trimmed) ? trimmed : undefined);
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

function signatureDiagnostics(
  body: Buffer,
  header: string | null,
  secret: string | undefined,
  extra?: { headerParseFailed?: boolean },
): InteraktSignatureDiagnostics {
  const computedHex = secret ? computeInteraktSignatureHex(body, secret) : "";
  return {
    secretConfigured: Boolean(secret),
    secretLength: secret ? secret.length : 0,
    receivedPrefix: describeInteraktSignaturePrefix(header),
    receivedSignatureLength: header ? header.trim().length : 0,
    computedSignatureLength: secret ? `sha256=${computedHex}`.length : 0,
    rawBodyBytes: body.length,
    comparisonFailed: true,
    headerParseFailed: extra?.headerParseFailed ?? false,
  };
}

/**
 * HMAC-SHA256 of the exact raw HTTP body, header form `sha256=<hex>`.
 * Docs: https://www.interakt.shop/resource-center/interakts-webhooks/
 * Compare digests (not re-stringified JSON). timingSafeEqual requires equal lengths.
 */
export function inspectInteraktSignature(
  rawBody: string | Buffer,
  header: string | null,
  secret: string,
): { ok: true } | { ok: false; diagnostics: InteraktSignatureDiagnostics } {
  const body = rawBodyBuffer(rawBody);
  if (!header || !secret) {
    return { ok: false, diagnostics: signatureDiagnostics(body, header, secret || undefined, { headerParseFailed: !header }) };
  }

  const providedDigest = parseProvidedDigest(header);
  if (!providedDigest) {
    return { ok: false, diagnostics: signatureDiagnostics(body, header, secret, { headerParseFailed: true }) };
  }

  const expectedDigest = Buffer.from(computeInteraktSignatureHex(body, secret), "hex");
  if (providedDigest.length !== expectedDigest.length) {
    return { ok: false, diagnostics: signatureDiagnostics(body, header, secret, { headerParseFailed: true }) };
  }
  if (timingSafeEqual(providedDigest, expectedDigest)) return { ok: true };
  return { ok: false, diagnostics: signatureDiagnostics(body, header, secret) };
}

export function verifyInteraktSignature(
  rawBody: string | Buffer,
  header: string | null,
  secret: string,
): boolean {
  return inspectInteraktSignature(rawBody, header, secret).ok;
}

export type WhatsAppWebhookAuthFailure = "not_configured" | "invalid_signature" | "invalid_secret";

export function authorizeWhatsAppWebhookPost(input: {
  rawBody: string | Buffer;
  interaktSignature: string | null;
  sharedSecretHeader: string | null;
  querySecret: string | null;
  interaktWebhookSecret: string | undefined;
  legacyWebhookSecret: string | undefined;
}):
  | { ok: true; method: "interakt-signature" | "shared-secret" }
  | { ok: false; error: WhatsAppWebhookAuthFailure; diagnostics?: InteraktSignatureDiagnostics } {
  const { interaktSignature, interaktWebhookSecret, legacyWebhookSecret } = input;

  if (interaktSignature) {
    if (!interaktWebhookSecret) {
      return {
        ok: false,
        error: "not_configured",
        diagnostics: signatureDiagnostics(rawBodyBuffer(input.rawBody), interaktSignature, undefined, {
          headerParseFailed: false,
        }),
      };
    }
    const result = inspectInteraktSignature(input.rawBody, interaktSignature, interaktWebhookSecret);
    if (!result.ok) return { ok: false, error: "invalid_signature", diagnostics: result.diagnostics };
    return { ok: true, method: "interakt-signature" };
  }

  const shared = interaktWebhookSecret || legacyWebhookSecret;
  if (!shared) return { ok: false, error: "not_configured" };
  const provided = input.sharedSecretHeader ?? input.querySecret;
  if (!safeEqualString(provided, shared)) return { ok: false, error: "invalid_secret" };
  return { ok: true, method: "shared-secret" };
}

function callbackFromMessage(message: Record<string, unknown>): CorrelationPayload | null {
  const meta = asRecord(message.meta_data) ?? asRecord(message.metaData);
  const sourceData = meta ? (asRecord(meta.source_data) ?? asRecord(meta.sourceData)) : null;
  const raw =
    str(sourceData?.callback_data) ??
    str(sourceData?.callbackData) ??
    str(message.callbackData) ??
    str(message.callback_data);
  return decodeCorrelation(raw);
}

function phoneFromCustomer(customer: Record<string, unknown> | null): string {
  if (!customer) return "";
  const channel = str(customer.channel_phone_number) ?? str(customer.channelPhoneNumber);
  if (channel) return normalizePhone(channel);
  const country = str(customer.country_code) ?? str(customer.countryCode) ?? "";
  const national = str(customer.phone_number) ?? str(customer.phoneNumber) ?? "";
  return normalizePhone(`${country}${national}`);
}

function bodyFromMessage(message: Record<string, unknown>): string {
  const content = message.message;
  if (typeof content === "string" && content.trim()) return content.trim();
  const type = str(message.message_content_type) ?? str(message.messageContentType) ?? "Unknown";
  const media = str(message.media_url) ?? str(message.mediaUrl);
  if (media) return `[${type}] ${media}`;
  return `[${type}]`;
}

export function parseInteraktWebhook(payload: unknown): NormalizedInteraktWebhook | null {
  const rec = asRecord(payload);
  if (!rec) return null;
  const type = str(rec.type);
  if (!type) return null;

  const data = asRecord(rec.data) ?? rec;
  const customer = asRecord(data.customer);
  const message = asRecord(data.message) ?? asRecord(rec.message);
  const traits = customer ? asRecord(customer.traits) : null;

  const phone = phoneFromCustomer(customer);
  const providerMessageId = message ? str(message.id) : undefined;
  const providerCustomerId = customer ? str(customer.id) : undefined;
  const providerStatus = message ? str(message.message_status) ?? str(message.messageStatus) : undefined;
  const userIdTrait = traits ? str(traits["User Id"]) ?? str(traits.userId) ?? str(traits.user_id) : undefined;
  const profileName = traits ? str(traits.name) : undefined;
  const campaignId = message ? str(message.campaign_id) ?? str(message.campaignId) : undefined;
  const callbackData = message ? callbackFromMessage(message) : null;
  const failureReason =
    (message ? str(message.channel_failure_reason) ?? str(message.channelFailureReason) : undefined) ?? undefined;
  const channelErrorCode =
    (message ? str(message.channel_error_code) ?? str(message.channelErrorCode) : undefined) ?? undefined;

  const lower = type.toLowerCase();
  if ((INTERAKT_INBOUND_TYPES as readonly string[]).includes(lower)) {
    if (!phone) return null;
    return {
      type,
      kind: "inbound",
      phone,
      body: message ? bodyFromMessage(message) : "",
      providerMessageId,
      providerCustomerId,
      providerStatus,
      receivedAt: message ? str(message.received_at_utc) ?? str(message.receivedAtUtc) : undefined,
      timestamp: str(rec.timestamp),
      profileName,
      userIdTrait,
      callbackData,
      campaignId,
    };
  }

  if ((INTERAKT_STATUS_TYPES as readonly string[]).includes(lower)) {
    return {
      type,
      kind: "status",
      phone,
      body: "",
      providerMessageId,
      providerCustomerId,
      providerStatus,
      internalStatus: mapProviderStatus(providerStatus, type),
      failureReason,
      channelErrorCode,
      callbackData,
      campaignId,
      timestamp: str(rec.timestamp),
      profileName,
      userIdTrait,
    };
  }

  if ((INTERAKT_CLICK_TYPES as readonly string[]).includes(lower)) {
    return {
      type,
      kind: "click",
      phone,
      body: "",
      providerMessageId,
      providerCustomerId,
      callbackData,
      timestamp: str(rec.timestamp),
      profileName,
      userIdTrait,
    };
  }

  return {
    type,
    kind: "ignored",
    phone,
    body: "",
    providerMessageId,
    timestamp: str(rec.timestamp),
  };
}

export function isInteraktWebhookPayload(payload: unknown): boolean {
  const rec = asRecord(payload);
  if (!rec) return false;
  const type = str(rec.type);
  if (!type) return false;
  return type.startsWith("message_") || type.startsWith("account_") || type.startsWith("template_") || type === "messages";
}

export function providerEventId(event: NormalizedInteraktWebhook): string {
  const id = event.providerMessageId ?? event.timestamp ?? "unknown";
  return `${event.type}:${id}`;
}
