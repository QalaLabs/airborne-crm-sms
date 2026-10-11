import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { ok, handleError } from "@/lib/utils/response";
import { consumeRateLimit } from "@/lib/utils/rate-limit";
import { resolveClientIp } from "@/lib/utils/client-ip";
import { RateLimitError } from "@/lib/utils/errors";

/** Public endpoint — no auth required. Verifies a certificate by verificationCode. */
export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    if (!code) {
      return ok({ valid: false, message: "No verification code provided" });
    }

    // Prevent code brute-forcing / enumeration: 20 attempts per IP per minute.
    const ip = resolveClientIp(req);
    const { allowed } = await consumeRateLimit(`lms-cert-verify:${ip}`, 20, 60_000);
    if (!allowed) throw new RateLimitError();

    const cert = await LmsService.verifyCertificate(code);

    if (!cert) {
      return ok({ valid: false, message: "Certificate not found or not yet issued" });
    }

    return ok({
      valid: true,
      certificateNo: cert.certificateNo,
      studentName: `${cert.student.firstName} ${cert.student.lastName}`,
      courseTitle: cert.course.title,
      orgName: cert.org.name,
      issuedAt: cert.issuedAt,
    });
  } catch (err) {
    return handleError(err);
  }
}
