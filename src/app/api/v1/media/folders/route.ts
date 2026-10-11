import { type NextRequest } from "next/server";
import { MediaFolderService } from "@/lib/services/media.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createFolderSchema } from "@/lib/validations/media.schema";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "media");

    const url = new URL(req.url);
    const parentRaw = url.searchParams.get("parentId");
    const parentId =
      parentRaw && parentRaw !== "" && parentRaw !== "null" ? parentRaw : undefined;

    const folders = await MediaFolderService.list(ctx, parentId);
    return ok(folders);
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "media");

    const body = await req.json() as unknown;
    const input = createFolderSchema.parse(body);

    const folder = await MediaFolderService.create(ctx, input);
    return created(folder);
  } catch (err) {
    return handleError(err);
  }
}
