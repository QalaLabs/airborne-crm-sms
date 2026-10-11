import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, noContent, handleError } from "@/lib/utils/response";
import { updateLmsTopicSchema } from "@/lib/validations/lms.schema";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ topicId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms_courses");
    const { topicId } = await params;
    const body = (await req.json()) as unknown;
    const input = updateLmsTopicSchema.parse(body);
    const topic = await LmsService.updateTopic(ctx, topicId, input);
    return ok(topic);
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ topicId: string }> }) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "delete", "lms_courses");
    const { topicId } = await params;
    await LmsService.deleteTopic(ctx, topicId);
    return noContent();
  } catch (err) {
    return handleError(err);
  }
}
