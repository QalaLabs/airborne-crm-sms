import { type NextRequest } from "next/server";
import { CampusService } from "@/lib/services/org.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createCampusSchema } from "@/lib/validations/org.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "campuses");

    const url = new URL(req.url);
    const includeInactive = url.searchParams.get("includeInactive") === "true";

    const campuses = await CampusService.list(ctx, includeInactive);
    return ok(campuses);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "campuses");

    const body = await req.json() as unknown;
    const input = createCampusSchema.parse(body);

    const campus = await CampusService.create(ctx, input);
    return created(campus);
  } catch (err) {
    return handleError(err);
  }
}
