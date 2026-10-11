"use client";

import { useQuery } from "@tanstack/react-query";
import { Workflow, CheckCircle2, XCircle, MinusCircle } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

interface InteraktLeadStatus {
  provider: string;
  eventName: string;
  sync: {
    status: string;
    contactSynced: boolean;
    eventSent: boolean;
    courseKey: string | null;
    leadSource: string | null;
    providerUserId: string | null;
    providerEventId: string | null;
    workflowRef: string | null;
    errorMessage: string | null;
    retryCount: number;
    lastAttemptAt: string | null;
    succeededAt: string | null;
  } | null;
  automations: { name: string; courseKey: string | null; workflowRef: string | null; isActive: boolean }[];
  recentMessages: {
    id: string;
    direction: string;
    status: string;
    templateName: string | null;
    externalId: string | null;
    createdAt: string;
    errorMsg: string | null;
  }[];
}

function Mark({ ok, label, detail }: { ok: boolean | null; label: string; detail?: string | null }) {
  const Icon = ok === true ? CheckCircle2 : ok === false ? XCircle : MinusCircle;
  const tone = ok === true ? "text-emerald-400" : ok === false ? "text-rose-400" : "text-muted-foreground";
  return (
    <li className={`flex gap-2 text-xs ${tone}`}>
      <Icon className="h-3.5 w-3.5 mt-0.5 shrink-0" />
      <span>
        <span className="font-bold">{label}</span>
        {detail ? <span className="text-muted-foreground font-semibold"> — {detail}</span> : null}
      </span>
    </li>
  );
}

export function InteraktSyncCard({ leadId }: { leadId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["lead", leadId, "interakt"],
    queryFn: () => apiFetch<InteraktLeadStatus>(`/leads/${leadId}/interakt`),
  });

  return (
    <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
      <h3 className="text-sm font-bold uppercase tracking-wider text-white border-b border-white/10 pb-3 flex items-center gap-2">
        <Workflow className="h-4 w-4 text-primary" /> Interakt
      </h3>
      {isLoading || !data ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <>
          <ul className="space-y-2">
            <Mark
              ok={data.sync ? data.sync.contactSynced : null}
              label="Contact synced"
              detail={data.sync?.providerUserId ?? undefined}
            />
            <Mark
              ok={data.sync ? data.sync.eventSent : null}
              label={`${data.eventName} event sent`}
              detail={data.sync?.providerEventId ?? data.sync?.courseKey ?? undefined}
            />
            <Mark
              ok={data.sync?.workflowRef ? true : null}
              label="Workflow reference"
              detail={data.sync?.workflowRef ?? "mapped in WhatsApp → Automations / Interakt dashboard"}
            />
            <Mark
              ok={
                data.recentMessages.some((m) => m.direction === "OUT" && m.status === "DELIVERED")
                  ? true
                  : data.recentMessages.some((m) => m.direction === "OUT" && m.status === "FAILED")
                    ? false
                    : data.recentMessages.some((m) => m.direction === "OUT" && (m.status === "SENT" || m.status === "READ"))
                      ? true
                      : null
              }
              label="WhatsApp delivery"
              detail={
                data.recentMessages.find((m) => m.direction === "OUT")?.status ??
                "wait for Interakt webhook"
              }
            />
          </ul>
          {data.sync?.errorMessage ? (
            <p className="text-[11px] text-rose-400 font-semibold break-words">
              Reason: {data.sync.errorMessage}
            </p>
          ) : null}
          {data.sync?.lastAttemptAt ? (
            <p className="text-[10px] text-muted-foreground font-semibold">
              Last attempt {formatDateTime(data.sync.lastAttemptAt)}
              {data.sync.retryCount ? ` · retries ${data.sync.retryCount}` : ""}
            </p>
          ) : (
            <p className="text-[11px] text-muted-foreground">No Interakt attempt recorded yet.</p>
          )}
        </>
      )}
    </div>
  );
}
