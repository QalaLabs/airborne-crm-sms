import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { reorderSchema } from "@/lib/validations/lms.schema";
import { z } from "zod";

const schema = reorderSchema.extend({ chapterId: z.string().uuid() });

export async function PATCH(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const { chapterId, items } = schema.parse(await req.json());
    await LmsService.reorderTopics(ctx, chapterId, items);
    return ok({ reordered: items.length });
  } catch (err) {
    return handleError(err);
  }
}
