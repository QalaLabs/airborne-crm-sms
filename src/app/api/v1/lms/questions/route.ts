import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createQuestionSchema } from "@/lib/validations/lms.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_courses");
    const url = new URL(req.url);
    const moduleId = url.searchParams.get("moduleId");
    if (!moduleId) return handleError(new Error("moduleId required"));
    const questions = await LmsService.listQuestions(ctx, moduleId);
    return ok(questions);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const body = (await req.json()) as unknown;
    const input = createQuestionSchema.parse(body);
    const question = await LmsService.createQuestion(ctx, input);
    return created(question);
  } catch (err) {
    return handleError(err);
  }
}
