import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";

type Params = { params: Promise<{ id: string }> };

/** GET /api/v1/lms/certificates/[id] - one certificate (org-scoped; students own only). */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "lms_certificates");
    return ok(await LmsService.getCertificate(ctx, id));
  } catch (err) {
    return handleError(err);
  }
}

/** DELETE /api/v1/lms/certificates/[id] - hard-deletes a certificate (org-scoped). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "lms_certificates");
    await LmsService.deleteCertificate(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
