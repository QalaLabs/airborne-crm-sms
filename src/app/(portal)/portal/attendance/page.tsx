"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { ClipboardCheck, BarChart3 } from "lucide-react";
import {
  PortalPageHeader,
  GlassCard,
  SectionLabel,
  EmptyState,
  MotionSection,
  Stagger,
  StatTile,
  ProgressBar,
  StatusPill,
} from "@/components/portal/portal-ui";
import { CardSkeleton } from "@/components/portal/portal-skeleton";

interface MePayload {
  attendance: Array<{
    id: string;
    status: string;
    markedAt?: string;
    session?: { title: string; heldAt: string; courseId: string };
  }>;
  attendancePercent: number;
}

interface AttendanceBreakdown {
  overallPercent: number;
  overallTotal: number;
  overallPresent: number;
  monthly: Array<{ month: string; percent: number; total: number; present: number }>;
  bySubject: Array<{ subject: string; percent: number; total: number; present: number }>;
}

const STATUS_TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  PRESENT: "success",
  LATE: "warning",
  ABSENT: "danger",
  EXCUSED: "neutral",
};

function formatMonth(key: string) {
  const [year, month] = key.split("-");
  const d = new Date(Number(year), Number(month) - 1, 1);
  return d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
}

export default function PortalAttendancePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  const { data: breakdown, isLoading: loadingBreakdown } = useQuery({
    queryKey: ["lms-attendance-breakdown"],
    queryFn: () => apiFetch<AttendanceBreakdown>("/lms/me/attendance-breakdown"),
  });

  const records = data?.attendance ?? [];
  const percent = breakdown?.overallPercent ?? data?.attendancePercent ?? 0;
  const present = breakdown?.overallPresent ?? records.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
  const total = breakdown?.overallTotal ?? records.length;

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <CardSkeleton className="h-20" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => <CardSkeleton key={i} className="h-24" />)}
        </div>
        <CardSkeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <MotionSection>
        <PortalPageHeader
          eyebrow="Flight log"
          title="Attendance"
          description="Your lecture attendance history and breakdown"
        />
      </MotionSection>

      <MotionSection delay={0.05}>
        <Stagger className="grid gap-3 sm:grid-cols-3">
          <StatTile icon={ClipboardCheck} label="Overall attendance" value={`${percent}%`} accent={percent >= 75} />
          <StatTile icon={ClipboardCheck} label="Sessions attended" value={present} />
          <StatTile icon={ClipboardCheck} label="Total sessions" value={total} />
        </Stagger>
      </MotionSection>

      <MotionSection delay={0.1}>
        <GlassCard soft className="space-y-3">
          <ProgressBar value={percent} />
          {percent < 75 && (
            <p className="text-xs text-[var(--ab-gold)]">
              Your attendance is below 75%. Please attend sessions regularly to remain eligible for assessments.
            </p>
          )}
        </GlassCard>
      </MotionSection>

      {!loadingBreakdown && breakdown && (
        <MotionSection delay={0.15}>
          <div className="grid gap-4 sm:grid-cols-2">
            <GlassCard soft className="space-y-3">
              <SectionLabel icon={BarChart3}>Monthly breakdown</SectionLabel>
              {breakdown.monthly.length === 0 ? (
                <p className="text-xs text-white/40">No monthly data yet.</p>
              ) : (
                <div className="space-y-3">
                  {breakdown.monthly.map((m) => (
                    <div key={m.month} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 text-xs text-white/50">{formatMonth(m.month)}</span>
                      <ProgressBar value={m.percent} className="flex-1" />
                      <span className="w-16 shrink-0 text-right text-xs text-white/60">
                        {m.percent}% ({m.present}/{m.total})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>

            <GlassCard soft className="space-y-3">
              <SectionLabel icon={BarChart3}>By subject</SectionLabel>
              {breakdown.bySubject.length === 0 ? (
                <p className="text-xs text-white/40">No subject data yet.</p>
              ) : (
                <div className="space-y-3">
                  {breakdown.bySubject.map((s) => (
                    <div key={s.subject} className="flex items-center gap-3">
                      <span className="w-24 shrink-0 truncate text-xs text-white/50">{s.subject}</span>
                      <ProgressBar value={s.percent} className="flex-1" />
                      <span className="w-12 shrink-0 text-right text-xs text-white/60">{s.percent}%</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          </div>
        </MotionSection>
      )}

      <MotionSection delay={0.2}>
        {records.length === 0 ? (
          <EmptyState
            icon={ClipboardCheck}
            title="No attendance sessions logged yet"
            description="Your attendance records will appear here after sessions are held."
          />
        ) : (
          <GlassCard soft className="!p-0 overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wide text-white/40">
                <tr>
                  <th className="px-4 py-3" scope="col">Session</th>
                  <th className="px-4 py-3" scope="col">Date</th>
                  <th className="px-4 py-3" scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.map((a) => (
                  <tr key={a.id} className="border-t border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white/80">{a.session?.title ?? "-"}</td>
                    <td className="px-4 py-3 text-xs text-white/50">
                      {a.session?.heldAt
                        ? new Date(a.session.heldAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusPill tone={STATUS_TONE[a.status] ?? "neutral"}>{a.status}</StatusPill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        )}
      </MotionSection>
    </div>
  );
}
