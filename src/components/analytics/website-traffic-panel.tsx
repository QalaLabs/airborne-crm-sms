"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { analyticsQuery, type AnalyticsRangeInput } from "@/lib/crm/analytics";
import type { WebsiteTrafficResult } from "@/lib/analytics/ga4";

const REASON_LABEL: Record<string, string> = {
  invalid_config: "GA4 configuration is invalid",
  unauthorized: "GA4 credentials were rejected",
  forbidden: "No access to the GA4 property",
  invalid_property: "GA4 property id was rejected",
  unavailable: "Google Analytics is unavailable",
  timeout: "Google Analytics timed out",
};

function Metric({ label, value, testId }: { label: string; value: number; testId: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-bold text-white" data-testid={testId}>
        {value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

/** GA4 website traffic (page views / users / sessions). Never mixed with CRM lead counts. */
export function WebsiteTrafficPanel({ range }: { range: AnalyticsRangeInput | null }) {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["analytics-website-traffic", range?.from ?? null, range?.to ?? null],
    queryFn: () => apiFetch<WebsiteTrafficResult>(`/crm/analytics/traffic${analyticsQuery(range)}`),
    retry: false,
  });

  return (
    <section className="space-y-4 rounded-xl border border-sky-500/20 bg-sky-500/5 p-4" data-testid="ga4-traffic">
      <div>
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-300">
          <BarChart3 className="h-3.5 w-3.5" /> Website traffic · Google Analytics 4
        </p>
        <p className="text-[11px] text-muted-foreground">Page views, users and sessions reported by GA4 for the website.</p>
      </div>

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading website traffic...</p>
      ) : isError || !data ? (
        <p role="alert" className="text-xs text-rose-400" data-testid="ga4-status">
          Could not load website traffic{error instanceof Error ? `: ${error.message}` : ""}
        </p>
      ) : data.status === "not_configured" ? (
        <p className="text-xs text-amber-300" data-testid="ga4-status" data-ga4-status="not_configured">
          Not connected — {data.message} Traffic figures are not shown until GA4 is connected.
        </p>
      ) : data.status === "error" ? (
        <p role="alert" className="text-xs text-rose-400" data-testid="ga4-status" data-ga4-status={data.reason}>
          {REASON_LABEL[data.reason] ?? "Google Analytics is unavailable"} — {data.message} Traffic figures are not shown.
        </p>
      ) : (
        <>
          <p className="text-[11px] text-muted-foreground" data-testid="ga4-range">
            GA4 dates {data.dateRange.startDate} to {data.dateRange.endDate}
            {data.propertyTimeZone ? ` (${data.propertyTimeZone})` : ""}
          </p>
          {data.widenedToWholeDays && (
            <p className="text-[11px] text-amber-300" data-testid="ga4-whole-days">
              GA4 reports whole days, so the selected times were widened to full IST days.
            </p>
          )}
          {!data.timeZoneMatchesIST && (
            <p className="text-[11px] text-amber-300" data-testid="ga4-tz-warning">
              The GA4 property reports in {data.propertyTimeZone}, so day boundaries follow that time zone, not IST.
            </p>
          )}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <Metric label="Page views" value={data.totals.pageViews} testId="ga4-total-views" />
            <Metric label="Users" value={data.totals.users} testId="ga4-total-users" />
            <Metric label="Sessions" value={data.totals.sessions} testId="ga4-total-sessions" />
          </div>
          {data.empty ? (
            <p className="text-xs text-muted-foreground" data-testid="ga4-empty">GA4 recorded no website traffic in this period.</p>
          ) : (
            <div className="grid gap-5 lg:grid-cols-3">
              <table className="w-full text-xs lg:col-span-2" data-testid="ga4-pages-table">
                <thead>
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="py-2 text-left font-semibold">Page</th>
                    <th className="py-2 text-right font-semibold">Views</th>
                    <th className="py-2 text-right font-semibold">Users</th>
                    <th className="py-2 text-right font-semibold">Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pages.map((p) => (
                    <tr key={`${p.path}|${p.title}`} className="border-b border-white/5" data-testid="ga4-page-row">
                      <td className="py-1.5">
                        <span className="font-mono text-white">{p.path}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{p.title}</span>
                      </td>
                      <td className="py-1.5 text-right">{p.pageViews}</td>
                      <td className="py-1.5 text-right">{p.users}</td>
                      <td className="py-1.5 text-right">{p.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div data-testid="ga4-sources">
                <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Traffic sources (sessions)</p>
                <ul className="space-y-1">
                  {data.sources.map((s) => (
                    <li key={`${s.source}|${s.medium}`} className="flex justify-between gap-3 text-xs">
                      <span className="truncate text-white">
                        {s.source} / {s.medium}
                      </span>
                      <span className="font-mono text-muted-foreground">{s.sessions}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
