import { type NextRequest } from "next/server";
import { OrgService } from "@/lib/services/org.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { updateOrgSchema } from "@/lib/validations/org.schema";

// GET /api/v1/organizations — return current org for tenant scope, or list all for SUPER_ADMIN
export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "organizations");

    if (ctx.user.role === "SUPER_ADMIN") {
      const orgs = await OrgService.listAll();
      return ok(orgs);
    }

    const org = await OrgService.getById(ctx);
    return ok(org);
  } catch (err) {
    return handleError(err);
  }
}

// PATCH /api/v1/organizations — update current org settings
export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "admin", "organizations");

    const body = await req.json() as unknown;
    const input = updateOrgSchema.parse(body);

    const org = await OrgService.update(ctx, input);
    return ok(org);
  } catch (err) {
    return handleError(err);
  }
}
