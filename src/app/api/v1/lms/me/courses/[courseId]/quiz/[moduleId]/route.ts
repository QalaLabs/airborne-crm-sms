import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { submitQuizSchema } from "@/lib/validations/lms.schema";

/** GET questions for a module (student view, no correct answers exposed) */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; moduleId: string }> },
) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");
    const { moduleId } = await params;
    const student = await LmsService.resolveLinkedStudent(ctx);
    const data = await LmsService.getModuleQuestions(ctx, student.id, moduleId);
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}

/** POST submit quiz answers */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ courseId: string; moduleId: string }> },
) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_student");
    const { moduleId } = await params;
    const student = await LmsService.resolveLinkedStudent(ctx);
    const body = (await req.json()) as unknown;
    const input = submitQuizSchema.parse({ ...((body as Record<string, unknown>) ?? {}), moduleId });
    const result = await LmsService.submitQuiz(ctx, student.id, input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
