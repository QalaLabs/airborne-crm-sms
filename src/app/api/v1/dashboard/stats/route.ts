import { prisma } from "@/lib/db/client";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { buildAnalyticsScope } from "@/lib/analytics/scope";
import { startOfISTDay } from "@/lib/time/ist";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "analytics");

    const scope = buildAnalyticsScope(ctx.user, ctx.orgId);
    const todayStart = startOfISTDay();

    const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [
      leadsCount,
      leadsToday,
      leadsThisWeek,
      leadsThisMonth,
      leadsFollowUp,
      studentsCount,
      admissionsCount,
      placementsCount,
      activeCounsellors,
      revenueResult
    ] = await Promise.all([
      prisma.lead.count({ where: scope.leadWhere }),
      prisma.lead.count({ where: { ...scope.leadWhere, createdAt: { gte: todayStart } } }),
      prisma.lead.count({ where: { ...scope.leadWhere, createdAt: { gte: weekStart } } }),
      prisma.lead.count({ where: { ...scope.leadWhere, createdAt: { gte: monthStart } } }),
      prisma.lead.count({ where: { ...scope.leadWhere, status: "FOLLOW_UP" } }),
      prisma.student.count({ where: scope.studentWhere }),
      prisma.admission.count({ where: scope.admissionWhere }),
      scope.isCounselor
        ? prisma.placement.count({ where: { orgId: ctx.orgId, student: { lead: { assignedTo: ctx.user.id } } } })
        : prisma.placement.count({ where: { orgId: ctx.orgId } }),
      prisma.user.count({ where: scope.counselorWhere }),
      prisma.paymentTransaction.aggregate({
        _sum: { amount: true },
        where: scope.paymentWhere,
      })
    ]);

    const revenue = revenueResult._sum.amount ? Number(revenueResult._sum.amount) : 0;

    return ok({
      leadsCount,
      leadsToday,
      leadsThisWeek,
      leadsThisMonth,
      leadsFollowUp,
      studentsCount,
      admissionsCount,
      placementsCount,
      activeCounsellors,
      revenue,
    });
  } catch (err) {
    return handleError(err);
  }
}
