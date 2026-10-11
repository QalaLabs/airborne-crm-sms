import { type NextRequest } from "next/server";
import { PageService } from "@/lib/services/page.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { reorderLayoutSchema } from "@/lib/validations/page.schema";

type Params = { params: Promise<{ id: string }> };

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "pages");

    const body = await req.json() as unknown;
    const input = reorderLayoutSchema.parse(body);

    await PageService.reorderLayout(ctx, id, input);
    return ok({ reordered: true });
  } catch (err) {
    return handleError(err);
  }
}
