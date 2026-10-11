"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { Globe } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { analyticsQuery, type AnalyticsRangeInput } from "@/lib/crm/analytics";
import type { PagePerformanceReport } from "@/lib/analytics/page-performance";
import { WebsiteTrafficPanel } from "@/components/analytics/website-traffic-panel";

function CountList({ title, rows, testId }: { title: string; rows: { key: string; leads: number }[]; testId: string }) {
  return (
    <div data-testid={testId}>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No data.</p>
      ) : (
        <ul className="space-y-1">
          {rows.map((r) => (
            <li key={r.key} className="flex justify-between gap-3 text-xs">
              <span className="truncate text-white">{r.key}</span>
              <span className="font-mono text-muted-foreground">{r.leads}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Page Performance is reported separately from sales analytics: separate
 * endpoint and query, driven by the same applied date range.
 */
export function PagePerformanceSection({ range }: { range: AnalyticsRangeInput | null }) {
  const { data: session } = useSession();
  const showTraffic = Boolean(session?.user?.role) && session?.user?.role !== "ADMISSIONS_COUNSELOR";
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["analytics-page-performance", range?.from ?? null, range?.to ?? null],
    queryFn: () => apiFetch<PagePerformanceReport>(`/crm/analytics/page-performance${analyticsQuery(range)}`),
  });

  return (
    <Card className="bg-card border-white/10 shadow-lg" data-testid="page-performance">
      <CardHeader className="border-b border-white/5 pb-3">
        <CardTitle className="text-sm font-semibold text-white flex items-center gap-2">
          <Globe className="h-4 w-4" /> Page Performance
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          Website traffic from Google Analytics and lead attribution from the CRM, {range ? "for the selected period" : "for all time"}. The two are reported separately and never combined.
        </p>
      </CardHeader>
      <CardContent className="pt-4 space-y-5">
        {showTraffic && <WebsiteTrafficPanel range={range} />}
        <div data-testid="lead-attribution">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-300">Lead attribution · CRM</p>
          <p className="text-[11px] text-muted-foreground">
            Leads by website landing page, referrer and UTM tags. Counts leads, not page views.
          </p>
        </div>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading page performance...</p>
        ) : isError || !data ? (
          <p role="alert" className="text-xs text-rose-400">
            Could not load page performance{error instanceof Error ? `: ${error.message}` : ""}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 text-xs">
              <div>
                <p className="text-muted-foreground">Leads</p>
                <p className="text-lg font-bold text-white" data-testid="page-perf-total-leads">{data.totals.leads}</p>
              </div>
              <div>
                <p className="text-muted-foreground">With landing page</p>
                <p className="text-lg font-bold text-white">{data.totals.withLandingPage}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Converted to admission</p>
                <p className="text-lg font-bold text-white">{data.totals.admissions}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Conversion</p>
                <p className="text-lg font-bold text-white">{data.totals.conversionRate}%</p>
              </div>
            </div>

            {data.pages.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="page-perf-empty">No leads in this period.</p>
            ) : (
              <table className="w-full text-xs" data-testid="page-perf-table">
                <thead>
                  <tr className="border-b border-white/10 text-muted-foreground">
                    <th className="py-2 text-left font-semibold">Landing page</th>
                    <th className="py-2 text-right font-semibold">Leads</th>
                    <th className="py-2 text-right font-semibold">Admissions</th>
                    <th className="py-2 text-right font-semibold">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pages.map((p) => (
                    <tr key={p.page} className="border-b border-white/5" data-testid="page-perf-row">
                      <td className="py-1.5 font-mono text-white">{p.page}</td>
                      <td className="py-1.5 text-right">{p.leads}</td>
                      <td className="py-1.5 text-right">{p.admissions}</td>
                      <td className="py-1.5 text-right">{p.conversionRate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="grid gap-5 md:grid-cols-3">
              <CountList title="Referrers" rows={data.referrers} testId="page-perf-referrers" />
              <CountList title="UTM source" rows={data.utmSources} testId="page-perf-utm-sources" />
              <CountList title="UTM campaign" rows={data.utmCampaigns} testId="page-perf-utm-campaigns" />
            </div>
            {data.truncated && (
              <p className="text-[11px] text-amber-400">Showing the most recent leads only; narrow the date range for complete figures.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
