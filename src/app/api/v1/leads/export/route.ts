import { type NextRequest } from "next/server";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { handleError } from "@/lib/utils/response";
import { AppError } from "@/lib/utils/errors";
import { leadFiltersSchema } from "@/lib/validations/lead.schema";
import { applyLeadReadScope } from "@/lib/leads/lead-scope";
import { LeadRepository } from "@/lib/repositories/lead.repository";
import { AuditService } from "@/lib/services/audit.service";
import {
  LEAD_EXPORT_MAX_ROWS,
  csvLine,
  leadExportFilename,
  leadExportPreamble,
  leadExportRow,
} from "@/lib/leads/lead-export";

/**
 * CSV of every lead matching the same filters, org and counselor scope as
 * GET /leads — the full filtered set, not one page. Requires `export, leads`
 * on top of `read, leads`. Rows are streamed in batches so memory stays bounded.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");
    guard(ctx.user, "export", "leads");

    const raw = Object.fromEntries(req.nextUrl.searchParams.entries());
    delete raw.page;
    delete raw.limit;
    const { page: _page, limit: _limit, ...parsed } = leadFiltersSchema.parse(raw);
    const filters = applyLeadReadScope(ctx.user, parsed);

    const total = await LeadRepository.countForExport(ctx.orgId, filters);
    if (total > LEAD_EXPORT_MAX_ROWS) {
      throw new AppError(
        "EXPORT_TOO_LARGE",
        `${total} leads match these filters; narrow them to at most ${LEAD_EXPORT_MAX_ROWS} to export`,
        413,
      );
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "lead.exported",
      entityType: "lead",
      entityId: ctx.orgId,
      newValue: { rows: total, filters },
    });

    const encoder = new TextEncoder();
    const batches = LeadRepository.iterateForExport(ctx.orgId, filters);
    let started = false;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (!started) {
            started = true;
            controller.enqueue(encoder.encode(leadExportPreamble()));
            return;
          }
          const next = await batches.next();
          if (next.done) {
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(next.value.map((lead) => csvLine(leadExportRow(lead))).join("")));
        } catch (err) {
          controller.error(err);
        }
      },
      async cancel() {
        await batches.return(undefined);
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${leadExportFilename()}"`,
        "Cache-Control": "no-store",
        "X-Total-Count": String(total),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
