import { type NextRequest } from "next/server";
import { PageService } from "@/lib/services/page.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { createPageSchema, pageFiltersSchema } from "@/lib/validations/page.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "pages");

    const url = new URL(req.url);
    const filters = pageFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const { data, total } = await PageService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "pages");

    const body = await req.json() as unknown;
    const input = createPageSchema.parse(body);

    const page = await PageService.create(ctx, input);
    return created(page);
  } catch (err) {
    return handleError(err);
  }
}
