import { type NextRequest } from "next/server";
import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { z } from "zod";

const bodySchema = z.object({
  fileUrl: z.string().optional().nullable(),
  body: z.string().optional().nullable(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_student");
    const { id } = await params;
    const student = await LmsService.resolveLinkedStudent(ctx);
    const input = bodySchema.parse(await req.json());
    return ok(
      await LmsOpsService.submitAssignment(ctx, student.id, {
        assignmentId: id,
        fileUrl: input.fileUrl,
        body: input.body,
      }),
    );
  } catch (err) {
    return handleError(err);
  }
}
