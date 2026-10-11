import { type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { runProviderSync } from "@/lib/services/job-ingestion.service";
import { consumeRateLimit } from "@/lib/utils/rate-limit";
import { RateLimitError } from "@/lib/utils/errors";

// Provider is chosen by id from the server-side registry; URLs are rejected.
const syncSchema = z.object({ providerId: z.string().regex(/^[a-z0-9_-]{1,50}$/) }).strict();

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "jobs");
    const { providerId } = syncSchema.parse((await req.json()) as unknown);

    const decision = await consumeRateLimit(`jobs-sync:${ctx.orgId}`, 6, 60_000);
    if (!decision.allowed) throw new RateLimitError();

    const report = await runProviderSync(
      { orgId: ctx.orgId, userId: ctx.user.id, userName: ctx.user.name, requestId: ctx.requestId, ipAddress: ctx.ipAddress, via: "pull" },
      providerId,
    );
    return ok(report);
  } catch (err) {
    return handleError(err);
  }
}
