import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { markProgressSchema } from "@/lib/validations/lms.schema";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_progress");
    const student = await LmsService.resolveLinkedStudent(ctx);
    const body = (await req.json()) as unknown;
    const input = markProgressSchema.parse(body);
    const progress = await LmsService.markProgress(ctx, student.id, input);
    return ok(progress);
  } catch (err) {
    return handleError(err);
  }
}
