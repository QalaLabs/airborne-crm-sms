import { type NextRequest } from "next/server";
import { z } from "zod";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { ValidationError } from "@/lib/utils/errors";
import { applyLeadReadScope } from "@/lib/leads/lead-scope";
import { istWeekContaining, parseISTWeek } from "@/lib/leads/ist-week";
import { AgentCallingService } from "@/lib/services/agent-calling.service";

const querySchema = z.object({
  week: z.string().optional(),
  assignedTo: z.string().uuid().optional(),
});

/** GET /leads/agent-calling?week=YYYY-MM-DD — one IST week (Mon–Sun) of calls to make. */
export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");

    const query = querySchema.parse(Object.fromEntries(req.nextUrl.searchParams.entries()));
    const week = query.week ? parseISTWeek(query.week) : istWeekContaining(new Date());
    if (!week) throw new ValidationError([{ path: ["week"], message: "Use YYYY-MM-DD (IST)" }]);

    const { assignedTo } = applyLeadReadScope(ctx.user, { assignedTo: query.assignedTo });
    return ok(await AgentCallingService.week(ctx.orgId, week, assignedTo));
  } catch (err) {
    return handleError(err);
  }
}
