import { type NextRequest } from "next/server";
import { DocumentService } from "@/lib/services/document.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { uploadDocumentSchema, documentFiltersSchema, getPresignedUrlSchema, multipartDocumentSchema } from "@/lib/validations/document.schema";
import { MAX_DOCUMENT_BYTES } from "@/lib/documents/upload-policy";
import { AppError } from "@/lib/utils/errors";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id: admissionId } = await params;
    guard(ctx.user, "read", "documents");

    const url = new URL(req.url);
    const filters = documentFiltersSchema.parse({
      ...Object.fromEntries(url.searchParams),
      admissionId,
    });

    const { data, total } = await DocumentService.list(ctx, filters);
    return ok(data, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id: admissionId } = await params;
    guard(ctx.user, "write", "documents");

    const url = new URL(req.url);

    // multipart/form-data — server-side validated upload (dossier UI)
    if ((req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
      const declaredLength = Number(req.headers.get("content-length") ?? 0);
      if (declaredLength > MAX_DOCUMENT_BYTES + 64 * 1024) {
        throw new AppError("FILE_TOO_LARGE", `Documents must be ${MAX_DOCUMENT_BYTES / (1024 * 1024)} MB or smaller.`, 413);
      }
      let form: FormData;
      try {
        form = await req.formData();
      } catch {
        throw new AppError("VALIDATION_ERROR", "Malformed upload: expected multipart form data with a file", 400);
      }
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "A file is required", 400);
      const { documentType } = multipartDocumentSchema.parse({ documentType: form.get("documentType") });
      const doc = await DocumentService.uploadFile(ctx, admissionId, {
        documentType,
        fileName: file.name,
        declaredType: file.type,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      return created(doc);
    }

    // ?action=presign — return a presigned upload URL
    if (url.searchParams.get("action") === "presign") {
      const body = await req.json() as unknown;
      const { fileName, contentType } = getPresignedUrlSchema.parse(body);
      const result = await DocumentService.getPresignedUrl(ctx, admissionId, fileName, contentType);
      return ok(result);
    }

    // Default: register uploaded document
    const body = await req.json() as unknown;
    const input = uploadDocumentSchema.parse({ ...(body as object), admissionId });
    const doc = await DocumentService.upload(ctx, input);
    return created(doc);
  } catch (err) {
    return handleError(err);
  }
}
