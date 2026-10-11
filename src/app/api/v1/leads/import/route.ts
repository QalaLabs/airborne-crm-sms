import { type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { LeadImportService } from "@/lib/services/lead-import.service";
import { MAX_IMPORT_ROWS } from "@/lib/leads/lead-import-headers";

const importSchema = z.object({
  dryRun: z.boolean().default(true),
  rows: z
    .array(z.record(z.string().max(5000).optional()))
    .min(1, "The file has no data rows")
    .max(MAX_IMPORT_ROWS, `Split the file: at most ${MAX_IMPORT_ROWS} rows per upload`),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "leads");
    // Bulk import is a manager action — same roles that can bulk-assign.
    guard(ctx.user, "assign", "leads");

    const body = (await req.json()) as unknown;
    const { rows, dryRun } = importSchema.parse(body);

    const result = await LeadImportService.run(ctx, rows, dryRun);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
