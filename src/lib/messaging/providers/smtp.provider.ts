import nodemailer from "nodemailer";
import { DEFAULT_FROM_EMAIL } from "../constants";
import type { MessageChannel, MessageProvider, SendResult, SendMessageInput } from "../types";

function smtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  const port = Number(process.env.SMTP_PORT ?? "587");
  const user = process.env.SMTP_USER?.trim();
  // Gmail app passwords are often pasted with spaces — strip them.
  const pass = (process.env.SMTP_PASS ?? "").replace(/\s+/g, "");
  const from = process.env.SMTP_FROM?.trim() || process.env.RESEND_FROM_EMAIL?.trim() || DEFAULT_FROM_EMAIL;
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;

  return { host, port, user, pass, from, secure };
}

/**
 * SMTP email transport (Gmail / Google Workspace via smtp.gmail.com:587 + STARTTLS).
 * Selected when EMAIL_PROVIDER=smtp.
 */
export class SmtpProvider implements MessageProvider {
  readonly name = "smtp";
  readonly channel: MessageChannel = "EMAIL";

  isConfigured(): boolean {
    const { host, user, pass } = smtpConfig();
    return Boolean(host && user && pass);
  }

  async send(input: SendMessageInput): Promise<SendResult> {
    const { host, port, user, pass, from, secure } = smtpConfig();
    if (!host || !user || !pass) {
      return {
        status: "NOT_CONFIGURED",
        errorMsg: "Email provider (SMTP) is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS.",
      };
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      requireTLS: !secure && port === 587,
      auth: { user, pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });

    try {
      const info = await transporter.sendMail({
        from,
        to: input.to,
        subject: input.subject ?? "",
        text: input.body,
        ...(input.html ? { html: input.html } : {}),
      });

      if (!info.messageId) {
        return { status: "FAILED", errorMsg: "SMTP accepted send without a message id." };
      }

      return { status: "SENT", externalId: info.messageId };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      return { status: "FAILED", errorMsg: `SMTP send failed: ${detail}`, retryable: true };
    } finally {
      transporter.close();
    }
  }
}
