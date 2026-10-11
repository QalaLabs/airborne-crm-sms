import { type NextRequest } from "next/server";
import { PageService } from "@/lib/services/page.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

type Params = { params: Promise<{ id: string; vid: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id, vid } = await params;
    guard(ctx.user, "write", "pages");

    const page = await PageService.rollback(ctx, id, vid);
    return ok(page);
  } catch (err) {
    return handleError(err);
  }
}
