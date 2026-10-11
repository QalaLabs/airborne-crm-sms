import { type NextRequest } from "next/server";
import { MediaService } from "@/lib/services/media.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { presignMediaSchema } from "@/lib/validations/media.schema";

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "media");

    const body = await req.json() as unknown;
    const input = presignMediaSchema.parse(body);

    const result = await MediaService.getPresignedUrl(ctx, input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
