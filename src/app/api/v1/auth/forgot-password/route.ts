import { type NextRequest } from "next/server";
import { UserService } from "@/lib/services/user.service";
import { ok, handleError } from "@/lib/utils/response";
import { forgotPasswordSchema } from "@/lib/validations/user.schema";
import { enforceRateLimit } from "@/lib/utils/rate-limit";
import { resolveClientIp } from "@/lib/utils/client-ip";
import { sha256 } from "@/lib/utils/crypto";

// Public — no session required. Always returns a generic response so callers
// cannot enumerate which accounts exist.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as unknown;
    const input = forgotPasswordSchema.parse(body);

    // Anti-abuse: 8 per IP per 10min + 5 per account (email hash) per 10min.
    // Email hashed so plaintext addresses never reach the rate-limit store.
    const ip = resolveClientIp(req);
    const ipGuard = await enforceRateLimit({
      key: `auth:forgot:ip:${ip}`,
      limit: 8,
      windowMs: 10 * 60_000,
    });
    if (!ipGuard.ok) return ipGuard.response;

    const acctGuard = await enforceRateLimit({
      key: `auth:forgot:acct:${sha256(input.email.trim().toLowerCase())}`,
      limit: 5,
      windowMs: 10 * 60_000,
    });
    if (!acctGuard.ok) return acctGuard.response;

    const result = await UserService.requestPasswordReset(input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}