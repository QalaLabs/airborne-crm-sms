import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateLmsModuleSchema } from "@/lib/validations/lms.schema";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ moduleId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const { moduleId } = await params;
    const body = (await req.json()) as unknown;
    const input = updateLmsModuleSchema.parse(body);
    const mod = await LmsService.updateModule(ctx, moduleId, input);
    return ok(mod);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ moduleId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "lms_courses");
    const { moduleId } = await params;
    await LmsService.deleteModule(ctx, moduleId);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
