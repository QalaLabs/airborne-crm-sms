import { type NextRequest } from "next/server";
import { PageService } from "@/lib/services/page.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { created, handleError } from "@/lib/utils/response";
import { createSectionSchema } from "@/lib/validations/page.schema";

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "pages");

    const body = await req.json() as unknown;
    const input = createSectionSchema.parse(body);

    const section = await PageService.addSection(ctx, id, input);
    return created(section);
  } catch (err) {
    return handleError(err);
  }
}
