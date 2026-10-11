import { type NextRequest } from "next/server";
import { PageService } from "@/lib/services/page.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { created, handleError } from "@/lib/utils/response";
import { createPageBlockSchema } from "@/lib/validations/page.schema";

type Params = { params: Promise<{ id: string; sid: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id, sid } = await params;
    guard(ctx.user, "write", "pages");

    const body = await req.json() as unknown;
    const input = createPageBlockSchema.parse(body);

    const block = await PageService.addBlock(ctx, id, sid, input);
    return created(block);
  } catch (err) {
    return handleError(err);
  }
}
