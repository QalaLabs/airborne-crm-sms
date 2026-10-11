"use client";

import { cn } from "@/lib/utils";
import type { PlayerPayload, FlatTopic } from "./types";
import { CheckCircle2, Lock, BookmarkIcon } from "lucide-react";

interface CourseSidebarProps {
  data: PlayerPayload;
  flatTopics: FlatTopic[];
  activeTopicId: string | null;
  onTopicSelect: (topicId: string) => void;
  onQuizOpen: (moduleId: string) => void;
  progressMap: Map<string, { completed: boolean; percent: number }>;
  unlocked: Set<string>;
  bookmarked: Set<string>;
}

export function CourseSidebar({
  data,
  flatTopics,
  activeTopicId,
  onTopicSelect,
  onQuizOpen,
  progressMap,
  unlocked,
  bookmarked,
}: CourseSidebarProps) {
  return (
    <aside
      aria-label="Course navigation"
      className="ab-glass overflow-y-auto lg:max-h-[80vh] lg:sticky lg:top-4 !p-0"
    >
      {data.course.stages.map((stage) => (
        <div key={stage.id} className="border-b border-white/5 last:border-0">
          <p className="sticky top-0 z-10 bg-[var(--ab-panel)]/95 px-4 py-2.5 ab-eyebrow text-white/50 backdrop-blur">
            {stage.title}
          </p>

          {stage.modules.map((mod) => {
            const isLocked = !unlocked.has(mod.id);
            const assessment = data.assessments.find((a) => a.moduleId === mod.id);
            const passed = assessment?.status === "PASS";
            const attemptsUsed = data.quizAttempts.filter((q) => q.moduleId === mod.id).length;
            const attemptsLeft = mod.maxAttempts - attemptsUsed;

            const modTopics = flatTopics.filter((t) => t.moduleId === mod.id);
            const modDone = modTopics.filter((t) => progressMap.get(t.topicId)?.completed).length;

            return (
              <div key={mod.id}>
                <div
                  className={cn(
                    "flex items-center gap-2 border-b border-white/[0.04] px-4 py-2",
                    isLocked && "opacity-50",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {isLocked ? (
                        <Lock className="h-3 w-3 shrink-0 text-white/30" aria-label="Locked" />
                      ) : passed ? (
                        <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" aria-label="Passed" />
                      ) : (
                        <span className="h-3 w-3 shrink-0 rounded-full border border-white/25" aria-hidden="true" />
                      )}
                      <p className="truncate text-[11px] font-semibold text-white/75">{mod.title}</p>
                    </div>
                    {!isLocked && (
                      <p className="ml-[18px] mt-0.5 text-[9px] text-white/30">
                        {modDone}/{modTopics.length} topics
                        {passed && <span className="ml-1.5 text-emerald-400/80">{assessment?.score}%</span>}
                      </p>
                    )}
                  </div>

                  {!isLocked && !passed && attemptsLeft > 0 && (
                    <button
                      type="button"
                      onClick={() => onQuizOpen(mod.id)}
                      aria-label={`Take assessment for ${mod.title}`}
                      className="ab-btn shrink-0 border border-[rgba(200,16,46,0.4)] px-2 py-0.5 text-[9px] font-bold text-[var(--ab-red)] hover:bg-[rgba(200,16,46,0.1)]"
                    >
                      {attemptsUsed > 0 ? "Retry" : "Quiz"}
                    </button>
                  )}
                </div>

                {mod.chapters.map((ch) => (
                  <div key={ch.id}>
                    <p className="bg-white/[0.015] px-4 py-1.5 text-[9px] uppercase tracking-widest text-white/25">
                      {ch.title}
                    </p>
                    {ch.topics.map((topic) => {
                      const done = progressMap.get(topic.id)?.completed;
                      const isActive = activeTopicId === topic.id;
                      const isBookmarked = bookmarked.has(topic.id);

                      return (
                        <button
                          key={topic.id}
                          type="button"
                          disabled={isLocked}
                          onClick={() => !isLocked && onTopicSelect(topic.id)}
                          aria-current={isActive ? "true" : undefined}
                          aria-label={`${done ? "Completed: " : ""}${topic.title}${isLocked ? " (locked)" : ""}`}
                          className={cn(
                            "flex w-full items-center gap-2 px-6 py-2 text-left text-xs transition-colors",
                            isActive
                              ? "border-l-2 border-[var(--ab-red)] bg-[rgba(200,16,46,0.12)] text-white"
                              : "text-white/55 hover:bg-white/[0.04] hover:text-white/90",
                            isLocked ? "cursor-not-allowed opacity-40" : "cursor-pointer",
                          )}
                        >
                          {done ? (
                            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-400" aria-hidden="true" />
                          ) : (
                            <span
                              className={cn(
                                "h-3 w-3 shrink-0 rounded-full border",
                                isActive ? "border-[var(--ab-red)]/60" : "border-white/20",
                              )}
                              aria-hidden="true"
                            />
                          )}
                          <span className="flex-1 truncate leading-snug">{topic.title}</span>
                          {isBookmarked && (
                            <BookmarkIcon
                              className="h-2.5 w-2.5 shrink-0 fill-[var(--ab-gold)] text-[var(--ab-gold)]"
                              aria-label="Bookmarked"
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
