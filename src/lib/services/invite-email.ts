import { getProvider } from "@/lib/messaging";
import type { SendStatus } from "@/lib/messaging/types";

export function inviteLink(rawToken: string, fallbackOrigin?: string): string {
  const base = (process.env.AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || fallbackOrigin || "").replace(/\/+$/, "");
  return `${base}/invite/${rawToken}`;
}

export async function sendInviteEmail(input: {
  to: string;
  name: string;
  role: string;
  orgName?: string | null;
  link: string;
}): Promise<{ status: SendStatus; errorMsg?: string }> {
  const role = input.role.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const org = input.orgName || "Airborne Aviation";
  const body = [
    `Hi ${input.name},`,
    "",
    `You have been invited to the ${org} admin portal as ${role}.`,
    "",
    "Set your password and activate your account here:",
    input.link,
    "",
    "This link expires in 7 days and can be used only once.",
    "If you were not expecting this invitation, you can ignore this email.",
  ].join("\n");

  try {
    const result = await getProvider("EMAIL").send({
      to: input.to,
      subject: `You're invited to the ${org} admin portal`,
      body,
    });
    return { status: result.status, errorMsg: result.errorMsg };
  } catch (err) {
    return { status: "FAILED", errorMsg: err instanceof Error ? err.message : String(err) };
  }
}
