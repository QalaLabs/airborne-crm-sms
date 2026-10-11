import { toCsv, type CsvValue } from "@/lib/utils/csv";
import { formatInIST } from "@/lib/time/ist";
import type { AnalyticsReport } from "@/lib/analytics/report.service";

export const ANALYTICS_CSV_HEADER = ["Section", "Dimension", "Metric", "Value"] as const;

const TOTAL_LABELS: Record<string, string> = {
  leads: "Total Leads",
  pipeline: "Pipeline Leads",
  converted: "Converted Leads",
  lost: "Lost Leads",
  admissionLeads: "Leads With Admission",
  conversionRate: "Conversion Rate %",
  admissions: "Admissions",
  avgAdmissionFee: "Average Admission Fee (INR)",
  revenue: "Revenue (INR)",
  payments: "Completed Payments",
  students: "Students",
  counselors: "Active Counselors",
  activities: "Activities",
  meetings: "Meetings",
  calls: "Calls",
  activeLeads: "Active Leads",
  newLeadsToday: "New Leads (period)",
  todayFollowUps: "Follow-ups Due",
  opportunitySales: "Deals Won (period)",
  opportunityCollections: "Deal-linked Collections (period, INR)",
  collectionsToday: "Collections (period, INR)",
  totalCollections: "Total Collections (INR)",
  totalCollectionPending: "Collection Pending (INR)",
  totalFeeBilled: "Fee Billed (INR)",
  totalFeePaid: "Fee Paid (INR)",
  collectionPct: "Collection %",
  workableLeads: "Workable Leads",
  workablePct: "Workable %",
  dealsOpen: "Deals Open",
  dealsWon: "Deals Won",
  dealsLost: "Deals Lost",
};

/**
 * Long-format CSV ("tidy" rows) of the exact report the API returns for the
 * same range and scope, so it filters/pivots cleanly in Excel or Sheets.
 */
export function analyticsReportToCsv(report: AnalyticsReport, generatedAt: Date = new Date()): string {
  const rows: CsvValue[][] = [[...ANALYTICS_CSV_HEADER]];
  const meta = (metric: string, value: CsvValue) => rows.push(["Report", "", metric, value]);

  meta("Generated At (IST)", formatInIST(generatedAt));
  meta("Timezone", "Asia/Kolkata (IST)");
  meta("Range From (IST)", report.range?.fromInput ?? "All time");
  meta("Range To (IST)", report.range?.toInput ?? "All time");
  meta("Scope", report.scope === "counselor" ? "Counselor (own records)" : "Organization");

  for (const [key, label] of Object.entries(TOTAL_LABELS)) {
    const value = (report.totals as Record<string, unknown>)[key];
    rows.push(["Totals", "", label, typeof value === "number" || typeof value === "string" ? value : ""]);
  }
  for (const [stage, count] of Object.entries(report.totals.dealPipelineByStage)) {
    rows.push(["Deal Pipeline", stage, "Deals", count]);
  }
  for (const m of report.monthly) {
    rows.push(["Monthly", m.key, "Leads", m.leads]);
    rows.push(["Monthly", m.key, "Admissions", m.admissions]);
    rows.push(["Monthly", m.key, "Revenue (INR)", Number(m.revenue.toFixed(2))]);
  }
  for (const s of report.bySource) {
    rows.push(["By Source", s.source, "Leads", s.leads]);
    rows.push(["By Source", s.source, "Admissions", s.admissions]);
    rows.push(["By Source", s.source, "Conversion", s.conversion]);
    rows.push(["By Source", s.source, "Lost", s.lost]);
    rows.push(["By Source", s.source, "Workable Leads", s.workableLeads]);
    rows.push(["By Source", s.source, "Workable %", s.workablePct]);
  }
  for (const s of report.byStatus) {
    rows.push(["By Status", s.status, "Leads", s.count]);
  }
  for (const c of report.byCounselor) {
    rows.push(["By Counselor", c.name, "Leads", c.leads]);
    rows.push(["By Counselor", c.name, "Admissions", c.admissions]);
    rows.push(["By Counselor", c.name, "Conversion", c.conversion]);
    rows.push(["By Counselor", c.name, "Calls", c.calls]);
    rows.push(["By Counselor", c.name, "Meetings", c.meetings]);
    rows.push(["By Counselor", c.name, "Emails", c.emails]);
    rows.push(["By Counselor", c.name, "Collections (INR)", c.collections]);
    rows.push(["By Counselor", c.name, "Collection %", c.collectionPct]);
  }
  return toCsv(rows);
}

export function analyticsCsvFilename(report: Pick<AnalyticsReport, "range">): string {
  if (!report.range) return "airborne-analytics_all-time.csv";
  const slug = (s: string) => s.replace(/[^0-9A-Za-z-]/g, "");
  return `airborne-analytics_${slug(report.range.fromInput)}_to_${slug(report.range.toInput)}.csv`;
}
