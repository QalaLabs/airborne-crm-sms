"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import {
  CheckCircle2,
  Lock,
  FileText,
  Play,
  BookmarkIcon,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Download,
  Loader2,
  AlertCircle,
  Home,
  BookOpen,
} from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import type { PlayerPayload, FlatTopic, PlayerContent } from "@/components/portal/types";
import { CourseSidebar } from "@/components/portal/course-sidebar";
import { QuizModal } from "@/components/portal/quiz-modal";
import { PlayerSkeleton } from "@/components/portal/portal-skeleton";
import {
  GlassCard,
  EmptyState,
  ProgressBar,
  StatusPill,
} from "@/components/portal/portal-ui";

function ContentViewer({ content }: { content: PlayerContent }) {
  return (
    <GlassCard soft className="!p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 bg-black/20 px-4 py-3">
        <div className="flex items-center gap-2 text-xs text-white/70">
          {content.type === "VIDEO" ? (
            <Play className="h-3.5 w-3.5 text-[var(--ab-red)]" aria-hidden="true" />
          ) : (
            <FileText className="h-3.5 w-3.5 text-[var(--ab-red)]" aria-hidden="true" />
          )}
          <span className="font-medium">{content.title}</span>
          <StatusPill tone="neutral">{content.type}</StatusPill>
          {content.duration && (
            <span className="text-white/30">{Math.round(content.duration / 60)} min</span>
          )}
        </div>
        {(content.type === "PDF" || content.type === "NOTES") && (
          <a
            href={content.url}
            target="_blank"
            rel="noreferrer"
            download
            className="ab-btn ab-btn-ghost px-2 py-1 text-[10px]"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            Download
          </a>
        )}
      </div>
      {content.type === "VIDEO" ? (
        <video
          controls
          className="max-h-[62vh] w-full bg-black"
          src={content.url}
          preload="metadata"
          aria-label={content.title}
        >
          <track kind="captions" />
        </video>
      ) : (
        <iframe
          title={content.title}
          src={content.url}
          className="h-[65vh] w-full bg-white"
          sandbox="allow-scripts allow-same-origin"
        />
      )}
    </GlassCard>
  );
}

function MobileDrawerToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-label={open ? "Close course outline" : "Open course outline"}
      className="ab-btn ab-btn-ghost px-3 py-2 text-xs lg:hidden"
    >
      {open ? "Hide" : "Show"} Outline
      <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-90")} aria-hidden="true" />
    </button>
  );
}

