import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { bulkQuestionsSchema } from "@/lib/validations/lms.schema";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const input = bulkQuestionsSchema.parse(await req.json());
    return ok(await LmsService.bulkCreateQuestions(ctx, input.moduleId, input.questions));
  } catch (err) {
    return handleError(err);
  }
}
