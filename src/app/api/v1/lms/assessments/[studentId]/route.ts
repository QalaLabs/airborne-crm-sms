import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { submitAssessmentSchema } from "@/lib/validations/lms.schema";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_assessments");
    const { studentId } = await params;
    const body = (await req.json()) as unknown;
    const input = submitAssessmentSchema.parse(body);
    const assessment = await LmsService.submitAssessment(ctx, studentId, input);
    return ok(assessment);
  } catch (err) {
    return handleError(err);
  }
}
