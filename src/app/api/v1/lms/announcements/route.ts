import { type NextRequest } from "next/server";
import { LmsService } from "@/lib/services/lms.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createAnnouncementSchema } from "@/lib/validations/lms.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "lms");
    const url = new URL(req.url);
    const courseId = url.searchParams.get("courseId") ?? undefined;
    const announcements = await LmsService.listAnnouncements(ctx, courseId);
    return ok(announcements);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "lms");
    const body = (await req.json()) as unknown;
    const input = createAnnouncementSchema.parse(body);
    const announcement = await LmsService.createAnnouncement(ctx, input);
    return created(announcement);
  } catch (err) {
    return handleError(err);
  }
}
