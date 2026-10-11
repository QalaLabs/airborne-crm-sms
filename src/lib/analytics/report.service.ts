import { prisma } from "@/lib/db/client";
import { buildAnalyticsScope, type AnalyticsUser } from "@/lib/analytics/scope";
import {
  ANALYTICS_TIMEZONE,
  istMonthKey,
  istMonthKeysBetween,
  startOfISTMonth,
  type AnalyticsRange,
} from "@/lib/analytics/date-range";
import {
  ACTIVE_LEAD_STATUSES,
  TODAY_FOLLOW_UP_STATUSES,
  LOST_STATUSES,
} from "@/lib/leads/lead-status";
import { startOfISTDay } from "@/lib/time/ist";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function monthLabel(key: string, withYear: boolean): string {
  const [y, m] = key.split("-");
  const label = MONTHS[parseInt(m ?? "0", 10) - 1] ?? key;
  return withYear ? `${label} ${y}` : label;
}

function pct(part: number, total: number): string {
  if (total <= 0) return "0";
  return ((part / total) * 100).toFixed(1);
}

export type AnalyticsReport = Awaited<ReturnType<typeof buildAnalyticsReport>>;

/**
 * Sales analytics for one user's scope. Without a range the report covers all
 * time, the last 6 IST months and "today" (IST). With a range every aggregate
 * is filtered in the database on `createdAt` within [from, to] and the
 * "today" metrics become "within the selected period".
 */
