import { type NextRequest } from "next/server";
import { NavService } from "@/lib/services/nav.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createNavMenuSchema } from "@/lib/validations/nav.schema";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "nav");

    const menus = await NavService.list(ctx);
    return ok(menus);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "nav");

    const body = await req.json() as unknown;
    const input = createNavMenuSchema.parse(body);

    const menu = await NavService.create(ctx, input);
    return created(menu);
  } catch (err) {
    return handleError(err);
  }
}
