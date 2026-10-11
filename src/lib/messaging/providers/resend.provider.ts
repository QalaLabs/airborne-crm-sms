import { DEFAULT_FROM_EMAIL } from "../constants";
import type { MessageChannel, MessageProvider, SendResult, SendMessageInput } from "../types";

// ─── Resend email transport ──────────────────────────────────────────────────
// Extracted verbatim from NotificationService.dispatchToProvider so behavior
// (10s timeout, id validation, error shapes) is unchanged.

export class ResendProvider implements MessageProvider {
  readonly name = "resend";
  readonly channel: MessageChannel = "EMAIL";

  isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_API_KEY.trim().length > 0);
  }

  async send(input: SendMessageInput): Promise<SendResult> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey || apiKey.trim().length === 0) {
      return {
        status: "NOT_CONFIGURED",
        errorMsg: "Email provider (Resend) is not configured. Set RESEND_API_KEY.",
      };
    }

    const from = process.env.RESEND_FROM_EMAIL ?? DEFAULT_FROM_EMAIL;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: input.to,
          subject: input.subject ?? "",
          text: input.body,
          ...(input.html ? { html: input.html } : {}),
        }),
        signal: controller.signal,
      });

      const payload = (await res.json().catch(() => null)) as { id?: string; message?: string } | null;

      if (!res.ok) {
        const detail = payload?.message ?? `HTTP ${res.status}`;
        return { status: "FAILED", errorMsg: `Resend rejected send (${res.status}): ${detail}` };
      }

      if (!payload?.id) {
        return { status: "FAILED", errorMsg: "Resend returned 200 without a message id." };
      }

      return { status: "SENT", externalId: payload.id };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { status: "FAILED", errorMsg: `Resend request failed: ${detail}` };
    } finally {
      clearTimeout(timer);
    }
  }
}
