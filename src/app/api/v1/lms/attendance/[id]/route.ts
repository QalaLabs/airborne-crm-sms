import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { z } from "zod";

const updateAttendanceSchema = z.object({
  title: z.string().optional(),
  subjectTag: z.string().optional().nullable(),
  heldAt: z.string().optional(),
  records: z
    .array(
      z.object({
        studentId: z.string().uuid(),
        status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
        notes: z.string().optional().nullable(),
      }),
    )
    .optional(),
});

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_attendance");
    const { id } = await params;
    const body = await req.json();
    const input = updateAttendanceSchema.parse(body);

    const updated = await LmsService.updateAttendanceSession(ctx, id, input);
    return ok(updated);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "lms_attendance");
    const { id } = await params;

    await LmsService.deleteAttendanceSession(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
