import { type NextRequest } from "next/server";
import { PageService } from "@/lib/services/page.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateSectionSchema } from "@/lib/validations/page.schema";

type Params = { params: Promise<{ id: string; sid: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id, sid } = await params;
    guard(ctx.user, "write", "pages");

    const body = await req.json() as unknown;
    const input = updateSectionSchema.parse(body);

    const section = await PageService.updateSection(ctx, id, sid, input);
    return ok(section);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id, sid } = await params;
    guard(ctx.user, "write", "pages");

    await PageService.deleteSection(ctx, id, sid);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
