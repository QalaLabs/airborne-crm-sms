import { type NextRequest } from "next/server";
import { AdmissionService } from "@/lib/services/admission.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { admissionFiltersSchema, createAdmissionSchema } from "@/lib/validations/admission.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "admissions");

    const url = new URL(req.url);
    const filters = admissionFiltersSchema.parse(Object.fromEntries(url.searchParams));

    // Counselors see only their assigned admissions
    if (ctx.user.role === "ADMISSIONS_COUNSELOR") {
      filters.counselorId = ctx.user.id;
    }

    const { data, total } = await AdmissionService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "admissions");

    const body = await req.json() as unknown;
    const input = createAdmissionSchema.parse(body);

    const admission = await AdmissionService.create(ctx, input);
    return created(admission);
  } catch (err) {
    return handleError(err);
  }
}
