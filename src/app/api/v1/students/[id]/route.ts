import { type NextRequest } from "next/server";
import { StudentService } from "@/lib/services/student.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateStudentSchema } from "@/lib/validations/student.schema";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "students");

    const student = await StudentService.getById(ctx, id);
    return ok(student);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "students");

    const body = await req.json() as unknown;
    const input = updateStudentSchema.parse(body);

    const student = await StudentService.update(ctx, id, input);
    return ok(student);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "delete", "students");

    await StudentService.delete(ctx, id);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
