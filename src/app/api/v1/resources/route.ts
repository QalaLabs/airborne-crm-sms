import { type NextRequest } from "next/server";
import { ResourceService } from "@/lib/services/resource.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createResourceSchema, resourceFiltersSchema } from "@/lib/validations/resource.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "resources");
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const filters = resourceFiltersSchema.parse(params);
    const result = await ResourceService.list(ctx, filters);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "resources");
    const body = await req.json() as unknown;
    const input = createResourceSchema.parse(body);
    const resource = await ResourceService.create(ctx, input);
    return created(resource);
  } catch (err) {
    return handleError(err);
  }
}
