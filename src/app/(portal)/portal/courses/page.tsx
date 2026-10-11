"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { BookOpen, ChevronRight, Play } from "lucide-react";
import type { MePayload } from "@/components/portal/types";
import { ProgressRing } from "@/components/portal/progress-ring";
import { CoursesListSkeleton } from "@/components/portal/portal-skeleton";
import {
  PortalPageHeader,
  GlassCard,
  EmptyState,
  MotionSection,
  Stagger,
  ProgressBar,
  StatusPill,
} from "@/components/portal/portal-ui";

export default function PortalCoursesPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  if (isLoading) return <CoursesListSkeleton />;

  if (isError || !data) {
    return (
      <EmptyState
        icon={BookOpen}
        title="Unable to load courses"
        description="Please refresh and try again."
      />
    );
  }

  const enrollments = data.enrollments;

  return (
    <MotionSection>
      <PortalPageHeader
        eyebrow="Flight deck"
        title="My Courses"
        description="Your enrolled programmes - pick up where you left off or start a new module."
      />

      {enrollments.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No courses enrolled"
          description="Contact your instructor to get enrolled in a course."
        />
      ) : (
        <Stagger className="grid gap-4 sm:grid-cols-2">
          {enrollments.map((e) => {
            const pct = e.percentComplete;
            const status =
              pct === 100 ? "Complete" : pct === 0 ? "Not started" : "In progress";
            const tone = pct === 100 ? "success" : pct === 0 ? "neutral" : "brand";

            return (
              <Link
                key={e.id}
                href={`/portal/courses/${e.courseId}`}
                className="group block"
                aria-label={`Open ${e.course.title} - ${pct}% complete`}
              >
                <GlassCard soft className="h-full transition-all group-hover:border-white/20">
                  <div className="flex items-start gap-4">
                    <ProgressRing
                      value={pct}
                      size={56}
                      strokeWidth={4.5}
                      label={`${pct}%`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="truncate font-medium text-white">{e.course.title}</p>
                        <StatusPill tone={tone}>{status}</StatusPill>
                      </div>
                      <ProgressBar value={pct} className="mt-3" />
                      <p className="mt-2 text-[11px] text-white/40">
                        {pct === 100
                          ? "All topics completed"
                          : pct === 0
                            ? "Ready to begin"
                            : `${pct}% complete`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-4">
                    <span className="flex items-center gap-1.5 text-xs text-white/50 group-hover:text-white/80">
                      <Play className="h-3 w-3 text-[var(--ab-red)]" aria-hidden="true" />
                      Open course player
                    </span>
                    <ChevronRight className="h-4 w-4 text-white/25 group-hover:text-[var(--ab-red)]" aria-hidden="true" />
                  </div>
                </GlassCard>
              </Link>
            );
          })}
        </Stagger>
      )}
    </MotionSection>
  );
}
