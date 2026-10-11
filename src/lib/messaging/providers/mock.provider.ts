import { randomUUID } from "node:crypto";
import type { MessageChannel, MessageProvider, SendMessageInput, SendResult } from "../types";
import type { InteraktHealthResult } from "./interakt.provider";

// Local transport. Reports SENT with a mock- prefixed id. Never calls Interakt.

export class MockWhatsAppProvider implements MessageProvider {
  readonly name = "mock";
  readonly channel: MessageChannel = "WHATSAPP";

  isConfigured(): boolean {
    return true;
  }

  async send(_input: SendMessageInput): Promise<SendResult> {
    return { status: "SENT", externalId: `mock-${randomUUID()}` };
  }

  async testConnection(): Promise<InteraktHealthResult> {
    return { ok: true, live: false, error: "mock provider — no live Interakt request" };
  }
}
