import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { z } from "zod";

const updateSchema = z.object({ title: z.string().min(1).max(255).optional(), order: z.number().int().min(0).optional() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ chapterId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const { chapterId } = await params;
    const body = (await req.json()) as unknown;
    const input = updateSchema.parse(body);
    const ch = await LmsService.updateChapter(ctx, chapterId, input);
    return ok(ch);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ chapterId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "lms_courses");
    const { chapterId } = await params;
    await LmsService.deleteChapter(ctx, chapterId);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
