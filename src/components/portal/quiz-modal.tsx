"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import {
  Award,
  AlertCircle,
  CheckCircle2,
  Loader2,
  X,
} from "lucide-react";

interface QuizQuestion {
  id: string;
  stem: string;
  options: Array<{ id: string; text: string }>;
  order: number;
  points: number;
  hasNegativeMarking?: boolean;
}

interface QuizPayload {
  module: { id: string; title: string; passPercent: number; maxAttempts: number };
  questions: QuizQuestion[];
  attemptsUsed: number;
  attemptsRemaining: number;
}

interface QuizResult {
  scorePercent: number;
  earned: number;
  maxScore: number;
  passed: boolean;
  passPercent: number;
  attemptsUsed: number;
  attemptsRemaining: number;
  gradedAnswers: Record<string, { given: string; correct: string; isCorrect: boolean; points: number }>;
}

interface QuizModalProps {
  moduleId: string;
  courseId: string;
  onClose: () => void;
  onPass: () => void;
}

export function QuizModal({ moduleId, courseId, onClose, onPass }: QuizModalProps) {
  const queryClient = useQueryClient();
  const [answers, setAnswers] = React.useState<Record<string, string>>({});
  const [result, setResult] = React.useState<QuizResult | null>(null);
  const [submitted, setSubmitted] = React.useState(false);

  const { data: quiz, isLoading, isError } = useQuery({
    queryKey: ["lms-quiz", courseId, moduleId],
    queryFn: () => apiFetch<QuizPayload>(`/lms/me/courses/${courseId}/quiz/${moduleId}`),
  });

  const submitMutation = useMutation({
    mutationFn: () =>
      apiFetch<QuizResult>(`/lms/me/courses/${courseId}/quiz/${moduleId}`, {
        method: "POST",
        body: JSON.stringify({
          moduleId,
          answers,
          questionIds: quiz?.questions.map((q) => q.id) ?? [],
        }),
      }),
    onSuccess: (data) => {
      setResult(data);
      setSubmitted(true);
      void queryClient.invalidateQueries({ queryKey: ["lms-player", courseId] });
      if (data.passed) {
        toast({ title: "Assessment passed!", description: `Score: ${data.scorePercent}% - next module unlocked.` });
        onPass();
      } else {
        toast({
          title: "Not passed",
          description: `Score: ${data.scorePercent}% (need ${data.passPercent}%). ${data.attemptsRemaining} attempt${data.attemptsRemaining !== 1 ? "s" : ""} remaining.`,
          variant: "destructive",
        });
      }
    },
    onError: (err: Error) =>
      toast({ title: "Submit failed", description: err.message, variant: "destructive" }),
  });

  const allAnswered = quiz ? quiz.questions.every((q) => answers[q.id]) : false;

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
        <div className="ab-glass flex items-center gap-2 px-6 py-4 text-white">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading assessment…</span>
        </div>
      </div>
    );
  }

  if (isError || !quiz) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="ab-glass w-full max-w-sm p-8 text-center border-red-500/30">
          <AlertCircle className="mx-auto h-10 w-10 text-red-400" />
          <p className="mt-3 font-semibold text-white">Failed to load assessment</p>
          <button
            type="button"
            onClick={onClose}
            className="ab-btn ab-btn-ghost mt-4 px-5 py-2 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  if (quiz.attemptsRemaining <= 0 && !submitted) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
        <div className="ab-glass w-full max-w-md p-8 text-center">
          <AlertCircle className="mx-auto h-10 w-10 text-amber-400" />
          <h2 className="mt-3 ab-display text-lg text-white">No attempts remaining</h2>
          <p className="mt-2 text-sm text-white/60">
            You have used all {quiz.module.maxAttempts} attempt{quiz.module.maxAttempts !== 1 ? "s" : ""} for this module.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="ab-btn ab-btn-ghost mt-5 px-5 py-2 text-sm"
          >
            Close
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/85 backdrop-blur-sm p-4 pt-8"
    >
      <div className="ab-glass mb-8 w-full max-w-2xl !p-0 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h2 id="quiz-modal-title" className="font-semibold text-white">
              {quiz.module.title} - Assessment
            </h2>
            <p className="text-xs text-white/50 mt-0.5">
              Pass ≥ {quiz.module.passPercent}% · Attempt {quiz.attemptsUsed + 1} of {quiz.module.maxAttempts}
            </p>
            {quiz.questions.some((q) => q.hasNegativeMarking) && (
              <p className="text-[10px] text-amber-400/80 mt-0.5">
                Some questions have negative marking for incorrect answers.
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close assessment"
            className="rounded-lg p-1.5 text-white/60 hover:bg-white/10 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Result banner */}
        {submitted && result && (
          <div
            className={cn(
              "mx-6 mt-5 rounded-xl border p-5 text-center",
              result.passed
                ? "border-emerald-500/40 bg-emerald-500/10"
                : "border-red-500/40 bg-red-500/10",
            )}
          >
            {result.passed
              ? <Award className="mx-auto h-10 w-10 text-emerald-400" />
              : <AlertCircle className="mx-auto h-10 w-10 text-red-400" />}
            <p className={cn("mt-2 text-xl font-bold", result.passed ? "text-emerald-300" : "text-red-300")}>
              {result.passed ? "Assessment Passed" : "Not Passed"}
            </p>
            <p className="mt-1 text-sm text-white/70">
              Score: <strong>{result.scorePercent}%</strong> &nbsp;·&nbsp; {result.earned}/{result.maxScore} points
            </p>
            {!result.passed && result.attemptsRemaining > 0 && (
              <p className="mt-1 text-xs text-white/50">
                {result.attemptsRemaining} attempt{result.attemptsRemaining !== 1 ? "s" : ""} remaining
              </p>
            )}
          </div>
        )}

        {/* Questions */}
        <div className="space-y-7 p-6">
          {quiz.questions.map((q, idx) => {
            const grade = result?.gradedAnswers[q.id];
            return (
              <div key={q.id} className="space-y-3">
                <p className="text-sm font-medium leading-relaxed text-white">
                  <span className="mr-2 font-mono text-white/35">{idx + 1}.</span>
                  {q.stem}
                  {q.points > 1 && (
                    <span className="ml-2 text-xs font-normal text-white/40">({q.points} pts)</span>
                  )}
                  {q.hasNegativeMarking && (
                    <span className="ml-1 text-[10px] font-normal text-amber-400/70">· negative marking</span>
                  )}
                </p>
                <div className="grid gap-2">
                  {q.options.map((opt) => {
                    const chosen = answers[q.id] === opt.id;
                    const isCorrect = grade?.correct === opt.id;
                    const isWrong = grade && grade.given === opt.id && !grade.isCorrect;
                    return (
                      <label
                        key={opt.id}
                        className={cn(
                          "flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm transition-colors",
                          submitted
                            ? isCorrect
                              ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-200"
                              : isWrong
                                ? "border-red-500/60 bg-red-500/15 text-red-200"
                                : "border-white/10 text-white/60"
                            : chosen
                              ? "border-[var(--ab-red)]/70 bg-[rgba(200,16,46,0.15)] text-white"
                              : "border-white/10 text-white/70 hover:border-white/30 hover:bg-white/5",
                        )}
                      >
                        <input
                          type="radio"
                          name={`q-${q.id}`}
                          value={opt.id}
                          checked={chosen}
                          disabled={submitted}
                          onChange={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                          className="accent-[var(--ab-red)]"
                        />
                        <span className="flex-1">{opt.text}</span>
                        {submitted && isCorrect && (
                          <CheckCircle2 className="ml-auto h-4 w-4 shrink-0 text-emerald-400" />
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 px-6 py-4">
          <p className="text-xs text-white/40">
            {Object.keys(answers).length}/{quiz.questions.length} answered
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="ab-btn ab-btn-ghost px-4 py-2 text-sm"
            >
              {submitted ? "Close" : "Cancel"}
            </button>
            {!submitted && (
              <button
                type="button"
                disabled={!allAnswered || submitMutation.isPending}
                onClick={() => submitMutation.mutate()}
                className="ab-btn ab-btn-primary px-5 py-2 text-sm font-semibold disabled:opacity-50"
              >
                {submitMutation.isPending ? "Submitting…" : "Submit Assessment"}
              </button>
            )}
            {submitted && !result?.passed && result && result.attemptsRemaining > 0 && (
              <button
                type="button"
                onClick={() => {
                  setSubmitted(false);
                  setResult(null);
                  setAnswers({});
                  void queryClient.invalidateQueries({ queryKey: ["lms-quiz", courseId, moduleId] });
                }}
                className="ab-btn ab-btn-primary px-5 py-2 text-sm font-semibold"
              >
                Try again ({result.attemptsRemaining} left)
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
