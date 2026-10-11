import { type NextRequest } from "next/server";
import { ResourceService } from "@/lib/services/resource.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "resources");
    return ok(await ResourceService.incrementDownload(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}
