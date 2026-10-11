import { type NextRequest } from "next/server";
import { JobService } from "@/lib/services/job.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { publishJobSchema } from "@/lib/validations/job.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "publish", "jobs");
    const body = await req.json() as unknown;
    const input = publishJobSchema.parse(body);
    return ok(await JobService.publish(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}
