import { type NextRequest } from "next/server";
import { UserService } from "@/lib/services/user.service";
import { ok, handleError } from "@/lib/utils/response";
import { resetPasswordSchema } from "@/lib/validations/user.schema";
import { enforceRateLimit } from "@/lib/utils/rate-limit";
import { resolveClientIp } from "@/lib/utils/client-ip";
import { sha256 } from "@/lib/utils/crypto";

// Public — consumes the one-time reset token issued by forgot-password.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    const input = resetPasswordSchema.parse(body);

    // Anti-abuse: 20 per IP per 10min + 5 attempts per reset token per 15min.
    // Token hashed — never stored or logged in plaintext.
    const ip = resolveClientIp(req);
    const ipGuard = await enforceRateLimit({
      key: `auth:reset:ip:${ip}`,
      limit: 20,
      windowMs: 10 * 60_000,
    });
    if (!ipGuard.ok) return ipGuard.response;

    const tokenGuard = await enforceRateLimit({
      key: `auth:reset:tok:${sha256(input.token)}`,
      limit: 5,
      windowMs: 15 * 60_000,
    });
    if (!tokenGuard.ok) return tokenGuard.response;

    const result = await UserService.resetPassword(input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}