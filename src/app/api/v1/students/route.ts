import { type NextRequest } from "next/server";
import { StudentService } from "@/lib/services/student.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { studentFiltersSchema, createStudentSchema } from "@/lib/validations/student.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "students");

    const url = new URL(req.url);
    const filters = studentFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const { data, total } = await StudentService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "students");

    const body = await req.json() as unknown;
    const input = createStudentSchema.parse(body);

    const student = await StudentService.create(ctx, input);
    return created(student);
  } catch (err) {
    return handleError(err);
  }
}
