import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateQuestionSchema } from "@/lib/validations/lms.schema";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ questionId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const { questionId } = await params;
    const body = (await req.json()) as unknown;
    const input = updateQuestionSchema.parse(body);
    const question = await LmsService.updateQuestion(ctx, questionId, input);
    return ok(question);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ questionId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "lms_courses");
    const { questionId } = await params;
    await LmsService.deleteQuestion(ctx, questionId);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
