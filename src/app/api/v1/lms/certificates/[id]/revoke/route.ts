import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

type Params = { params: Promise<{ id: string }> };

/** POST /api/v1/lms/certificates/[id]/revoke - transitions an ISSUED certificate to REVOKED. */
export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "lms_certificates");
    const cert = await LmsService.revokeCertificate(ctx, id);
    return ok(cert);
  } catch (err) {
    return handleError(err);
  }
}
