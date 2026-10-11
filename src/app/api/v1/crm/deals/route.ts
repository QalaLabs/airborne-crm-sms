import { DealRepository } from "@/lib/repositories/deal.repository";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "deals");

    const orgId = ctx.orgId;

    const [pipeline, recentDeals, recentWonDeals] = await Promise.all([
      DealRepository.getPipelineSummary(orgId),
      DealRepository.findMany(orgId, {
        page: 1,
        limit: 10,
        sortBy: "updatedAt",
        sortDir: "desc",
      }),
      DealRepository.findMany(orgId, {
        page: 1,
        limit: 10,
        sortBy: "wonAt",
        sortDir: "desc",
        status: "won",
      }),
    ]);

    return ok({
      capability: {
        deals: true,
        status: "implemented",
        reason:
          "Deal/Opportunity is now a first-class persisted entity (model Deal). The native funnel reuses the admission stages (ENQUIRY → DOCUMENT_COLLECTION → VERIFICATION → OFFER_LETTER → FEE_PAYMENT → ENROLLED); WON ⇔ ENROLLED, LOST ⇔ DROPPED/CANCELLED.",
      },
      pipeline: {
        byStage: pipeline.byStage,
        won: pipeline.wonCount,
        wonValue: pipeline.wonValue,
        lost: pipeline.lostCount,
        lostValue: pipeline.lostValue,
        open: pipeline.openCount,
        openValue: pipeline.openValue,
      },
      recentDeals: recentDeals.data,
      recentWonDeals: recentWonDeals.data,
    });
  } catch (err) {
    return handleError(err);
  }
}