import type { MessageChannel, MessageProvider, SendMessageInput, SendResult } from "../types";
import { InteraktClient, messageIdFromResponse } from "./interakt/client";
import { encodeCorrelation, type CorrelationPayload } from "./interakt/correlation";
import { getInteraktDefaultTemplate, getInteraktTemplateLanguage } from "./interakt/config";
import { InteraktError } from "./interakt/errors";
import { splitIndianPhone } from "../phone";

export interface InteraktHealthResult {
  ok: boolean;
  status?: number;
  error?: string;
  live: boolean;
}

function readApiKey(): string | undefined {
  const key = process.env.INTERAKT_API_KEY?.trim();
  return key || undefined;
}

function languageCode(): string {
  return getInteraktTemplateLanguage();
}

export class InteraktProvider implements MessageProvider {
  readonly name = "interakt";
  readonly channel: MessageChannel = "WHATSAPP";

  private readonly clientFactory: () => InteraktClient | null;

  constructor(clientFactory?: () => InteraktClient | null) {
    this.clientFactory = clientFactory ?? (() => {
      const apiKey = readApiKey();
      if (!apiKey) return null;
      return new InteraktClient({
        apiKey,
        baseUrl: process.env.INTERAKT_API_BASE_URL,
      });
    });
  }

  isConfigured(): boolean {
    return Boolean(readApiKey());
  }

  async send(input: SendMessageInput): Promise<SendResult> {
    const client = this.clientFactory();
    if (!client) {
      return {
        status: "NOT_CONFIGURED",
        errorMsg: "Interakt is not configured. Set INTERAKT_API_KEY and WHATSAPP_PROVIDER=interakt.",
      };
    }

    if (!splitIndianPhone(input.to)) {
      return { status: "FAILED", errorMsg: `Invalid +91 phone: ${input.to}` };
    }

    const templateName = input.templateName?.trim() || getInteraktDefaultTemplate();
    if (!templateName) {
      return {
        status: "FAILED",
        errorMsg:
          "Interakt public API only sends approved WhatsApp templates. Set templateName or INTERAKT_DEFAULT_TEMPLATE.",
      };
    }

    const callbackData = this.callbackData(input);
    const bodyValues =
      input.bodyValues !== undefined
        ? input.bodyValues.length > 0
          ? input.bodyValues
          : undefined
        : input.body
          ? [input.body]
          : undefined;

    try {
      const res = await client.sendTemplate({
        phone: input.to,
        templateName,
        languageCode: input.templateLanguage ?? languageCode(),
        bodyValues,
        headerValues: input.headerValues,
        callbackData,
        campaignId: input.providerCampaignId ?? process.env.INTERAKT_API_CAMPAIGN_ID?.trim(),
      });
      const externalId = messageIdFromResponse(res.body);
      if (!externalId) {
        return { status: "FAILED", errorMsg: "Interakt accepted the call but returned no message id." };
      }
      return { status: "SENT", externalId };
    } catch (err) {
      return this.fail(err);
    }
  }

  async trackUser(input: {
    userId: string;
    phone: string;
    traits?: Record<string, unknown>;
    tags?: string[];
  }): Promise<SendResult> {
    const client = this.clientFactory();
    if (!client) return { status: "NOT_CONFIGURED", errorMsg: "Interakt is not configured." };
    try {
      const res = await client.trackUser(input);
      return { status: "SENT", externalId: messageIdFromResponse(res.body) ?? input.userId };
    } catch (err) {
      return this.fail(err);
    }
  }

  async trackEvent(input: {
    userId: string;
    phone: string;
    event: string;
    traits?: Record<string, unknown>;
  }): Promise<SendResult> {
    const client = this.clientFactory();
    if (!client) return { status: "NOT_CONFIGURED", errorMsg: "Interakt is not configured." };
    try {
      const res = await client.trackEvent(input);
      return { status: "SENT", externalId: messageIdFromResponse(res.body) };
    } catch (err) {
      return this.fail(err);
    }
  }

  async assignChat(input: { userPhoneNumber: string; agentEmail: string; wcId?: string }): Promise<SendResult> {
    const client = this.clientFactory();
    if (!client) return { status: "NOT_CONFIGURED", errorMsg: "Interakt is not configured." };
    try {
      await client.assignChat(input);
      return { status: "SENT" };
    } catch (err) {
      return this.fail(err);
    }
  }

  async createApiCampaign(input: {
    campaignName: string;
    templateName: string;
    languageCode?: string;
  }): Promise<SendResult> {
    const client = this.clientFactory();
    if (!client) return { status: "NOT_CONFIGURED", errorMsg: "Interakt is not configured." };
    try {
      const res = await client.createApiCampaign(input);
      return { status: "SENT", externalId: messageIdFromResponse(res.body) };
    } catch (err) {
      return this.fail(err);
    }
  }

  /**
   * Live ping against Get Users. Never reports connected unless this request
   * actually succeeded against api.interakt.ai.
   */
  async testConnection(): Promise<InteraktHealthResult> {
    const client = this.clientFactory();
    if (!client) {
      return { ok: false, live: false, error: "INTERAKT_API_KEY is not set" };
    }
    try {
      const res = await client.getUsers({ limit: 1, offset: 0 });
      return { ok: res.ok, live: res.ok, status: res.status };
    } catch (err) {
      const mapped = err instanceof InteraktError ? err : null;
      return {
        ok: false,
        live: false,
        status: mapped?.status,
        error: mapped?.message ?? (err instanceof Error ? err.message : String(err)),
      };
    }
  }

  private callbackData(input: SendMessageInput): string | undefined {
    if (input.callbackData) return input.callbackData.slice(0, 512);
    const meta = input.metadata ?? {};
    const payload: CorrelationPayload = { v: 1 };
    if (meta.leadId) payload.l = meta.leadId;
    if (meta.conversationId) payload.c = meta.conversationId;
    if (meta.messageId) payload.m = meta.messageId;
    if (meta.workflowRunId) payload.w = meta.workflowRunId;
    if (meta.workflowStepKey) payload.s = meta.workflowStepKey;
    if (meta.campaignId) payload.k = meta.campaignId;
    if (meta.idempotencyKey) payload.i = meta.idempotencyKey;
    if (Object.keys(payload).length === 1) return undefined;
    return encodeCorrelation(payload);
  }

  private fail(err: unknown): SendResult {
    if (err instanceof InteraktError) {
      if (err.code === "NOT_CONFIGURED") {
        return { status: "NOT_CONFIGURED", errorMsg: err.message, code: err.code, retryable: false };
      }
      return {
        status: "FAILED",
        errorMsg: `[${err.code}] ${err.message}`,
        code: err.code,
        retryable: err.retryable,
      };
    }
    return { status: "FAILED", errorMsg: err instanceof Error ? err.message : String(err), retryable: true };
  }
}

export function maskSecret(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}
