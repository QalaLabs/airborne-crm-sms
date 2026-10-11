import { z } from "zod";
import { type NextRequest } from "next/server";
import { MediaService } from "@/lib/services/media.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { registerAssetSchema, assetFiltersSchema } from "@/lib/validations/media.schema";
import { ValidationError } from "@/lib/utils/errors";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "media");

    const url = new URL(req.url);
    const filters = assetFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const { data, total } = await MediaService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "media");

    const contentType = req.headers.get("content-type") ?? "";

    // Primary path — multipart upload: server uploads to Supabase, then persists.
    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file");

      if (!(file instanceof File)) {
        throw new ValidationError([{ message: "Multipart field 'file' is required" }]);
      }

      const nameRaw = form.get("name");
      const folderRaw = form.get("folderId");
      const altRaw = form.get("altText");
      const tagsRaw = form.get("tags");

      let folderId: string | undefined;
      if (typeof folderRaw === "string" && folderRaw.trim() && folderRaw !== "null") {
        const parsed = z.string().uuid().safeParse(folderRaw);
        if (!parsed.success) {
          throw new ValidationError([{ message: "folderId must be a valid UUID" }]);
        }
        folderId = parsed.data;
      }

      const tags =
        typeof tagsRaw === "string" && tagsRaw.trim()
          ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
          : [];

      const asset = await MediaService.upload(ctx, {
        originalName: file.name,
        name: typeof nameRaw === "string" && nameRaw.trim() ? nameRaw : file.name,
        mimeType: file.type,
        sizeBytes: file.size,
        buffer: new Uint8Array(await file.arrayBuffer()),
        folderId,
        altText: typeof altRaw === "string" ? altRaw : undefined,
        tags,
      });

      return created(asset);
    }

    // Backward-compatible path — register an asset that is already in storage.
    const body = await req.json() as unknown;
    const input = registerAssetSchema.parse(body);

    const asset = await MediaService.register(ctx, input);
    return created(asset);
  } catch (err) {
    return handleError(err);
  }
}
