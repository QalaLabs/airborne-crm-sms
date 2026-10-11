"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { Activity, Clock, User } from "lucide-react";

interface ActivityItem {
  id: string;
  verb: string;
  objectType: string;
  objectId: string;
  occurredAt: string;
  actor?: { id: string; name: string; email: string; avatarUrl?: string | null } | null;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function groupLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return "Earlier this week";
  return d.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
}

export default function NotificationsPage() {
  const { data: items, isLoading, isError } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => apiFetch<ActivityItem[]>("/notifications"),
  });

  const grouped = React.useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    (items ?? []).forEach((n) => {
      const label = groupLabel(n.occurredAt);
      const arr = map.get(label) ?? [];
      arr.push(n);
      map.set(label, arr);
    });
    return Array.from(map.entries());
  }, [items]);

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="System Activity"
        description="Org-wide activity feed backed by the audit event store. Shows a running log of who performed which action across the platform."
      />
      <div className="glass-card rounded-2xl border border-white/10 overflow-hidden">
        <div className="flex items-center gap-2 px-5 py-4 border-b border-white/10">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-bold text-white">Latest activity</h3>
        </div>
        <div className="divide-y divide-white/5">
          {isLoading ? (
            <p className="text-xs text-muted-foreground px-5 py-8 text-center">Loading activity…</p>
          ) : isError || !items || items.length === 0 ? (
            <div className="px-5 py-10 text-center space-y-2">
              <Clock className="h-6 w-6 text-muted-foreground mx-auto" />
              <p className="text-sm font-medium text-white">No activity recorded yet</p>
              <p className="text-xs text-muted-foreground">Actions performed across modules will appear here as they happen.</p>
            </div>
          ) : (
            grouped.map(([label, list]) => (
              <div key={label}>
                <div className="px-5 pt-4 pb-2">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-primary">{label}</span>
                </div>
                {list.map((n) => (
                  <div key={n.id} className="flex items-start gap-3 px-5 py-3 hover:bg-white/[0.03] transition-colors">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <User className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded uppercase">{n.verb}</span>
                        <span className="text-[10px] font-medium text-white/80">{n.objectType}</span>
                        <span className="text-[10px] font-mono text-muted-foreground truncate">#{n.objectId}</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {n.actor?.name ?? "System"} performed {n.verb.toLowerCase()} on {n.objectType} {n.objectId}
                      </p>
                      <span className="text-[10px] text-muted-foreground/60 block mt-0.5">{formatTime(n.occurredAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
