import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { created, handleError } from "@/lib/utils/response";
import { z } from "zod";

const schema = z.object({ moduleId: z.string().uuid(), title: z.string().min(1).max(255), order: z.number().int().min(0).optional() });

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const body = (await req.json()) as unknown;
    const input = schema.parse(body);
    const ch = await LmsService.createChapter(ctx, input.moduleId, input.title, input.order);
    return created(ch);
  } catch (err) {
    return handleError(err);
  }
}
