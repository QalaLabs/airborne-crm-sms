import { type NextRequest } from "next/server";
import { ResourceService } from "@/lib/services/resource.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { publishResourceSchema } from "@/lib/validations/resource.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "publish", "resources");
    const body = await req.json() as unknown;
    const input = publishResourceSchema.parse(body);
    return ok(await ResourceService.publish(ctx, id, input));
  } catch (err) {
    return handleError(err);
  }
}
