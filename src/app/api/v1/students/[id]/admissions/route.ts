import { type NextRequest } from "next/server";
import { StudentService } from "@/lib/services/student.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "students");

    const admissions = await StudentService.getAdmissions(ctx, id);
    return ok(admissions);
  } catch (err) {
    return handleError(err);
  }
}
