import { type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { AppError, ValidationError } from "@/lib/utils/errors";
import { StudentImportService } from "@/lib/services/student-import.service";
import { MAX_STUDENT_IMPORT_BYTES } from "@/lib/students/student-import";

const CSV_MIME_TYPES = new Set(["", "text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "text/comma-separated-values"]);
const tooLarge = `File is larger than ${Math.round(MAX_STUDENT_IMPORT_BYTES / 1000)} KB`;

const jsonSchema = z.object({
  dryRun: z.boolean().default(true),
  csv: z.string().min(1, "The file is empty").max(MAX_STUDENT_IMPORT_BYTES, tooLarge),
});

async function readUpload(req: NextRequest): Promise<{ csv: string; dryRun: boolean }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_STUDENT_IMPORT_BYTES + 64_000) throw new AppError("PAYLOAD_TOO_LARGE", tooLarge, 413);

  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError([{ path: ["file"], message: "Choose a .csv file to upload" }]);
    if (!/\.csv$/i.test(file.name) || !CSV_MIME_TYPES.has(file.type.toLowerCase())) {
      throw new AppError("UNSUPPORTED_FILE_TYPE", "Only .csv files can be imported", 415);
    }
    if (file.size === 0) throw new ValidationError([{ path: ["file"], message: "The file is empty" }]);
    if (file.size > MAX_STUDENT_IMPORT_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", tooLarge, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const csv = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return { csv, dryRun: form.get("dryRun") !== "false" };
  }
  return jsonSchema.parse((await req.json()) as unknown);
}

/** Bulk student CSV (max 150 rows): `dryRun` previews, otherwise imports every row or none. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "students");
    const { csv, dryRun } = await readUpload(req);
    return ok(await StudentImportService.run(ctx, csv, dryRun));
  } catch (err) {
    return handleError(err);
  }
}
