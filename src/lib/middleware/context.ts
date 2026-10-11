import { headers } from "next/headers";
import { getSession } from "@/lib/auth/session";
import type { RequestContext } from "@/types";

// Build a full RequestContext from headers + session in any Route Handler
export async function getRequestContext(): Promise<RequestContext> {
  const h = await headers();
  const user = await getSession();

  return {
    user,
    orgId: h.get("x-org-id") ?? user.orgId,
    requestId: h.get("x-request-id") ?? crypto.randomUUID(),
    ipAddress: h.get("x-forwarded-for-real") ?? "unknown",
    userAgent: h.get("user-agent") ?? "unknown",
  };
}
