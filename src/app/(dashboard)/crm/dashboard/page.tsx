"use client";

import * as React from "react";
import {
  Activity, BarChart3, Users, Target, DollarSign, TrendingUp, CircleCheck, PhoneCall, CalendarDays, Wallet, Percent, Layers, TrendingDown,
} from "lucide-react";
import { getAnalytics } from "@/lib/crm/analytics";
import { getDealsData } from "@/lib/crm/deals";
import type { AnalyticsData, DealData } from "@/lib/crm/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function CRMDashboardPage() {
  const [analytics, setAnalytics] = React.useState<AnalyticsData | null>(null);
  const [deals, setDeals] = React.useState<DealData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    Promise.all([getAnalytics(), getDealsData()])
      .then(([a, d]) => {
        setAnalytics(a);
        setDeals(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  if (loading) {
    return <div className="p-6 text-white text-xs">Loading CRM dashboard…</div>;
  }

  if (error || !analytics) {
    return <div className="p-6 text-red-500 font-bold">Error loading dashboard: {error || "No data"}</div>;
  }

  const t = analytics.totals;
  const pipeline = deals?.pipeline;

  const statCards = [
    { label: "Active Leads", value: t.activeLeads, sub: `${t.newLeadsToday} new today`, icon: Users, color: "text-blue-500 bg-blue-500/10" },
    { label: "Today's Follow-ups", value: t.todayFollowUps, sub: "follow-ups due", icon: CalendarDays, color: "text-amber-500 bg-amber-500/10" },
    { label: "Opportunity Sales", value: t.opportunitySales, sub: "pipeline wins today", icon: Target, color: "text-emerald-500 bg-emerald-500/10" },
    { label: "Opportunity Collections", value: t.opportunityCollections, sub: "INR · pipeline-linked", icon: DollarSign, color: "text-purple-500 bg-purple-500/10" },
  ];

  const pipelineCards = [
    { label: "Open in Pipeline", value: pipeline?.open ?? 0, sub: `₹${(pipeline?.openValue ?? 0).toLocaleString("en-IN")}`, icon: DollarSign, color: "text-blue-500 bg-blue-500/10" },
    { label: "Won (Pipeline)", value: pipeline?.won ?? 0, sub: `₹${(pipeline?.wonValue ?? 0).toLocaleString("en-IN")}`, icon: CircleCheck, color: "text-emerald-500 bg-emerald-500/10" },
    { label: "Lost (Pipeline)", value: pipeline?.lost ?? 0, sub: `₹${(pipeline?.lostValue ?? 0).toLocaleString("en-IN")}`, icon: TrendingDown, color: "text-red-500 bg-red-500/10" },
  ];

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">CRM Dashboard</h1>
        <p className="text-sm text-muted-foreground">Real, persisted metrics from leads, the lead pipeline and admissions</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {statCards.map((c) => (
          <Card key={c.label} className="bg-card border-white/10 shadow-lg">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-semibold">{c.label}</p>
                <p className="text-2xl font-bold text-white mt-1">{c.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{c.sub}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {pipelineCards.map((c) => (
          <Card key={c.label} className="bg-card border-white/10 shadow-lg">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground font-semibold">{c.label}</p>
                <p className="text-2xl font-bold text-white mt-1">{c.value}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{c.sub}</p>
              </div>
              <div className={`flex h-10 w-10 items-center justify-center rounded-full ${c.color}`}>
                <c.icon className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className="bg-card border-white/10 shadow-lg">
          <CardHeader className="border-b border-white/5 pb-3">
            <CardTitle className="text-sm font-semibold text-white flex items-center gap-2"><Activity className="h-4 w-4 text-blue-500" /> Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2">
            {t.dealPipelineByStage && Object.keys(t.dealPipelineByStage).length > 0 ? (
              Object.entries(t.dealPipelineByStage).map(([stage, count]) => (
                <div key={stage} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground text-xs">{stage}</span>
                  <Badge className="bg-white/10 text-white border-white/10">{count}</Badge>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No leads in the pipeline yet.</p>
            )}
            <div className="pt-2 flex items-center justify-between border-t border-white/5 text-sm">
              <span className="text-muted-foreground text-xs">Open / Won / Lost</span>
              <span className="text-white font-semibold text-xs">{t.dealsOpen} / {t.dealsWon} / {t.dealsLost}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-white/10 shadow-lg">
          <CardHeader className="border-b border-white/5 pb-3">
            <CardTitle className="text-sm font-semibold text-white flex items-center gap-2"><Users className="h-4 w-4 text-purple-500" /> Leads</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-sm">
            <Row k="Total leads" v={t.leads} />
            <Row k="Pipeline leads" v={t.pipeline} />
            <Row k="Converted" v={t.converted} />
            <Row k="Lost" v={t.lost} />
            <Row k="Conversion rate" v={`${t.conversionRate}%`} />
          </CardContent>
        </Card>

        <Card className="bg-card border-white/10 shadow-lg">
          <CardHeader className="border-b border-white/5 pb-3">
            <CardTitle className="text-sm font-semibold text-white flex items-center gap-2"><Wallet className="h-4 w-4 text-emerald-500" /> Finance</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-sm">
            <Row k="Collections today" v={`₹${t.collectionsToday.toLocaleString("en-IN")}`} />
            <Row k="Total collections" v={`₹${t.totalCollections.toLocaleString("en-IN")}`} />
            <Row k="Pending" v={`₹${t.totalCollectionPending.toLocaleString("en-IN")}`} />
            <Row k="Collection %" v={t.collectionPct} />
            <Row k="Revenue (completed)" v={`₹${t.revenue.toLocaleString("en-IN")}`} />
          </CardContent>
        </Card>

        <Card className="bg-card border-white/10 shadow-lg">
          <CardHeader className="border-b border-white/5 pb-3">
            <CardTitle className="text-sm font-semibold text-white flex items-center gap-2"><BarChart3 className="h-4 w-4 text-blue-500" /> Activity</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-sm">
            <Row k="Activities" v={t.activities} />
            <Row k="Calls" v={t.calls} />
            <Row k="Meetings" v={t.meetings} />
            <Row k="Students" v={t.students} />
            <Row k="Counselors" v={t.counselors} />
          </CardContent>
        </Card>

        <Card className="bg-card border-white/10 shadow-lg">
          <CardHeader className="border-b border-white/5 pb-3">
            <CardTitle className="text-sm font-semibold text-white flex items-center gap-2"><Percent className="h-4 w-4 text-amber-500" /> Workable</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-sm">
            <Row k="Workable leads" v={t.workableLeads} />
            <Row k="Workable %" v={t.workablePct} />
            <Row k="Avg admission fee" v={t.avgAdmissionFee != null ? `₹${t.avgAdmissionFee.toLocaleString("en-IN")}` : "—"} />
            <Row k="Payments" v={t.payments} />
          </CardContent>
        </Card>

        <Card className="bg-card border-white/10 shadow-lg">
          <CardHeader className="border-b border-white/5 pb-3">
            <CardTitle className="text-sm font-semibold text-white flex items-center gap-2"><TrendingUp className="h-4 w-4 text-lime-500" /> Lead Pipeline Stages</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 space-y-2 text-sm">
            {(pipeline?.byStage ?? []).map((s) => (
              <div key={s.stage} className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground text-xs">{s.stage}</span>
                <span className="text-white font-semibold text-xs">{s.count} · ₹{(s.value ?? 0).toLocaleString("en-IN")}</span>
              </div>
            ))}
            {(pipeline?.byStage ?? []).length === 0 && (
              <p className="text-xs text-muted-foreground">Lead Pipeline is empty — mark leads as Prospect to add them.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground text-xs">{k}</span>
      <span className="text-white font-semibold text-xs">{v}</span>
    </div>
  );
}