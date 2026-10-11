import { type NextRequest } from "next/server";
import { getRequestContext } from "@/lib/middleware/context";
import { UserService } from "@/lib/services/user.service";
import { ok, handleError } from "@/lib/utils/response";
import { changePasswordSchema } from "@/lib/validations/user.schema";
import { enforceRateLimit } from "@/lib/utils/rate-limit";

// Authenticated self-service password change — acts on the session user only.
export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();

    // Slow down offline password-guessing on a hijacked session:
    // 5 password changes per user per 10 minutes.
    const guard = await enforceRateLimit({
      key: `auth:chpass:user:${ctx.user.id}`,
      limit: 5,
      windowMs: 10 * 60_000,
    });
    if (!guard.ok) return guard.response;

    const body = (await req.json()) as unknown;
    const input = changePasswordSchema.parse(body);

    const result = await UserService.changePassword(
      ctx,
      ctx.user.id,
      input.currentPassword,
      input.newPassword,
    );
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
