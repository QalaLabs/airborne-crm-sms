import { csvCell, CSV_BOM, type CsvValue } from "@/lib/utils/csv";
import { statusLabel } from "@/lib/leads/lead-status";
import { leadSourceLabel } from "@/lib/leads/lead-source";

/** Upper bound for one export; larger sets must be narrowed with filters. */
export const LEAD_EXPORT_MAX_ROWS = 50_000;

export interface LeadExportRecord {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  city: string | null;
  state: string | null;
  pincode: string | null;
  courseInterest: string | null;
  source: string;
  status: string;
  score: number;
  manualAmount: { toString(): string } | number | null;
  lostReason: string | null;
  nextFollowUp: Date | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  counselor: { name: string } | null;
  campus: { name: string } | null;
}

export const LEAD_EXPORT_HEADERS = [
  "Lead ID",
  "Name",
  "Email",
  "Phone",
  "City",
  "State",
  "Pincode",
  "Course Interest",
  "Source",
  "Status",
  "Score",
  "Manual Amount",
  "Lost Reason",
  "Assigned Counselor",
  "Campus",
  "Next Follow-up (IST)",
  "Last Activity (IST)",
  "Created (IST)",
  "UTM Source",
  "UTM Medium",
  "UTM Campaign",
] as const;

const IST_OFFSET_MS = 330 * 60_000;

/** `YYYY-MM-DD HH:mm` in IST; spreadsheet-friendly and unambiguous. */
export function formatExportDateIST(d: Date | null): string {
  if (!d) return "";
  const s = new Date(d.getTime() + IST_OFFSET_MS).toISOString();
  return `${s.slice(0, 10)} ${s.slice(11, 16)}`;
}

export function leadExportRow(lead: LeadExportRecord): CsvValue[] {
  const amount = lead.manualAmount === null ? null : Number(lead.manualAmount.toString());
  return [
    lead.id,
    lead.name,
    lead.email,
    lead.phone,
    lead.city,
    lead.state,
    lead.pincode,
    lead.courseInterest,
    leadSourceLabel(lead.source),
    statusLabel(lead.status),
    lead.score,
    amount,
    lead.lostReason,
    lead.counselor?.name ?? "",
    lead.campus?.name ?? "",
    formatExportDateIST(lead.nextFollowUp),
    formatExportDateIST(lead.lastActivityAt),
    formatExportDateIST(lead.createdAt),
    lead.utmSource,
    lead.utmMedium,
    lead.utmCampaign,
  ];
}

export function csvLine(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(",") + "\r\n";
}

/** BOM + header line, emitted once at the start of the stream. */
export function leadExportPreamble(): string {
  return CSV_BOM + csvLine(LEAD_EXPORT_HEADERS);
}

/** `leads-YYYY-MM-DD.csv` using the IST calendar date; contains only safe characters. */
export function leadExportFilename(now: Date = new Date()): string {
  return `leads-${formatExportDateIST(now).slice(0, 10)}.csv`;
}
