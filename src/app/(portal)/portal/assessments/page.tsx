"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { MePayload } from "@/components/portal/types";
import {
  PortalPageHeader,
  GlassCard,
  EmptyState,
  MotionSection,
  StatusPill,
} from "@/components/portal/portal-ui";
import { TextSkeleton, CardSkeleton } from "@/components/portal/portal-skeleton";
import { FileText, ChevronRight, CheckCircle2, XCircle, Clock } from "lucide-react";

export default function PortalAssessmentsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <TextSkeleton className="h-8 w-48" />
        <div className="grid gap-3">{[0, 1, 2].map((i) => <CardSkeleton key={i} className="h-24" />)}</div>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <EmptyState
        icon={FileText}
        title="Unable to load assessments"
        description="Please refresh and try again."
      />
    );
  }

  const items = data.assessments;
  const passed = items.filter((a) => a.status === "PASS").length;

  return (
    <MotionSection>
      <PortalPageHeader
        eyebrow="Flight checks"
        title="Assessments"
        description="Module quizzes, scores, and remaining attempts - your checkride readiness at a glance."
        action={
          <StatusPill tone="brand">
            {passed}/{items.length} passed
          </StatusPill>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No assessments yet"
          description="Complete module quizzes from your course player to see results here."
          action={
            <Link href="/portal/courses" className="ab-btn ab-btn-primary px-4 py-2">
              Open courses
            </Link>
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((a) => {
            const tone =
              a.status === "PASS" ? "success" : a.status === "FAIL" ? "danger" : "warning";
            const Icon =
              a.status === "PASS" ? CheckCircle2 : a.status === "FAIL" ? XCircle : Clock;
            return (
              <GlassCard key={a.moduleId} soft className="!p-4">
                <div className="flex items-center gap-4">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/5">
                    <Icon className="h-5 w-5 text-[var(--ab-red)]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-semibold text-white">{a.module.title}</p>
                      <StatusPill tone={tone}>{a.status}</StatusPill>
                    </div>
                    <p className="mt-1 text-xs text-white/45">
                      Score {a.score}% · Pass mark {a.module.passPercent}% · Attempts {a.attempts}/
                      {a.module.maxAttempts}
                    </p>
                  </div>
                  <Link
                    href={`/portal/courses/${a.module.stage.courseId}`}
                    className="ab-btn ab-btn-ghost px-3 py-2"
                    aria-label={`Open course for ${a.module.title}`}
                  >
                    Open
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </div>
              </GlassCard>
            );
          })}
        </div>
      )}
    </MotionSection>
  );
}
