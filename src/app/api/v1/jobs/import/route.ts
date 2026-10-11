import { type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { JobImportService } from "@/lib/services/job-import.service";
import { MAX_JOB_IMPORT_BYTES } from "@/lib/jobs/job-import";

const importSchema = z.object({
  dryRun: z.boolean().default(true),
  csv: z.string().min(1, "The file is empty").max(MAX_JOB_IMPORT_BYTES, "File is larger than 1 MB"),
});

/** Bulk job CSV: `dryRun: true` previews/validates, `dryRun: false` imports all rows or none. */
export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "jobs");

    const body = (await req.json()) as unknown;
    const { csv, dryRun } = importSchema.parse(body);

    const report = await JobImportService.run(ctx, csv, dryRun);
    return ok(report);
  } catch (err) {
    return handleError(err);
  }
}
