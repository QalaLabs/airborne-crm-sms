import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { issueCertificateSchema } from "@/lib/validations/lms.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms_certificates");
    const studentId = new URL(req.url).searchParams.get("studentId") ?? undefined;
    const data = await LmsService.listCertificates(ctx, studentId);
    return ok(data);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_certificates");
    const body = (await req.json()) as unknown;
    const input = issueCertificateSchema.parse(body);
    const cert = await LmsService.issueCertificate(ctx, input);
    return created(cert);
  } catch (err) {
    return handleError(err);
  }
}
