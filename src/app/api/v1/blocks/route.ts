import { type NextRequest } from "next/server";
import { BlockService } from "@/lib/services/block.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { createBlockSchema, blockFiltersSchema } from "@/lib/validations/block.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "blocks");

    const url = new URL(req.url);
    const filters = blockFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const { data, total } = await BlockService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "blocks");

    const body = await req.json() as unknown;
    const input = createBlockSchema.parse(body);

    const block = await BlockService.create(ctx, input);
    return created(block);
  } catch (err) {
    return handleError(err);
  }
}
