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
} from "@/components/portal/portal-ui";
import { TextSkeleton, CardSkeleton } from "@/components/portal/portal-skeleton";
import { Bookmark, ChevronRight, BookOpen } from "lucide-react";

export default function PortalBookmarksPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <TextSkeleton className="h-8 w-40" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((i) => (
            <CardSkeleton key={i} className="h-24" />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !data) {
    return <EmptyState icon={Bookmark} title="Unable to load bookmarks" />;
  }

  const bookmarks = data.bookmarks ?? [];
  const courseId = data.continueLearning?.courseId ?? data.enrollments[0]?.courseId;

  return (
    <MotionSection>
      <PortalPageHeader
        eyebrow="Saved for later"
        title="Bookmarks"
        description="Topics you flagged mid-study - jump back in without hunting the curriculum tree."
      />

      {bookmarks.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No bookmarks yet"
          description="Tap the bookmark icon while studying a topic to save it here."
          action={
            courseId ? (
              <Link href={`/portal/courses/${courseId}`} className="ab-btn ab-btn-primary px-4 py-2">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                Resume learning
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {bookmarks.map((b) => (
            <GlassCard key={b.id} soft className="!p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ab-red)]/15 text-[var(--ab-red)]">
                  <Bookmark className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{b.topic.title}</p>
                  <p className="mt-1 text-xs text-white/40">Saved topic</p>
                </div>
                {courseId && (
                  <Link
                    href={`/portal/courses/${courseId}`}
                    className="text-white/40 hover:text-white"
                    aria-label={`Open ${b.topic.title}`}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                )}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </MotionSection>
  );
}
