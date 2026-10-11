"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { MePayload } from "@/components/portal/types";
import { ProgressRing } from "@/components/portal/progress-ring";
import { CardSkeleton, TextSkeleton } from "@/components/portal/portal-skeleton";
import {
  PortalPageHeader,
  GlassCard,
  SectionLabel,
  MotionSection,
  Stagger,
  StatTile,
  ProgressBar,
} from "@/components/portal/portal-ui";
import {
  BookOpen,
  Award,
  CheckCircle2,
  ClipboardCheck,
  BarChart3,
  ChevronRight,
  TrendingUp,
  FileText,
} from "lucide-react";

function ProgressSkeleton() {
  return (
    <div className="space-y-8" aria-busy="true" aria-label="Loading progress…">
      <div className="space-y-2">
        <TextSkeleton className="h-3 w-20" />
        <TextSkeleton className="h-8 w-48" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <CardSkeleton key={i} className="h-32" />)}
      </div>
      <CardSkeleton className="h-48" />
    </div>
  );
}

export default function PortalProgressPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  if (isLoading) return <ProgressSkeleton />;

  if (isError || !data) {
    return (
      <GlassCard className="border-red-500/30 bg-red-500/10">
        <p className="font-semibold text-red-200">Unable to load progress data</p>
        <p className="mt-1 text-sm text-red-200/60">Please try refreshing the page.</p>
      </GlassCard>
    );
  }

  const passedCount = data.assessments.filter((a) => a.status === "PASS").length;
  const totalAssessments = data.assessments.length;
  const presentCount = data.attendance.filter(
    (r) => r.status === "PRESENT" || r.status === "LATE",
  ).length;

  const activityDates = new Set(
    data.quizAttempts.map((qa) => new Date(qa.createdAt).toDateString()),
  );
  let streak = 0;
  const today = new Date();
  for (let i = 0; i < 60; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    if (activityDates.has(d.toDateString())) {
      streak++;
    } else if (i > 0) {
      break;
    }
  }

  const upcomingAssessments = data.assessments.filter(
    (a) => a.status !== "PASS" && a.attempts < a.module.maxAttempts,
  );

  return (
    <div className="space-y-8">
      <MotionSection>
        <PortalPageHeader
          eyebrow="Progress Report"
          title={`${data.student.firstName}'s Progress`}
          description="A snapshot of your learning journey at Airborne Aviation"
        />
      </MotionSection>

      <MotionSection delay={0.05}>
        <Stagger className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Progress statistics">
          <StatTile
            icon={BookOpen}
            label="Courses enrolled"
            value={data.enrollments.length}
            sub={`${data.enrollments.filter((e) => e.percentComplete === 100).length} completed`}
          />
          <StatTile
            icon={CheckCircle2}
            label="Topics completed"
            value={data.completedTopics}
          />
          <StatTile
            icon={Award}
            label="Assessments passed"
            value={passedCount}
            sub={totalAssessments > 0 ? `${totalAssessments} total · ${Math.round((passedCount / totalAssessments) * 100)}% pass rate` : undefined}
            accent
          />
          <StatTile
            icon={ClipboardCheck}
            label="Attendance"
            value={`${data.attendancePercent}%`}
            sub={`${presentCount} of ${data.attendance.length} sessions`}
          />
          <StatTile
            icon={Award}
            label="Certificates earned"
            value={data.certificates.length}
            accent
          />
          <StatTile
            icon={TrendingUp}
            label="Activity streak"
            value={streak > 0 ? `${streak} day${streak !== 1 ? "s" : ""}` : "-"}
            sub={streak > 0 ? "Consecutive days with activity" : "Complete an assessment to start your streak"}
          />
        </Stagger>
      </MotionSection>

      {data.enrollments.length > 0 && (
        <MotionSection delay={0.1} className="space-y-4" aria-labelledby="course-progress-heading">
          <SectionLabel icon={BarChart3}>Course Progress</SectionLabel>
          <Stagger className="space-y-3">
            {data.enrollments.map((e) => {
              const pct = e.percentComplete;
              return (
                <Link
                  key={e.id}
                  href={`/portal/courses/${e.courseId}`}
                  className="ab-glass-soft flex items-center gap-4 px-4 py-4 transition-colors hover:border-white/20"
                >
                  <ProgressRing value={pct} size={52} strokeWidth={4.5} label={`${pct}%`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-white">{e.course.title}</p>
                    <ProgressBar value={pct} className="mt-2" />
                    <p className="mt-1 text-xs text-white/40">
                      {pct === 100 ? "Course complete" : pct === 0 ? "Not started" : `${pct}% complete`}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-white/25" aria-hidden="true" />
                </Link>
              );
            })}
          </Stagger>
        </MotionSection>
      )}

      {upcomingAssessments.length > 0 && (
        <MotionSection delay={0.15} className="space-y-3" aria-labelledby="pending-heading">
          <SectionLabel icon={FileText} href="/portal/assessments">
            Pending Assessments
          </SectionLabel>
          <Stagger className="grid gap-3 sm:grid-cols-2">
            {upcomingAssessments.map((a) => (
              <GlassCard key={a.moduleId} soft className="!p-4">
                <p className="font-medium text-white">{a.module.title}</p>
                <p className="mt-1 text-xs text-white/50">
                  Pass ≥ {a.module.passPercent}%
                  &nbsp;·&nbsp; {a.module.maxAttempts - a.attempts} attempt
                  {a.module.maxAttempts - a.attempts !== 1 ? "s" : ""} remaining
                </p>
                {a.attempts > 0 && (
                  <p className="mt-0.5 text-xs text-[var(--ab-gold)]/80">Last score: {a.score}%</p>
                )}
              </GlassCard>
            ))}
          </Stagger>
        </MotionSection>
      )}

      {data.attendancePercent < 75 && data.attendance.length > 0 && (
        <MotionSection delay={0.2}>
          <GlassCard soft className="border-amber-500/30 bg-amber-500/[0.07]">
            <p className="font-semibold text-amber-300">Attendance below 75%</p>
            <p className="mt-1 text-sm text-amber-300/70">
              Your current attendance is {data.attendancePercent}%. Please attend sessions regularly to
              remain eligible for assessments and certification.
            </p>
          </GlassCard>
        </MotionSection>
      )}

      {data.certificates.length > 0 && (
        <MotionSection delay={0.25} className="space-y-3" aria-labelledby="certs-progress-heading">
          <SectionLabel icon={Award} href="/portal/certificates">
            Certificates Earned
          </SectionLabel>
          <Stagger className="grid gap-3 sm:grid-cols-2">
            {data.certificates.map((c) => (
              <GlassCard key={c.id} soft className="!p-4 border-emerald-500/25 bg-emerald-500/[0.06]">
                <div className="flex items-center gap-3">
                  <Award className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-white">{c.title}</p>
                    <p className="text-xs text-white/45">{c.course?.title}</p>
                    {c.issuedAt && (
                      <p className="mt-0.5 text-[10px] text-white/30">
                        Issued{" "}
                        {new Date(c.issuedAt).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </p>
                    )}
                  </div>
                </div>
              </GlassCard>
            ))}
          </Stagger>
          <Link
            href="/portal/certificates"
            className="inline-flex items-center gap-1 text-xs text-white/50 hover:text-white transition-colors"
          >
            View all certificates <ChevronRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </MotionSection>
      )}
    </div>
  );
}
