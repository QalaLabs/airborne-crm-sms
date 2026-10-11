import { type NextRequest } from "next/server";
import { PageService } from "@/lib/services/page.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updatePageSchema } from "@/lib/validations/page.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "pages");

    const page = await PageService.getById(ctx, id);
    return ok(page);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "pages");

    const body = await req.json() as unknown;
    const input = updatePageSchema.parse(body);

    const page = await PageService.update(ctx, id, input);
    return ok(page);
  } catch (err) {
    return handleError(err);
  }
}
