import { type NextRequest } from "next/server";
import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateAssignmentSchema } from "@/lib/validations/lms.schema";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_assignments");
    const { id } = await params;
    return ok(await LmsOpsService.getAssignment(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_assignments");
    const { id } = await params;
    const input = updateAssignmentSchema.parse(await req.json());
    return ok(await LmsOpsService.updateAssignment(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "lms_assignments");
    const { id } = await params;
    await LmsOpsService.deleteAssignment(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
