import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createLmsModuleSchema, reorderSchema } from "@/lib/validations/lms.schema";
import { z } from "zod";

const createModuleSchema = createLmsModuleSchema.extend({ stageId: z.string().uuid() });
const reorderModulesSchema = reorderSchema.extend({ stageId: z.string().uuid() });

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const body = (await req.json()) as unknown;
    const input = createModuleSchema.parse(body);
    const mod = await LmsService.createModule(ctx, input.stageId, {
      title: input.title,
      order: input.order,
      passPercent: input.passPercent,
      maxAttempts: input.maxAttempts,
    });
    return created(mod);
  } catch (err) {
    return handleError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const body = (await req.json()) as unknown;
    const { stageId, items } = reorderModulesSchema.parse(body);
    await LmsService.reorderModules(ctx, stageId, items);
    return ok({ reordered: items.length });
  } catch (err) {
    return handleError(err);
  }
}
