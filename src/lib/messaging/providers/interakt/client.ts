import { getInteraktRateLimiter } from "./rate-limiter";
import { errorFromHttpStatus, InteraktError } from "./errors";
import {
  buildAssignChatPayload,
  buildCreateCampaignPayload,
  buildGetUsersPayload,
  buildSendTemplatePayload,
  buildTrackEventPayload,
  buildTrackUserPayload,
  type SendTemplateInput,
  type TrackEventInput,
  type TrackUserInput,
} from "./payloads";

const DEFAULT_BASE_URL = "https://api.interakt.ai";
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;

export interface InteraktClientConfig {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export interface InteraktHttpResponse {
  ok: boolean;
  status: number;
  body: unknown;
  retryAfterMs?: number;
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header?.trim()) return undefined;
  const trimmed = header.trim();
  const asNum = Number.parseInt(trimmed, 10);
  if (Number.isFinite(asNum) && asNum >= 0) return asNum * 1000;
  const asDate = Date.parse(trimmed);
  if (Number.isFinite(asDate)) return Math.max(0, asDate - Date.now());
  return undefined;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function authorizationHeader(apiKey: string): string {
  const trimmed = apiKey.trim();
  if (/^basic\s+/i.test(trimmed)) return trimmed;
  return `Basic ${trimmed}`;
}

function extractMessage(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const rec = body as Record<string, unknown>;
  if (typeof rec.message === "string") return rec.message;
  if (typeof rec.error === "string") return rec.error;
  return undefined;
}

function extractId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const rec = body as Record<string, unknown>;
  if (typeof rec.id === "string" && rec.id) return rec.id;
  const data = rec.data && typeof rec.data === "object" ? (rec.data as Record<string, unknown>) : null;
  if (data && typeof data.campaign_id === "string") return data.campaign_id;
  if (data && typeof data.id === "string") return data.id;
  return undefined;
}

export class InteraktClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: InteraktClientConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? sleepMs;
  }

  async trackUser(input: TrackUserInput): Promise<InteraktHttpResponse> {
    await getInteraktRateLimiter().acquire();
    return this.request("POST", "/v1/public/track/users/", buildTrackUserPayload(input), { retries: MAX_RETRIES });
  }

  async trackEvent(input: TrackEventInput): Promise<InteraktHttpResponse> {
    await getInteraktRateLimiter().acquire();
    return this.request("POST", "/v1/public/track/events/", buildTrackEventPayload(input), { retries: MAX_RETRIES });
  }

  async sendTemplate(input: SendTemplateInput): Promise<InteraktHttpResponse> {
    await getInteraktRateLimiter().acquire();
    return this.request("POST", "/v1/public/message/", buildSendTemplatePayload(input), { retries: MAX_RETRIES });
  }

  async getUsers(input?: { createdAfterUtc?: string; limit?: number; offset?: number }): Promise<InteraktHttpResponse> {
    const limit = Math.min(Math.max(input?.limit ?? 1, 1), 100);
    const offset = input?.offset ?? 0;
    return this.request(
      "POST",
      `/v1/public/apis/users/?offset=${offset}&limit=${limit}`,
      buildGetUsersPayload(input),
      { retries: MAX_RETRIES },
    );
  }

  async createApiCampaign(input: {
    campaignName: string;
    templateName: string;
    languageCode?: string;
  }): Promise<InteraktHttpResponse> {
    return this.request("POST", "/v1/public/create-campaign/", buildCreateCampaignPayload(input), {
      retries: MAX_RETRIES,
    });
  }

  async assignChat(input: {
    userPhoneNumber: string;
    agentEmail: string;
    wcId?: string;
  }): Promise<InteraktHttpResponse> {
    return this.request("POST", "/v1/public/assignment/", buildAssignChatPayload(input), { retries: 1 });
  }

  async request(
    method: string,
    path: string,
    body: unknown,
    opts: { retries: number },
  ): Promise<InteraktHttpResponse> {
    let lastError: InteraktError | undefined;
    const attempts = Math.max(1, opts.retries);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const result = await this.once(method, path, body);
        if (result.ok) return result;

        const err = errorFromHttpStatus(result.status, extractMessage(result.body));
        if (!err.retryable || attempt === attempts) throw err;
        lastError = err;
        const backoff = result.retryAfterMs ?? 250 * 2 ** (attempt - 1);
        await this.sleep(backoff);
        continue;
      } catch (err) {
        if (err instanceof InteraktError) {
          if (!err.retryable || attempt === attempts) throw err;
          lastError = err;
        } else {
          const detail = err instanceof Error ? err.message : String(err);
          const mapped =
            detail.toLowerCase().includes("abort") || detail.toLowerCase().includes("timeout")
              ? new InteraktError("TIMEOUT", `Interakt request timed out after ${this.timeoutMs}ms`, {
                  retryable: true,
                })
              : new InteraktError("NETWORK", `Interakt network error: ${detail}`, { retryable: true });
          if (attempt === attempts) throw mapped;
          lastError = mapped;
        }
        await this.sleep(250 * 2 ** (attempt - 1));
      }
    }

    throw lastError ?? new InteraktError("UNEXPECTED", "Interakt request failed");
  }

  private async once(method: string, path: string, body: unknown): Promise<InteraktHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: authorizationHeader(this.apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const parsed = (await res.json().catch(() => null)) as unknown;
      return {
        ok: res.ok,
        status: res.status,
        body: parsed,
        retryAfterMs: parseRetryAfterMs(res.headers.get("retry-after")),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

export function messageIdFromResponse(body: unknown): string | undefined {
  return extractId(body);
}
