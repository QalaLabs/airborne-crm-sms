import { type NextRequest } from "next/server";
import { z } from "zod";
import { UserService } from "@/lib/services/user.service";
import { ok, handleError } from "@/lib/utils/response";
import { enforceRateLimit } from "@/lib/utils/rate-limit";
import { resolveClientIp } from "@/lib/utils/client-ip";
import { sha256 } from "@/lib/utils/crypto";

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(128),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as unknown;
    const { token, password } = acceptInviteSchema.parse(body);

    // Anti-abuse: 30 per IP per 10min + 5 per invite token per 10min
    // (a stolen invite link must not allow unlimited password-guessing).
    const ip = resolveClientIp(req);
    const ipGuard = await enforceRateLimit({
      key: `auth:invite:ip:${ip}`,
      limit: 30,
      windowMs: 10 * 60_000,
    });
    if (!ipGuard.ok) return ipGuard.response;

    const tokenGuard = await enforceRateLimit({
      key: `auth:invite:tok:${sha256(token)}`,
      limit: 5,
      windowMs: 10 * 60_000,
    });
    if (!tokenGuard.ok) return tokenGuard.response;

    const user = await UserService.acceptInvite(token, password);
    return ok(user);
  } catch (err) {
    return handleError(err);
  }
}
