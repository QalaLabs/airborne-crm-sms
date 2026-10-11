import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { buildAnalyticsScope, type AnalyticsUser } from "@/lib/analytics/scope";
import type { AnalyticsRange } from "@/lib/analytics/date-range";

/**
 * Page Performance: lead acquisition by website landing page, referrer and UTM
 * campaign, from the attribution captured on each lead by the website forms.
 * Kept separate from the sales report: its own query, its own endpoint, and no
 * figure here is summed into the sales totals. This measures leads, not visits;
 * page views / users / sessions come from GA4 separately (see ./ga4.ts).
 */

export const NOT_CAPTURED = "(not captured)";
export const DIRECT = "(direct)";
export const PAGE_PERFORMANCE_MAX_LEADS = 50_000;
const TOP_N = 20;

export function normalizeLandingPath(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return NOT_CAPTURED;
  let path: string;
  try {
    path = new URL(raw, "https://placeholder.invalid").pathname;
  } catch {
    return NOT_CAPTURED;
  }
  path = path.toLowerCase().replace(/\/{2,}/g, "/");
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path || "/";
}

export function normalizeReferrer(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return DIRECT;
  try {
    const host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    return host || DIRECT;
  } catch {
    return DIRECT;
  }
}

function normalizeTag(value: string | null | undefined): string {
  const v = (value ?? "").trim().toLowerCase();
  return v || NOT_CAPTURED;
}

export interface PagePerformanceLead {
  landingPage: string | null;
  referrerUrl: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  converted: boolean;
}

export interface PageRow {
  page: string;
  leads: number;
  admissions: number;
  conversionRate: string;
}

export interface CountRow {
  key: string;
  leads: number;
}

function rate(part: number, total: number): string {
  return total > 0 ? ((part / total) * 100).toFixed(1) : "0";
}

function topCounts(map: Map<string, number>): CountRow[] {
  return [...map.entries()]
    .map(([key, leads]) => ({ key, leads }))
    .sort((a, b) => b.leads - a.leads || a.key.localeCompare(b.key))
    .slice(0, TOP_N);
}

/** Pure aggregation; every lead is counted exactly once per breakdown. */
export function aggregatePagePerformance(leads: PagePerformanceLead[]) {
  const pages = new Map<string, { leads: number; admissions: number }>();
  const referrers = new Map<string, number>();
  const sources = new Map<string, number>();
  const campaigns = new Map<string, number>();
  let captured = 0;
  let admissions = 0;

  for (const lead of leads) {
    const page = normalizeLandingPath(lead.landingPage);
    if (page !== NOT_CAPTURED) captured++;
    if (lead.converted) admissions++;
    const row = pages.get(page) ?? { leads: 0, admissions: 0 };
    row.leads++;
    if (lead.converted) row.admissions++;
    pages.set(page, row);

    const ref = normalizeReferrer(lead.referrerUrl);
    referrers.set(ref, (referrers.get(ref) ?? 0) + 1);
    const src = normalizeTag(lead.utmSource);
    sources.set(src, (sources.get(src) ?? 0) + 1);
    const camp = normalizeTag(lead.utmCampaign);
    campaigns.set(camp, (campaigns.get(camp) ?? 0) + 1);
  }

  const pageRows: PageRow[] = [...pages.entries()]
    .map(([page, r]) => ({ page, leads: r.leads, admissions: r.admissions, conversionRate: rate(r.admissions, r.leads) }))
    .sort((a, b) => b.leads - a.leads || a.page.localeCompare(b.page));

  return {
    totals: {
      leads: leads.length,
      withLandingPage: captured,
      withoutLandingPage: leads.length - captured,
      admissions,
      conversionRate: rate(admissions, leads.length),
    },
    pages: pageRows.slice(0, TOP_N * 2),
    referrers: topCounts(referrers),
    utmSources: topCounts(sources),
    utmCampaigns: topCounts(campaigns),
  };
}

export type PagePerformanceReport = Awaited<ReturnType<typeof buildPagePerformance>>;

export async function buildPagePerformance(user: AnalyticsUser, orgId: string, range: AnalyticsRange | null) {
  const scope = buildAnalyticsScope(user, orgId);
  const where: Prisma.LeadWhereInput = {
    ...scope.leadWhere,
    ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      select: {
        landingPage: true,
        referrerUrl: true,
        utmSource: true,
        utmCampaign: true,
        _count: { select: { admissions: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_PERFORMANCE_MAX_LEADS,
    }),
  ]);

  const report = aggregatePagePerformance(
    rows.map((r) => ({
      landingPage: r.landingPage,
      referrerUrl: r.referrerUrl,
      utmSource: r.utmSource,
      utmCampaign: r.utmCampaign,
      converted: r._count.admissions > 0,
    })),
  );

  return {
    ...report,
    truncated: total > rows.length,
    range: range ? { from: range.from.toISOString(), to: range.to.toISOString() } : null,
  };
}
