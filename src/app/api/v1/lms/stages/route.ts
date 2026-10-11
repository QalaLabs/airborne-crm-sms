import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { reorderSchema } from "@/lib/validations/lms.schema";
import { z } from "zod";

const createStageSchema = z.object({
  courseId: z.string().uuid(),
  title: z.string().min(1).max(255),
  order: z.number().int().min(0).optional(),
});

const reorderStagesSchema = reorderSchema.extend({ courseId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const body = (await req.json()) as unknown;
    const input = createStageSchema.parse(body);
    const stage = await LmsService.createStage(ctx, input.courseId, input.title, input.order);
    return created(stage);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const body = (await req.json()) as unknown;
    const { courseId, items } = reorderStagesSchema.parse(body);
    await LmsService.reorderStages(ctx, courseId, items);
    return ok({ reordered: items.length });
  } catch (err) {
    return handleError(err);
  }
}
