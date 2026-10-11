"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, PhoneCall, UserPlus, CalendarClock, AlertCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { formatInIST } from "@/lib/time/ist";
import { istWeekContaining, parseISTWeek, shiftISTWeek } from "@/lib/leads/ist-week";
import { leadSourceLabel } from "@/lib/leads/lead-source";

interface CallLead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  source: string;
  courseInterest: string | null;
  createdAt: string;
  nextFollowUp: string | null;
  lastActivityAt: string | null;
  counselor: { id: string; name: string } | null;
}

interface AgentCallingWeek {
  week: { key: string; endKey: string; start: string; end: string; label: string };
  newLeads: CallLead[];
  newLeadsTotal: number;
  followUps: CallLead[];
  followUpsTotal: number;
}

function CallList({
  leads,
  total,
  dateField,
  dateLabel,
  empty,
  testId,
}: {
  leads: CallLead[];
  total: number;
  dateField: "createdAt" | "nextFollowUp";
  dateLabel: string;
  empty: string;
  testId: string;
}) {
  if (leads.length === 0) {
    return <p className="text-xs text-muted-foreground">{empty}</p>;
  }
  return (
    <div className="overflow-x-auto" data-testid={testId}>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-white/10 text-left text-muted-foreground">
            <th className="py-2 pr-3 font-semibold">Lead</th>
            <th className="py-2 pr-3 font-semibold">Phone</th>
            <th className="py-2 pr-3 font-semibold">Status</th>
            <th className="py-2 pr-3 font-semibold">Source</th>
            <th className="py-2 pr-3 font-semibold">{dateLabel}</th>
            <th className="py-2 font-semibold">Counselor</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead.id} className="border-b border-white/5" data-testid="agent-calling-row">
              <td className="py-2 pr-3">
                <Link href={`/leads/${lead.id}`} className="font-semibold text-white hover:text-primary">
                  {lead.name}
                </Link>
                {lead.courseInterest && <p className="text-[10px] text-muted-foreground">{lead.courseInterest}</p>}
              </td>
              <td className="py-2 pr-3 font-mono">
                <a href={`tel:${lead.phone}`} className="hover:text-primary">{lead.phone}</a>
              </td>
              <td className="py-2 pr-3"><StatusBadge status={lead.status} domain="lead" /></td>
              <td className="py-2 pr-3 text-muted-foreground">{leadSourceLabel(lead.source)}</td>
              <td className="py-2 pr-3 text-muted-foreground">{formatInIST(lead[dateField])}</td>
              <td className="py-2 text-muted-foreground">{lead.counselor?.name ?? "Unassigned"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total > leads.length && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Showing the latest {leads.length} of {total}. Use All Leads filters for the full list.
        </p>
      )}
    </div>
  );
}

export default function AgentCallingPage() {
  const currentKey = React.useMemo(() => istWeekContaining(new Date()).key, []);
  const [weekKey, setWeekKey] = React.useState(currentKey);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["agent-calling", weekKey],
    queryFn: () => apiFetch<AgentCallingWeek>(`/leads/agent-calling?week=${weekKey}`),
    placeholderData: keepPreviousData,
  });

  const go = (delta: number) => {
    const week = parseISTWeek(weekKey);
    if (week) setWeekKey(shiftISTWeek(week, delta).key);
  };

  const isCurrent = weekKey === currentKey;

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Agent Calling"
        description="New leads and scheduled follow-ups to call, one IST week (Monday to Sunday) at a time, newest first."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 glass-card rounded-2xl p-4 border border-white/10">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs border-white/10" onClick={() => go(-1)} aria-label="Previous week">
            <ChevronLeft className="h-4 w-4 mr-1" /> Previous week
          </Button>
          <Button
            variant={isCurrent ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs border-white/10"
            onClick={() => setWeekKey(currentKey)}
            disabled={isCurrent}
          >
            This week
          </Button>
          <Button variant="outline" size="sm" className="h-8 text-xs border-white/10" onClick={() => go(1)} aria-label="Next week">
            Next week <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
        <div className="text-right">
          <p className="text-sm font-bold text-white" data-testid="agent-calling-week-label">
            {data?.week.label ?? parseISTWeek(weekKey)?.label}
          </p>
          <p className="text-[10px] text-muted-foreground">
            IST · {isCurrent ? "Current week" : weekKey < currentKey ? "Past week" : "Upcoming week"}
            {isFetching && !isLoading ? " · refreshing…" : ""}
          </p>
        </div>
      </div>

      {isError && (
        <div className="flex items-center justify-between rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4">
          <span className="flex items-center gap-2 text-xs text-rose-300">
            <AlertCircle className="h-4 w-4" />
            {error instanceof Error ? error.message : "Failed to load calls"}
          </span>
          <Button size="sm" variant="outline" className="h-8 text-xs border-white/10" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading calls…</p>
      ) : data ? (
        <div className="grid gap-6">
          <Card className="bg-card border-white/10 shadow-lg">
            <CardHeader className="border-b border-white/5 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-white">
                <UserPlus className="h-4 w-4 text-primary" /> New leads
                <span className="text-xs font-normal text-muted-foreground" data-testid="agent-calling-new-count">
                  ({data.newLeadsTotal})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <CallList
                leads={data.newLeads}
                total={data.newLeadsTotal}
                dateField="createdAt"
                dateLabel="Created (IST)"
                empty="No new leads created this week."
                testId="agent-calling-new"
              />
            </CardContent>
          </Card>

          <Card className="bg-card border-white/10 shadow-lg">
            <CardHeader className="border-b border-white/5 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-white">
                <CalendarClock className="h-4 w-4 text-amber-400" /> Follow-ups
                <span className="text-xs font-normal text-muted-foreground" data-testid="agent-calling-followup-count">
                  ({data.followUpsTotal})
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <CallList
                leads={data.followUps}
                total={data.followUpsTotal}
                dateField="nextFollowUp"
                dateLabel="Follow-up (IST)"
                empty="No follow-ups scheduled this week."
                testId="agent-calling-followups"
              />
            </CardContent>
          </Card>
        </div>
      ) : null}

      <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <PhoneCall className="h-3 w-3" /> Counselors only see leads assigned to them.
      </p>
    </div>
  );
}
