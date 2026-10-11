import { type NextRequest } from "next/server";
import { LmsOpsService } from "@/lib/services/lms-ops.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { gradeSubmissionSchema } from "@/lib/validations/lms.schema";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_assignments");
    const { id } = await params;
    const input = gradeSubmissionSchema.parse(await req.json());
    return ok(await LmsOpsService.gradeSubmission(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}