export async function buildAnalyticsReport(
  user: AnalyticsUser,
  orgId: string,
  range: AnalyticsRange | null,
  now: Date = new Date(),
) {
  const scope = buildAnalyticsScope(user, orgId);
  const created = range ? { createdAt: { gte: range.from, lte: range.to } } : {};

  const leadWhere = { ...scope.leadWhere, ...created };
  const admissionWhere = { ...scope.admissionWhere, ...created };
  const paymentWhere = { ...scope.paymentWhere, ...created };
  const activityWhere = { ...scope.activityWhere, ...created };
  const studentWhere = { ...scope.studentWhere, ...created };
  const dealWhere = { ...scope.dealWhere, ...created };
  const { counselorWhere } = scope;

  const periodStart = range ? range.from : startOfISTDay(now);
  const periodEnd = range ? range.to : undefined;
  const inPeriod = { gte: periodStart, ...(periodEnd ? { lte: periodEnd } : {}) };

  const monthlyStart = range ? range.from : startOfISTMonth(now, -5);
  const monthKeys = range ? istMonthKeysBetween(range.from, range.to) : istMonthKeysBetween(monthlyStart, now);
  const monthlyWhere = { createdAt: { gte: monthlyStart, ...(periodEnd ? { lte: periodEnd } : {}) } };

  const [
    leadStatusCounts,
    leadSourceCounts,
    leadsInRange,
    admissionsAgg,
    admissionCount,
    admissionInRange,
    revenueAgg,
    paymentInRange,
    activityTypeCounts,
    admissionsByCounselor,
    counselors,
    studentsCount,
  ] = await Promise.all([
    prisma.lead.groupBy({ by: ["status"], where: leadWhere, _count: { _all: true } }),
    prisma.lead.groupBy({ by: ["source"], where: leadWhere, _count: { _all: true } }),
    prisma.lead.findMany({
      where: { ...leadWhere, ...monthlyWhere },
      select: { id: true, createdAt: true },
    }),
    prisma.admission.aggregate({
      where: admissionWhere,
      _avg: { feeFinal: true },
      _count: { _all: true },
    }),
    prisma.admission.count({ where: admissionWhere }),
    prisma.admission.findMany({
      where: { ...admissionWhere, ...monthlyWhere },
      select: { createdAt: true },
    }),
    prisma.paymentTransaction.aggregate({
      where: paymentWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.paymentTransaction.findMany({
      where: { ...paymentWhere, ...monthlyWhere },
      select: { createdAt: true, amount: true },
    }),
    prisma.leadActivity.groupBy({
      by: ["activityType"],
      where: activityWhere,
      _count: { _all: true },
    }),
    prisma.admission.groupBy({
      by: ["counselorId"],
      where: admissionWhere,
      _count: { _all: true },
    }),
    prisma.user.findMany({
      where: counselorWhere,
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.student.count({ where: studentWhere }),
  ]);

  let totalLeads = 0;
  let pipelineLeads = 0;
  let convertedLeads = 0;
  let lostLeads = 0;
  for (const c of leadStatusCounts) {
    totalLeads += c._count._all;
    if (c.status === "CONVERTED" || c.status === "WON") convertedLeads += c._count._all;
    else if ((LOST_STATUSES as readonly string[]).includes(c.status) || c.status === "LOST") lostLeads += c._count._all;
    else pipelineLeads += c._count._all;
  }

  const revenue = revenueAgg._sum.amount ? Number(revenueAgg._sum.amount) : 0;

  const multiYear = new Set(monthKeys.map((k) => k.slice(0, 4))).size > 1;
  const monthly = monthKeys.map((key) => ({
    key,
    label: monthLabel(key, multiYear),
    leads: 0,
    admissions: 0,
    revenue: 0,
  }));
  const monthIndex = new Map(monthly.map((m) => [m.key, m]));
  for (const l of leadsInRange) {
    const bucket = monthIndex.get(istMonthKey(l.createdAt));
    if (bucket) bucket.leads += 1;
  }
  for (const a of admissionInRange) {
    const bucket = monthIndex.get(istMonthKey(a.createdAt));
    if (bucket) bucket.admissions += 1;
  }
  for (const p of paymentInRange) {
    const bucket = monthIndex.get(istMonthKey(p.createdAt));
    if (bucket) bucket.revenue += Number(p.amount);
  }

  // Single scan of the scoped admissions — used for source conversion, the
  // fee ledger, opportunity collections, and per-counselor collections.
  const admissionLedger = await prisma.admission.findMany({
    where: admissionWhere,
    select: {
      id: true,
      leadId: true,
      feeFinal: true,
      feeAmount: true,
      feePaid: true,
      feeBalance: true,
      counselorId: true,
      lead: { select: { status: true, source: true } },
    },
  });
  const admissionLeadIds = new Set(admissionLedger.map((a) => a.leadId).filter(Boolean));

  const admissionLeads = admissionLeadIds.size;
  const conversionRate = pct(admissionLeads, totalLeads);

  const leadsBySource = new Map<string, { leads: number; admissions: number }>();
  for (const c of leadSourceCounts) {
    leadsBySource.set(c.source, { leads: c._count._all, admissions: 0 });
  }
  for (const a of admissionLedger) {
    if (a.lead?.source) {
      const row = leadsBySource.get(a.lead.source) ?? { leads: 0, admissions: 0 };
      row.admissions += 1;
      leadsBySource.set(a.lead.source, row);
    }
  }

  const bySource = Array.from(leadsBySource.entries()).map(([source, row]) => ({
    source,
    leads: row.leads,
    admissions: row.admissions,
    conversion: `${pct(row.admissions, row.leads)}%`,
  })).sort((a, b) => b.leads - a.leads);

  const byStatus = leadStatusCounts
    .map((s) => ({ status: s.status, count: s._count._all }))
    .sort((a, b) => b.count - a.count);

  const leadsByCounselor = await prisma.lead.groupBy({
    by: ["assignedTo"],
    where: { ...leadWhere, assignedTo: leadWhere.assignedTo ?? { not: null } },
    _count: { _all: true },
  });
  const activityPerCounselor = await prisma.leadActivity.groupBy({
    by: ["performedBy", "activityType"],
    where: activityWhere,
    _count: { _all: true },
  });
  const activityByCounselor = new Map<string, Record<string, number>>();
  for (const row of activityPerCounselor) {
    if (!row.performedBy) continue;
    const cur = activityByCounselor.get(row.performedBy) ?? {};
    cur[row.activityType] = row._count._all;
    activityByCounselor.set(row.performedBy, cur);
  }
  const counselorLeads = new Map(leadsByCounselor.map((r) => [r.assignedTo!, r._count._all]));
  const counselorAdmissions = new Map(admissionsByCounselor.map((r) => [r.counselorId ?? "", r._count._all]));
  const byCounselor = counselors.map((c) => {
    const leads = counselorLeads.get(c.id) ?? 0;
    const admissions = counselorAdmissions.get(c.id) ?? 0;
    const acts = activityByCounselor.get(c.id) ?? {};
    return {
      counselorId: c.id,
      name: c.name,
      leads,
      admissions,
      conversion: `${pct(admissions, leads)}%`,
      calls: acts.CALL ?? 0,
      meetings: acts.MEETING ?? 0,
      emails: acts.EMAIL ?? 0,
    };
  }).sort((a, b) => b.leads - a.leads);

  const activityByType = Object.fromEntries(
    activityTypeCounts.map((c) => [c.activityType, c._count._all]),
  );

  const activeLeadsCount = await prisma.lead.count({
    where: { ...leadWhere, status: { in: ACTIVE_LEAD_STATUSES } },
  });
  const newLeadsToday = await prisma.lead.count({
    where: { ...leadWhere, createdAt: inPeriod },
  });
  const todayFollowUps = await prisma.lead.count({
    where: { ...leadWhere, status: { in: TODAY_FOLLOW_UP_STATUSES } },
  });

  // Deals won / deal-linked collections use the base deal scope: a deal created
  // before the window but won inside it still counts for the period.
  const [dealWonInPeriod, dealStageRows, dealLinkedAdmissionIds] = await Promise.all([
    prisma.deal.count({ where: { ...scope.dealWhere, wonAt: inPeriod } }),
    prisma.deal.findMany({
      where: dealWhere,
      select: { stage: true, isActive: true, wonAt: true, lostAt: true },
    }),
    prisma.deal.findMany({
      where: { ...scope.dealWhere, admissionId: { not: null } },
      select: { admissionId: true },
    }),
  ]);
  const opportunitySales = dealWonInPeriod;

  const dealPipelineCounts = {
    open: 0,
    won: 0,
    lost: 0,
    byStage: {} as Record<string, number>,
  };
  for (const d of dealStageRows) {
    dealPipelineCounts.byStage[d.stage] = (dealPipelineCounts.byStage[d.stage] ?? 0) + 1;
    if (d.lostAt) dealPipelineCounts.lost += 1;
    else if (d.wonAt) dealPipelineCounts.won += 1;
    else if (d.isActive) dealPipelineCounts.open += 1;
  }

  const dealAdmissionIdSet = new Set(
    dealLinkedAdmissionIds
      .map((d) => d.admissionId)
      .filter((x): x is string => Boolean(x)),
  );

  const paymentsCompleted = await prisma.paymentTransaction.findMany({
    where: paymentWhere,
    select: { amount: true, createdAt: true, admissionId: true },
  });
  const isInPeriod = (d: Date) => d >= periodStart && (!periodEnd || d <= periodEnd);
  const opportunityCollectionsRaw = paymentsCompleted
    .filter((p) => isInPeriod(p.createdAt) && p.admissionId && dealAdmissionIdSet.has(p.admissionId))
    .reduce((s, p) => s + Number(p.amount), 0);
  const totalCollections = revenue;
  const collectionsToday = paymentsCompleted
    .filter((p) => isInPeriod(p.createdAt))
    .reduce((s, p) => s + Number(p.amount), 0);

  const validAdmissions = admissionLedger.filter(
    (a) => a.feeFinal != null && Number(a.feeFinal) > 0,
  );
  const totalfeeFinal = validAdmissions.reduce((s, a) => s + Number(a.feeFinal), 0);
  const totalPaid = admissionLedger.reduce((s, a) => s + Number(a.feePaid), 0);
  const totalCollectionPending = admissionLedger.reduce((s, a) => s + Number(a.feeBalance), 0);
  const collectionPct = pct(totalPaid, totalfeeFinal);

  const lostLeadSourceCounts = await prisma.lead.groupBy({
    by: ["source"],
    where: { ...leadWhere, status: { in: LOST_STATUSES } },
    _count: { _all: true },
  });
  const lostBySource = new Map<string, number>();
  for (const l of lostLeadSourceCounts) {
    lostBySource.set(l.source, l._count._all);
  }
  const workableTotal = totalLeads - lostLeads;
  const channelRows = bySource.map((c) => {
    const lost = lostBySource.get(c.source) ?? 0;
    return {
      ...c,
      lost,
      workableLeads: c.leads - lost,
      workablePct: `${pct(c.leads - lost, c.leads)}%`,
    };
  });
  const overallWorkablePct = `${pct(workableTotal, totalLeads)}%`;

  const admissionByCounselorLedger = new Map<string, number>();
  const paidByCounselor = new Map<string, number>();
  for (const a of admissionLedger) {
    const cid = a.counselorId ?? "unassigned";
    if (a.feeFinal != null) {
      admissionByCounselorLedger.set(cid, (admissionByCounselorLedger.get(cid) ?? 0) + Number(a.feeFinal));
    }
    paidByCounselor.set(cid, (paidByCounselor.get(cid) ?? 0) + Number(a.feePaid));
  }

  return {
    range: range
      ? {
          from: range.from.toISOString(),
          to: range.to.toISOString(),
          fromInput: range.fromInput,
          toInput: range.toInput,
          timezone: ANALYTICS_TIMEZONE,
        }
      : null,
    scope: scope.isCounselor ? ("counselor" as const) : ("organization" as const),
    totals: {
      leads: totalLeads,
      pipeline: pipelineLeads,
      converted: convertedLeads,
      lost: lostLeads,
      admissionLeads,
      conversionRate,
      admissions: admissionCount,
      avgAdmissionFee: admissionsAgg._avg.feeFinal
        ? Number(admissionsAgg._avg.feeFinal.toFixed(0))
        : null,
      revenue,
      payments: revenueAgg._count._all,
      students: studentsCount,
      counselors: counselors.length,
      activities: activityTypeCounts.reduce((s, c) => s + c._count._all, 0),
      meetings: activityByType.MEETING ?? 0,
      calls: activityByType.CALL ?? 0,

      activeLeads: activeLeadsCount,
      newLeadsToday,
      todayFollowUps,
      opportunitySales,
      opportunityCollections: Number(opportunityCollectionsRaw.toFixed(2)),
      collectionsToday: Number(collectionsToday.toFixed(2)),
      totalCollections: Number(totalCollections.toFixed(2)),
      totalCollectionPending: Number(totalCollectionPending.toFixed(2)),
      totalFeeBilled: Number(totalfeeFinal.toFixed(2)),
      totalFeePaid: Number(totalPaid.toFixed(2)),
      collectionPct,
      workableLeads: workableTotal,
      workablePct: overallWorkablePct,

      dealsOpen: dealPipelineCounts.open,
      dealsWon: dealPipelineCounts.won,
      dealsLost: dealPipelineCounts.lost,
      dealPipelineByStage: dealPipelineCounts.byStage,
    },
    monthly,
    bySource: channelRows,
    byStatus,
    byCounselor: byCounselor.map((c) => ({
      ...c,
      collections: Number((paidByCounselor.get(c.counselorId) ?? 0).toFixed(2)),
      collectionPct: pct(paidByCounselor.get(c.counselorId) ?? 0, admissionByCounselorLedger.get(c.counselorId) ?? 0),
    })),
  };
}
