import { type NextRequest } from "next/server";
import { HiringPartnerService } from "@/lib/services/placement.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createHiringPartnerSchema, hiringPartnerFiltersSchema } from "@/lib/validations/placement.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "hiring_partners");
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const filters = hiringPartnerFiltersSchema.parse(params);
    return ok(await HiringPartnerService.list(ctx, filters));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "hiring_partners");
    const body = await req.json() as unknown;
    const input = createHiringPartnerSchema.parse(body);
    return created(await HiringPartnerService.create(ctx, input));
  } catch (err) {
    return handleError(err);
  }
}
