import { type NextRequest } from "next/server";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import {
  IntegrationKeyService,
  createIntegrationKeySchema,
} from "@/lib/services/integration-key.service";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");
    return ok(await IntegrationKeyService.list(ctx, "GOOGLE_ADS"));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "leads");
    const input = createIntegrationKeySchema.parse((await req.json()) as unknown);
    return created(await IntegrationKeyService.create(ctx, "GOOGLE_ADS", input));
  } catch (err) {
    return handleError(err);
  }
}
