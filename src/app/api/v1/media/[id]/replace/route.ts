import { type NextRequest } from "next/server";
import { MediaService } from "@/lib/services/media.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { replaceAssetSchema } from "@/lib/validations/media.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "media");

    const body = await req.json() as unknown;
    const input = replaceAssetSchema.parse(body);

    const asset = await MediaService.replace(ctx, id, input);
    return ok(asset);
  } catch (err) {
    return handleError(err);
  }
}
