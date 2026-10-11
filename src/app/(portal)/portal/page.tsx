"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  BookOpen,
  Award,
  ClipboardCheck,
  Megaphone,
  Sparkles,
  ChevronRight,
  BarChart3,
  FileText,
  Clock,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import type { MePayload } from "@/components/portal/types";
import { ProgressRing } from "@/components/portal/progress-ring";
import { DashboardSkeleton } from "@/components/portal/portal-skeleton";
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
import { cn } from "@/lib/utils";

// ─── Continue Learning Card ──────────────────────────────────────────────────

function ContinueLearningCard({ data }: { data: MePayload }) {
  const cl = data.continueLearning;
  const firstEnrollment = data.enrollments[0];

  if (!cl && !firstEnrollment) {
    return (
      <EmptyState
        icon={BookOpen}
        title="No courses enrolled yet"
        description="Contact your instructor to get started on your aviation journey."
      />
    );
  }

  const courseId = cl?.courseId ?? firstEnrollment?.courseId ?? "";
  const courseTitle = cl?.courseTitle ?? firstEnrollment?.course.title ?? "Course";
  const pct = cl?.percentComplete ?? firstEnrollment?.percentComplete ?? 0;

  return (
    <Link
      href={`/portal/courses/${courseId}`}
      className="group block"
      aria-label={`Continue ${courseTitle} - ${pct}% complete`}
    >
      <GlassCard hero className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="relative shrink-0">
          <ProgressRing value={pct} size={72} strokeWidth={5} label={`${pct}%`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="ab-eyebrow">Continue Learning</p>
          <p className="mt-1 truncate ab-display text-xl text-white sm:text-2xl">{courseTitle}</p>
          <p className="mt-1 text-xs text-white/50">
            {pct === 0 ? "Start your first topic" : pct === 100 ? "Course complete - well done!" : `${pct}% complete`}
          </p>
          <ProgressBar value={pct} className="mt-3 max-w-xs" />
        </div>
        <span className="ab-btn ab-btn-primary shrink-0 px-4 py-2.5 group-hover:shadow-lg">
          Resume
          <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </GlassCard>
    </Link>
  );
}

// ─── Upcoming Lectures ─────────────────────────────────────────────────────

interface TimetableSlot {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  room?: string | null;
  onlineUrl?: string | null;
  batch: { name: string };
  course?: { title: string } | null;
  teacher?: { name: string } | null;
}

function UpcomingLectures() {
  const { data: slots, isLoading } = useQuery({
    queryKey: ["lms-me-timetable"],
    queryFn: () => apiFetch<TimetableSlot[]>("/lms/me/timetable"),
  });

  if (isLoading) return null;
  if (!slots || slots.length === 0) return null;

  return (
    <MotionSection delay={0.15} className="space-y-3" aria-labelledby="lectures-heading">
      <SectionLabel icon={Clock}>Upcoming Lectures</SectionLabel>
      <Stagger className="grid gap-3 sm:grid-cols-2">
        {slots.slice(0, 4).map((slot) => {
          const start = new Date(slot.startsAt);
          return (
            <GlassCard key={slot.id} soft className="!p-4">
              <p className="truncate text-sm font-medium text-white">{slot.title}</p>
              <p className="mt-0.5 text-[11px] text-white/50">
                {slot.batch.name}{slot.course?.title ? ` · ${slot.course.title}` : ""}
              </p>
              <p className="mt-1.5 text-[11px] text-white/40">
                {start.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
                {" · "}
                {start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                {slot.room ? ` · ${slot.room}` : ""}
              </p>
              {slot.onlineUrl && (
                <a
                  href={slot.onlineUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-2 inline-block text-[11px] font-semibold text-[var(--ab-red)] hover:underline"
                >
                  Join online →
                </a>
              )}
            </GlassCard>
          );
        })}
      </Stagger>
    </MotionSection>
  );
}

// ─── Upcoming Assessments ────────────────────────────────────────────────────

function UpcomingAssessments({ data }: { data: MePayload }) {
  const upcoming = data.assessments.filter(
    (a) => a.status !== "PASS" && a.attempts < a.module.maxAttempts,
  );

  if (upcoming.length === 0) return null;

  return (
    <MotionSection delay={0.2} className="space-y-3" aria-labelledby="upcoming-heading">
      <SectionLabel icon={FileText} href="/portal/assessments">
        Upcoming Assessments
      </SectionLabel>
      <Stagger className="grid gap-3 sm:grid-cols-2">
        {upcoming.slice(0, 4).map((a) => {
          const attemptsLeft = a.module.maxAttempts - a.attempts;
          return (
            <GlassCard key={a.moduleId} soft className="!p-4">
              <div className="flex items-start gap-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ab-gold)]" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{a.module.title}</p>
                  <p className="mt-0.5 text-[11px] text-white/50">
                    Pass ≥ {a.module.passPercent}% · {attemptsLeft} attempt{attemptsLeft !== 1 ? "s" : ""} left
                  </p>
                  {a.attempts > 0 && (
                    <p className="mt-0.5 text-[11px] text-[var(--ab-gold)]/80">Last score: {a.score}%</p>
                  )}
                </div>
              </div>
            </GlassCard>
          );
        })}
      </Stagger>
    </MotionSection>
  );
}

// ─── Recent Activity ─────────────────────────────────────────────────────────

function RecentActivity({ data }: { data: MePayload }) {
  type ActivityItem = {
    id: string;
    type: "progress" | "quiz" | "attendance";
    label: string;
    sub: string;
    date: string;
    pass?: boolean;
  };

  const items: ActivityItem[] = [];

  data.quizAttempts.slice(0, 3).forEach((qa) => {
    items.push({
      id: `qa-${qa.moduleId}-${qa.createdAt}`,
      type: "quiz",
      label: "Assessment attempt",
      sub: `Score: ${qa.score}% · ${qa.passed ? "Passed" : "Not passed"}`,
      date: qa.createdAt,
      pass: qa.passed,
    });
  });

  data.attendance.slice(0, 3).forEach((att) => {
    items.push({
      id: att.id,
      type: "attendance",
      label: att.session?.title ?? "Session attended",
      sub: att.status,
      date: att.markedAt ?? att.session?.heldAt ?? "",
      pass: att.status === "PRESENT" || att.status === "LATE",
    });
  });

  items.sort((a, b) => (b.date > a.date ? 1 : -1));
  const recent = items.slice(0, 6);

  if (recent.length === 0) return null;

  const iconMap = {
    progress: <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />,
    quiz: <FileText className="h-4 w-4 text-[var(--ab-red)]" aria-hidden="true" />,
    attendance: <ClipboardCheck className="h-4 w-4 text-blue-400" aria-hidden="true" />,
  };

  return (
    <MotionSection delay={0.35} className="space-y-3" aria-labelledby="activity-heading">
      <SectionLabel icon={TrendingUp}>Recent Activity</SectionLabel>
      <GlassCard soft className="!p-0 overflow-hidden">
        {recent.map((item, i) => (
          <div
            key={item.id}
            className={cn(
              "flex items-center gap-3 px-4 py-3 text-sm",
              i !== 0 && "border-t border-white/5",
            )}
          >
            <div className="shrink-0">{iconMap[item.type]}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-white/80">{item.label}</p>
              <p className="text-[11px] text-white/40">{item.sub}</p>
            </div>
            {item.date && (
              <p className="shrink-0 text-[10px] text-white/30">
                {new Date(item.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
              </p>
            )}
          </div>
        ))}
      </GlassCard>
    </MotionSection>
  );
}

// ─── My Courses List ─────────────────────────────────────────────────────────

function MyCoursesList({ data }: { data: MePayload }) {
  return (
    <MotionSection delay={0.4} className="space-y-3" aria-labelledby="courses-heading">
      <SectionLabel icon={BookOpen} href="/portal/courses">
        My Courses
      </SectionLabel>
      {data.enrollments.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses enrolled"
          description="Contact your instructor to get enrolled in a course."
        />
      ) : (
        <Stagger className="grid gap-2">
          {data.enrollments.slice(0, 4).map((e) => (
            <Link
              key={e.id}
              href={`/portal/courses/${e.courseId}`}
              className="ab-glass-soft flex items-center gap-3 px-4 py-3 transition-colors hover:border-white/20"
            >
              <ProgressRing value={e.percentComplete} size={36} strokeWidth={3.5} label={`${e.percentComplete}%`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white/90">{e.course.title}</p>
                <ProgressBar value={e.percentComplete} className="mt-2 max-w-[200px]" />
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-white/25" aria-hidden="true" />
            </Link>
          ))}
        </Stagger>
      )}
    </MotionSection>
  );
}

// ─── Announcements ──────────────────────────────────────────────────────────

function AnnouncementsSection({ data }: { data: MePayload }) {
  if (data.announcements.length === 0) return null;

  return (
    <MotionSection delay={0.25} className="space-y-3" aria-labelledby="ann-heading">
      <SectionLabel icon={Megaphone} href="/portal/announcements">
        Announcements
      </SectionLabel>
      <Stagger className="space-y-2">
        {data.announcements.map((a) => (
          <GlassCard key={a.id} soft className="!p-4">
            <p className="font-medium text-white">{a.title}</p>
            <p className="mt-1 line-clamp-2 text-sm text-white/60">{a.body}</p>
            {a.publishedAt && (
              <p className="mt-1.5 text-[10px] text-white/30">
                {new Date(a.publishedAt).toLocaleDateString("en-IN", {
                  day: "numeric", month: "short", year: "numeric",
                })}
              </p>
            )}
          </GlassCard>
        ))}
      </Stagger>
    </MotionSection>
  );
}

// ─── Certificates Strip ──────────────────────────────────────────────────────

function CertificatesStrip({ data }: { data: MePayload }) {
  if (data.certificates.length === 0) return null;

  return (
    <MotionSection delay={0.3} className="space-y-3" aria-labelledby="certs-heading">
      <SectionLabel icon={Award} href="/portal/certificates">
        Certificates Earned
      </SectionLabel>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {data.certificates.slice(0, 4).map((c) => (
          <GlassCard
            key={c.id}
            soft
            className="flex shrink-0 items-center gap-2.5 !p-4 border-emerald-500/25 bg-emerald-500/[0.06]"
          >
            <Award className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden="true" />
            <div>
              <p className="text-sm font-medium text-white">{c.title}</p>
              <p className="text-[10px] text-white/40 mt-0.5">{c.course?.title}</p>
            </div>
          </GlassCard>
        ))}
      </div>
    </MotionSection>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────────────────────

export default function PortalDashboardPage() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  if (isLoading) return <DashboardSkeleton />;

  if (isError) {
    return (
      <GlassCard className="border-red-500/30 bg-red-500/10">
        <p className="font-semibold text-red-200">Could not load portal data</p>
        <p className="mt-1 text-sm text-red-200/70">{(error as Error).message}</p>
        <p className="mt-2 text-xs text-white/50">
          Staff must provision portal access (link CRM Student → User) before this dashboard loads.
        </p>
        <button
          type="button"
          className="ab-btn ab-btn-ghost mt-4 px-4 py-2"
          onClick={() => void refetch()}
        >
          Retry
        </button>
      </GlassCard>
    );
  }

  if (!data) return null;

  const passedCount = data.assessments.filter((a) => a.status === "PASS").length;
  const hasActivity = data.quizAttempts.length > 0 || data.attendance.length > 0;

  return (
    <div className="space-y-8">
      <MotionSection>
        <PortalPageHeader
          eyebrow="Welcome back"
          title={`${data.student.firstName} ${data.student.lastName}`}
          description={
            <>
              Student ID: <span className="font-mono text-white/60">{data.student.studentCode}</span>
            </>
          }
        />
      </MotionSection>

      <MotionSection delay={0.05}>
        <Stagger
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
          aria-label="Key statistics"
        >
          <StatTile
            label="Enrolled courses"
            value={data.enrollments.length}
            icon={BookOpen}
          />
          <StatTile
            label="Topics completed"
            value={data.completedTopics}
            icon={CheckCircle2}
          />
          <StatTile
            label="Assessments passed"
            value={passedCount}
            icon={Award}
            accent
          />
          <div className="ab-glass-soft flex items-center gap-4 p-4 transition-colors hover:border-white/20">
            <ProgressRing
              value={data.attendancePercent}
              size={56}
              strokeWidth={4.5}
              label={`${data.attendancePercent}%`}
              color={
                data.attendancePercent >= 75
                  ? "#34d399"
                  : data.attendancePercent >= 50
                    ? "#f59e0b"
                    : "#c8102e"
              }
            />
            <div>
              <p className="ab-display text-lg text-white">Attendance</p>
              <p className="mt-0.5 text-xs text-white/50">
                {data.attendance.length} session{data.attendance.length !== 1 ? "s" : ""} logged
              </p>
              {data.attendancePercent < 75 && data.attendance.length > 0 && (
                <StatusPill tone="warning">Below 75%</StatusPill>
              )}
            </div>
          </div>
        </Stagger>
      </MotionSection>

      <MotionSection delay={0.1} aria-labelledby="cl-heading">
        <SectionLabel icon={Clock}>Resume Where You Left Off</SectionLabel>
        <ContinueLearningCard data={data} />
      </MotionSection>

      <UpcomingLectures />
      <UpcomingAssessments data={data} />

      <MotionSection delay={0.22}>
        <Stagger className="flex flex-col gap-3 sm:flex-row">
          <Link
            href="/portal/progress"
            className="ab-glass-soft flex flex-1 items-center gap-2 px-4 py-3 text-sm text-white/70 transition-colors hover:border-white/20 hover:text-white"
          >
            <BarChart3 className="h-4 w-4 text-[var(--ab-red)]" aria-hidden="true" />
            View full progress report
            <ChevronRight className="ml-auto h-4 w-4 text-white/30" aria-hidden="true" />
          </Link>
          <Link
            href="/portal/assistant"
            className="ab-glass-soft flex flex-1 items-center gap-2 border-[rgba(200,16,46,0.25)] bg-[rgba(200,16,46,0.06)] px-4 py-3 text-sm text-white/70 transition-colors hover:border-[rgba(200,16,46,0.4)] hover:text-white"
          >
            <Sparkles className="h-4 w-4 text-[var(--ab-red)]" aria-hidden="true" />
            AI Study Assistant
            <ChevronRight className="ml-auto h-4 w-4 text-white/30" aria-hidden="true" />
          </Link>
        </Stagger>
      </MotionSection>

      <AnnouncementsSection data={data} />
      <CertificatesStrip data={data} />
      {hasActivity && <RecentActivity data={data} />}
      <MyCoursesList data={data} />
    </div>
  );
}
