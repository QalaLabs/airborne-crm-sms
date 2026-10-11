import { apiFetch, ApiClientError, formatApiErrorMessage } from "@/lib/api";
import type { AnalyticsData } from "./types";

/** IST wall-clock bounds, `YYYY-MM-DDTHH:mm` (or `YYYY-MM-DD`). */
export interface AnalyticsRangeInput {
  from: string;
  to: string;
}

export function analyticsQuery(range?: AnalyticsRangeInput | null): string {
  if (!range) return "";
  return `?${new URLSearchParams({ from: range.from, to: range.to }).toString()}`;
}

export async function getAnalytics(range?: AnalyticsRangeInput | null): Promise<AnalyticsData> {
  return apiFetch<AnalyticsData>(`/crm/analytics${analyticsQuery(range)}`);
}

/** Downloads the server-generated CSV for the same range/scope as the report. */
export async function downloadAnalyticsCsv(range?: AnalyticsRangeInput | null): Promise<string> {
  const res = await fetch(`/api/v1/crm/analytics/export${analyticsQuery(range)}`, { credentials: "include" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string; details?: unknown } };
    throw new ApiClientError(formatApiErrorMessage(err?.error, res.status), err?.error?.code, res.status);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "airborne-analytics.csv";
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}
