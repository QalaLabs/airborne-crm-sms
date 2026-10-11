import type { MessageChannel, MessageProvider } from "./types";
import { ResendProvider } from "./providers/resend.provider";
import { SmtpProvider } from "./providers/smtp.provider";
import { NoopProvider } from "./providers/noop.provider";
import { MockWhatsAppProvider } from "./providers/mock.provider";
import { InteraktProvider } from "./providers/interakt.provider";

// ─── Provider registry ───────────────────────────────────────────────────────
//
// Channel → transport selection is env-driven so future providers plug in
// without touching call sites:
//   EMAIL_PROVIDER=resend|smtp   (default: resend; use smtp for Gmail/Workspace)
//   SMS_PROVIDER=                (unset → noop)
//   WHATSAPP_PROVIDER=mock|interakt

const REGISTRY: Record<string, (channel: MessageChannel) => MessageProvider> = {
  resend: () => new ResendProvider(),
  smtp: () => new SmtpProvider(),
  mock: (channel) => (channel === "WHATSAPP" ? new MockWhatsAppProvider() : new NoopProvider(channel)),
  interakt: (channel) => (channel === "WHATSAPP" ? new InteraktProvider() : new NoopProvider(channel)),
};

export function getProvider(channel: MessageChannel): MessageProvider {
  const key =
    channel === "EMAIL"
      ? (process.env.EMAIL_PROVIDER ?? "resend").trim().toLowerCase()
      : channel === "SMS"
        ? (process.env.SMS_PROVIDER ?? "").trim().toLowerCase()
        : (process.env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase();

  const factory = REGISTRY[key];
  if (factory) return factory(channel);

  return new NoopProvider(
    channel,
    key
      ? `${channel} provider "${key}" is not registered.`
      : `${channel} channel has no configured provider.`,
  );
}
