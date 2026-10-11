import { type NextRequest } from "next/server";
import { z } from "zod";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { created, handleError } from "@/lib/utils/response";

const schema = z.object({
  studentId: z.string().uuid(),
  password: z.string().min(8).max(128),
});

/** Staff: provision STUDENT login linked to CRM Student. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "students");
    const body = (await req.json()) as unknown;
    const input = schema.parse(body);
    const result = await LmsService.provisionPortalAccess(ctx, input);
    return created(result);
  } catch (err) {
    return handleError(err);
  }
}
