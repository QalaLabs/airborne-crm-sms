import { type NextRequest } from "next/server";
import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createTimetableSlotSchema } from "@/lib/validations/lms.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_attendance");
    const url = new URL(req.url);
    const slots = await LmsOpsService.listTimetable(ctx, {
      batchId: url.searchParams.get("batchId") ?? undefined,
      teacherId: url.searchParams.get("teacherId") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
    });
    return ok(slots);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const input = createTimetableSlotSchema.parse(await req.json());
    return created(await LmsOpsService.createTimetableSlot(ctx, input));
  } catch (err) {
    return handleError(err);
  }
}