export default function CoursePlayerPage() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;
  const queryClient = useQueryClient();

  const [activeTopicId, setActiveTopicId] = React.useState<string | null>(null);
  const [quizModuleId, setQuizModuleId] = React.useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = React.useState(false);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["lms-player", courseId],
    queryFn: () => apiFetch<PlayerPayload>(`/lms/me/courses/${courseId}`),
  });

  const progressMap = React.useMemo(() => {
    const map = new Map<string, { completed: boolean; percent: number }>();
    data?.progress.forEach((p) => map.set(p.topicId, p));
    return map;
  }, [data?.progress]);

  const unlocked = React.useMemo(
    () => new Set(data?.unlockedModuleIds ?? []),
    [data?.unlockedModuleIds],
  );
  const bookmarked = React.useMemo(
    () => new Set(data?.bookmarkedTopicIds ?? []),
    [data?.bookmarkedTopicIds],
  );

  const flatTopics = React.useMemo<FlatTopic[]>(() => {
    const list: FlatTopic[] = [];
    data?.course.stages.forEach((stage) =>
      stage.modules.forEach((mod) => {
        const locked = !unlocked.has(mod.id);
        mod.chapters.forEach((ch) =>
          ch.topics.forEach((topic) =>
            list.push({
              topicId: topic.id,
              topicTitle: topic.title,
              moduleId: mod.id,
              moduleTitle: mod.title,
              chapterId: ch.id,
              chapterTitle: ch.title,
              stageTitle: stage.title,
              locked,
              contents: topic.contents,
            }),
          ),
        );
      }),
    );
    return list;
  }, [data, unlocked]);

  React.useEffect(() => {
    if (!activeTopicId && flatTopics.length) {
      const resume =
        flatTopics.find((t) => !t.locked && !progressMap.get(t.topicId)?.completed) ??
        flatTopics.find((t) => !t.locked) ??
        flatTopics[0];
      setActiveTopicId(resume?.topicId ?? null);
    }
  }, [flatTopics, activeTopicId, progressMap]);

  const active = flatTopics.find((t) => t.topicId === activeTopicId) ?? null;
  const activeIdx = flatTopics.findIndex((t) => t.topicId === activeTopicId);
  const prevTopic = activeIdx > 0 ? flatTopics[activeIdx - 1] : null;
  const nextTopic =
    activeIdx >= 0 && activeIdx < flatTopics.length - 1 ? flatTopics[activeIdx + 1] : null;

  const completedCount = Array.from(progressMap.values()).filter((p) => p.completed).length;
  const progressPercent =
    flatTopics.length > 0 ? Math.round((completedCount / flatTopics.length) * 100) : 0;

  const markDone = useMutation({
    mutationFn: () =>
      apiFetch("/lms/me/progress", {
        method: "POST",
        body: JSON.stringify({ topicId: activeTopicId, completed: true, percent: 100 }),
      }),
    onSuccess: async () => {
      toast({ title: "Topic marked complete" });
      await queryClient.invalidateQueries({ queryKey: ["lms-player", courseId] });
      await queryClient.invalidateQueries({ queryKey: ["lms-me"] });
      if (nextTopic && !nextTopic.locked) {
        setActiveTopicId(nextTopic.topicId);
      }
    },
    onError: (err: Error) =>
      toast({ title: "Failed to save", description: err.message, variant: "destructive" }),
  });

  const toggleBookmark = useMutation({
    mutationFn: () =>
      apiFetch("/lms/me/bookmarks", {
        method: "POST",
        body: JSON.stringify({ topicId: activeTopicId }),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lms-player", courseId] });
    },
    onError: (err: Error) =>
      toast({ title: "Bookmark failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) return <PlayerSkeleton />;

  if (isError) {
    return (
      <GlassCard className="border-red-500/30 bg-red-500/10">
        <AlertCircle className="h-6 w-6 text-red-400" aria-hidden="true" />
        <p className="mt-2 font-semibold text-red-200">{(error as Error).message}</p>
        <p className="mt-1 text-sm text-red-200/60">Make sure you are enrolled in this course.</p>
        <Link href="/portal" className="ab-btn ab-btn-ghost mt-4 inline-flex gap-1.5 px-4 py-2 text-sm">
          <Home className="h-3.5 w-3.5" aria-hidden="true" />
          Back to dashboard
        </Link>
      </GlassCard>
    );
  }

  if (!data) return null;

  const activeModuleTopics = active ? flatTopics.filter((t) => t.moduleId === active.moduleId) : [];
  const allModTopicsDone =
    activeModuleTopics.length > 0 &&
    activeModuleTopics.every((t) => progressMap.get(t.topicId)?.completed);
  const activeModuleAssessment = active
    ? data.assessments.find((a) => a.moduleId === active.moduleId)
    : null;
  const activeModuleAttempts = active
    ? data.quizAttempts.filter((q) => q.moduleId === active.moduleId).length
    : 0;
  const activeModuleObj = active
    ? data.course.stages.flatMap((s) => s.modules).find((m) => m.id === active.moduleId)
    : null;
  const canTakeQuiz =
    active &&
    !active.locked &&
    allModTopicsDone &&
    activeModuleAssessment?.status !== "PASS" &&
    !!activeModuleObj &&
    activeModuleAttempts < activeModuleObj.maxAttempts;

  const isCompleted = active ? (progressMap.get(active.topicId)?.completed ?? false) : false;
  const isBookmarked = activeTopicId ? bookmarked.has(activeTopicId) : false;

  return (
    <>
      {quizModuleId && (
        <QuizModal
          moduleId={quizModuleId}
          courseId={courseId}
          onClose={() => setQuizModuleId(null)}
          onPass={() => {
            setQuizModuleId(null);
            void queryClient.invalidateQueries({ queryKey: ["lms-player", courseId] });
          }}
        />
      )}

      <div className="space-y-4">
        <GlassCard soft className="!p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <nav className="flex items-center gap-2 text-xs text-white/40" aria-label="Breadcrumb">
                <Link href="/portal" className="hover:text-white transition-colors">
                  Dashboard
                </Link>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
                <Link href="/portal/courses" className="hover:text-white transition-colors">
                  My Courses
                </Link>
                <ChevronRight className="h-3 w-3" aria-hidden="true" />
                <span className="text-white/70">{data.course.title}</span>
              </nav>
              <h1 className="mt-1 ab-display text-xl text-white sm:text-2xl">{data.course.title}</h1>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <ProgressBar value={progressPercent} className="max-w-[200px]" />
                <span className="text-xs text-white/50">
                  {progressPercent}% · {completedCount}/{flatTopics.length} topics
                </span>
              </div>
            </div>
            <MobileDrawerToggle open={drawerOpen} onToggle={() => setDrawerOpen((v) => !v)} />
          </div>
        </GlassCard>

        <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
          <div className={cn(!drawerOpen && "hidden lg:block")}>
            <CourseSidebar
              data={data}
              flatTopics={flatTopics}
              activeTopicId={activeTopicId}
              onTopicSelect={(id) => {
                setActiveTopicId(id);
                setDrawerOpen(false);
              }}
              onQuizOpen={(id) => setQuizModuleId(id)}
              progressMap={progressMap}
              unlocked={unlocked}
              bookmarked={bookmarked}
            />
          </div>

          <main className="ab-glass min-h-[60vh] !p-0">
            {!active && (
              <EmptyState
                icon={BookOpen}
                title="Select a topic"
                description="Choose a topic from the course outline to begin studying."
              />
            )}

            {active?.locked && (
              <div className="flex h-64 flex-col items-center justify-center gap-4 p-6 text-center">
                <Lock className="h-12 w-12 text-[var(--ab-gold)]/50" aria-hidden="true" />
                <div>
                  <p className="ab-display text-lg text-white/80">Module Locked</p>
                  <p className="mt-1 max-w-xs text-sm text-white/45">
                    Pass the assessment for the previous module to unlock this content.
                  </p>
                </div>
              </div>
            )}

            {active && !active.locked && (
              <div className="space-y-5 p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs text-white/35">
                      {active.stageTitle}
                      <span className="mx-1.5 text-white/20">›</span>
                      {active.moduleTitle}
                      <span className="mx-1.5 text-white/20">›</span>
                      {active.chapterTitle}
                    </p>
                    <h2 className="mt-1 ab-display text-lg text-white">{active.topicTitle}</h2>
                  </div>

                  <div className="flex items-center gap-2">
                    <Link
                      href={`/portal/assistant?${new URLSearchParams({
                        ...(data.course.title ? { course: data.course.title } : {}),
                        chapter: active.chapterTitle,
                        topic: active.topicTitle,
                      }).toString()}`}
                      className="ab-btn ab-btn-ghost px-3 py-2 text-xs"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-[var(--ab-red)]" aria-hidden="true" />
                      Ask AI
                    </Link>

                    <button
                      type="button"
                      onClick={() => activeTopicId && toggleBookmark.mutate()}
                      disabled={toggleBookmark.isPending}
                      aria-label={isBookmarked ? "Remove bookmark" : "Add bookmark"}
                      aria-pressed={isBookmarked}
                      className={cn(
                        "ab-btn rounded-lg border p-2",
                        isBookmarked
                          ? "border-[var(--ab-gold)]/40 bg-[var(--ab-gold-soft)] text-[var(--ab-gold)]"
                          : "ab-btn-ghost text-white/40 hover:text-[var(--ab-gold)]",
                      )}
                    >
                      <BookmarkIcon
                        className={cn("h-4 w-4", isBookmarked && "fill-current")}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>

                {active.contents.length === 0 ? (
                  <EmptyState
                    icon={FileText}
                    title="No materials yet"
                    description="No study materials uploaded for this topic yet."
                  />
                ) : (
                  <div className="space-y-4">
                    {active.contents.map((c) => (
                      <ContentViewer key={c.id} content={c} />
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-4">
                  <div className="flex gap-2">
                    {prevTopic && (
                      <button
                        type="button"
                        onClick={() => setActiveTopicId(prevTopic.topicId)}
                        disabled={prevTopic.locked}
                        className="ab-btn ab-btn-ghost px-3 py-2 text-xs disabled:opacity-40"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                        Previous
                      </button>
                    )}
                    {nextTopic && (
                      <button
                        type="button"
                        onClick={() => !nextTopic.locked && setActiveTopicId(nextTopic.topicId)}
                        disabled={nextTopic.locked}
                        className="ab-btn ab-btn-ghost px-3 py-2 text-xs disabled:opacity-40"
                      >
                        Next
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>

                  <div className="flex gap-2">
                    {canTakeQuiz && (
                      <button
                        type="button"
                        onClick={() => setQuizModuleId(active.moduleId)}
                        className="ab-btn ab-btn-ghost border-[rgba(200,16,46,0.5)] bg-[rgba(200,16,46,0.1)] px-4 py-2 text-sm font-semibold text-[var(--ab-red)]"
                      >
                        Take Assessment
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={markDone.isPending || isCompleted}
                      onClick={() => markDone.mutate()}
                      className={cn(
                        "ab-btn flex items-center gap-1.5 px-4 py-2 text-sm font-semibold",
                        isCompleted
                          ? "cursor-default bg-emerald-600/20 text-emerald-400"
                          : "ab-btn-primary disabled:opacity-60",
                      )}
                    >
                      {markDone.isPending ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          Saving…
                        </>
                      ) : isCompleted ? (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          Completed
                        </>
                      ) : (
                        "Mark Complete"
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}
