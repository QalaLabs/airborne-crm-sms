import { type NextRequest } from "next/server";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { IntegrationKeyService } from "@/lib/services/integration-key.service";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "jobs");
    const { id } = await params;
    return ok(await IntegrationKeyService.revoke(ctx, "JOBS_FEED", id));
  } catch (err) {
    return handleError(err);
  }
}
