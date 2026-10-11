import { type NextRequest } from "next/server";
import { AdmissionService } from "@/lib/services/admission.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { changeStageSchema } from "@/lib/validations/admission.schema";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "admissions");

    const body = await req.json() as unknown;
    const input = changeStageSchema.parse(body);

    const admission = await AdmissionService.changeStage(ctx, id, input);
    return ok(admission);
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "admissions");

    const logs = await AdmissionService.getStageLogs(ctx, id);
    return ok(logs);
  } catch (err) {
    return handleError(err);
  }
}
