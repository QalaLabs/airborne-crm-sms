import { type NextRequest } from "next/server";
import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateTimetableSlotSchema } from "@/lib/validations/lms.schema";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const { id } = await params;
    const input = updateTimetableSlotSchema.parse(await req.json());
    return ok(await LmsOpsService.updateTimetableSlot(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "lms_courses");
    const { id } = await params;
    await LmsOpsService.deleteTimetableSlot(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
