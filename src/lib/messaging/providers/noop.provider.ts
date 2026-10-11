import type { MessageChannel, MessageProvider, SendResult, SendMessageInput } from "../types";

// ─── No-op transport ─────────────────────────────────────────────────────────
//
// Used for any channel without a configured provider (SMS today; WhatsApp
// until the mock/Interakt providers land). Truthfully reports NOT_CONFIGURED —
// delivery is never faked.

export class NoopProvider implements MessageProvider {
  readonly name = "noop";
  readonly channel: MessageChannel;

  private readonly reason: string;

  constructor(channel: MessageChannel, reason?: string) {
    this.channel = channel;
    this.reason = reason ?? `${channel} channel has no configured provider.`;
  }

  isConfigured(): boolean {
    return false;
  }

  async send(_input: SendMessageInput): Promise<SendResult> {
    return { status: "NOT_CONFIGURED", errorMsg: this.reason };
  }
}
