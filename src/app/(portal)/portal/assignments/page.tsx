"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  BookOpen,
  Calendar,
  Clock,
  CheckCircle2,
  FileText,
  AlertCircle,
  Loader2,
  Send,
  FileCheck2,
  ChevronRight,
  ExternalLink,
} from "lucide-react";

interface StudentSubmission {
  id: string;
  body: string | null;
  fileUrl: string | null;
  score: number | null;
  feedback: string | null;
  status: "SUBMITTED" | "GRADED" | "RETURNED";
  submittedAt: string;
}

interface StudentAssignment {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  maxScore: number;
  status: "PUBLISHED" | "CLOSED";
  course: { id: string; title: string };
  batch: { id: string; name: string } | null;
  submissions: StudentSubmission[];
}

export default function StudentAssignmentsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<"all" | "pending" | "submitted" | "graded">("all");
  const [selectedAssignment, setSelectedAssignment] = React.useState<StudentAssignment | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = React.useState(false);

  // Form states for submission
  const [body, setBody] = React.useState("");
  const [fileUrl, setFileUrl] = React.useState("");

  // Fetch assignments
  const { data: assignments = [], isLoading, isError } = useQuery<StudentAssignment[]>({
    queryKey: ["student-assignments"],
    queryFn: () => apiFetch<StudentAssignment[]>("/lms/assignments"),
  });

  // Submit assignment mutation
  const submitMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: any }) =>
      apiFetch(`/lms/assignments/${id}/submit`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["student-assignments"] });
      setDetailDialogOpen(false);
      setBody("");
      setFileUrl("");
      toast({ title: "Assignment submitted successfully", description: "Your instructor will grade it soon." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to submit assignment", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignment || (!body.trim() && !fileUrl.trim())) {
      toast({ title: "Please provide a text response or a file URL", variant: "destructive" });
      return;
    }

    submitMutation.mutate({
      id: selectedAssignment.id,
      payload: {
        body: body.trim() || null,
        fileUrl: fileUrl.trim() || null,
      },
    });
  };

  const getStatusText = (a: StudentAssignment) => {
    const sub = a.submissions[0];
    if (!sub) return "PENDING";
    return sub.status;
  };

  const filtered = assignments.filter((a) => {
    const status = getStatusText(a);
    if (activeTab === "pending") return status === "PENDING";
    if (activeTab === "submitted") return status === "SUBMITTED";
    if (activeTab === "graded") return status === "GRADED";
    return true;
  });

  const sub = selectedAssignment?.submissions?.[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Assignments"
        description="View assigned coursework, submit your answers, and check your grades."
      />

      {/* Tabs */}
      <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-1">
        {[
          { id: "all", label: "All Assignments" },
          { id: "pending", label: "To Do / Pending" },
          { id: "submitted", label: "Submitted" },
          { id: "graded", label: "Graded & Reviewed" },
        ].map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${
                isActive
                  ? "bg-primary text-white border-primary shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground font-semibold">Loading assignments...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 glass-card rounded-2xl border border-white/10 border-dashed">
          <BookOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <h3 className="text-sm font-bold text-white">No assignments found</h3>
          <p className="text-xs text-muted-foreground mt-1">There are no assignments in this tab.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filtered.map((a) => {
            const sub = a.submissions[0];
            const statusVal = getStatusText(a);

            return (
              <div
                key={a.id}
                onClick={() => {
                  setSelectedAssignment(a);
                  setDetailDialogOpen(true);
                }}
                className="glass-card rounded-2xl p-5 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-white/20 transition-all cursor-pointer group"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                        statusVal === "GRADED"
                          ? "bg-green-500/20 text-green-400 border border-green-500/30"
                          : statusVal === "SUBMITTED"
                          ? "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                          : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                      }`}
                    >
                      {statusVal === "PENDING" ? "To Do" : statusVal}
                    </span>
                    <span className="text-[10px] text-muted-foreground font-semibold uppercase">{a.course.title}</span>
                  </div>
                  <h3 className="text-sm font-bold text-white group-hover:text-primary transition-colors">{a.title}</h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-[10px] text-muted-foreground">
                    {a.dueAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> Due: {new Date(a.dueAt).toLocaleDateString()}
                      </span>
                    )}
                    <span>Max Score: {a.maxScore}</span>
                    {sub && sub.score !== null && (
                      <span className="font-bold text-green-400">Score: {sub.score} / {a.maxScore}</span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0 self-end md:self-auto text-xs font-bold text-muted-foreground group-hover:text-white transition-colors">
                  View Details <ChevronRight className="h-4 w-4" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Assignment Detail & Submission Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-md glass-panel border-white/10 bg-slate-900/98 text-white max-h-[90vh] overflow-y-auto">
          {selectedAssignment && (
            <div className="space-y-5 pt-2">
              <div>
                <span className="text-[10px] font-extrabold uppercase text-primary tracking-wider">
                  {selectedAssignment.course.title}
                </span>
                <DialogHeader className="p-0">
                  <DialogTitle className="text-base font-bold text-white text-left">
                    {selectedAssignment.title}
                  </DialogTitle>
                </DialogHeader>
              </div>

              {selectedAssignment.description && (
                <div className="text-xs text-muted-foreground bg-secondary/10 p-3 rounded-xl border border-white/5 whitespace-pre-line leading-relaxed">
                  {selectedAssignment.description}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="p-3 bg-secondary/10 rounded-xl border border-white/5">
                  <span className="text-[10px] font-extrabold text-muted-foreground block uppercase">Maximum Score</span>
                  <span className="text-sm font-bold text-white mt-1 block">{selectedAssignment.maxScore} Points</span>
                </div>
                <div className="p-3 bg-secondary/10 rounded-xl border border-white/5">
                  <span className="text-[10px] font-extrabold text-muted-foreground block uppercase">Deadline</span>
                  <span className="text-xs font-semibold text-white mt-1 block">
                    {selectedAssignment.dueAt ? new Date(selectedAssignment.dueAt).toLocaleString() : "No deadline"}
                  </span>
                </div>
              </div>

              {/* Submission Logic */}
              {selectedAssignment.submissions.length === 0 ? (
                /* Render submission form */
                <form onSubmit={handleSubmit} className="space-y-4 border-t border-white/10 pt-4">
                  <h4 className="text-xs font-bold text-white flex items-center gap-2">
                    <Send className="h-4 w-4 text-primary" /> Submit Response
                  </h4>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground">Text Response / Answers</label>
                    <Textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      placeholder="Type your text answer or submission notes here..."
                      className="bg-secondary/40 border-white/10 text-xs font-semibold text-white h-28"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-muted-foreground">Attachment Link / File URL (Optional)</label>
                    <Input
                      value={fileUrl}
                      onChange={(e) => setFileUrl(e.target.value)}
                      placeholder="e.g. Google Drive, GitHub or cloud storage link"
                      className="bg-secondary/40 border-white/10 text-xs font-mono text-white"
                    />
                  </div>

                  <Button
                    type="submit"
                    disabled={submitMutation.isPending}
                    className="w-full bg-primary hover:bg-primary/90 text-white text-xs font-bold"
                  >
                    {submitMutation.isPending ? "Submitting..." : "Submit Assignment"}
                  </Button>
                </form>
              ) : (
                /* Render submission status and grades */
                <div className="border-t border-white/10 pt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold text-white flex items-center gap-2">
                      <FileCheck2 className="h-4 w-4 text-primary" /> Your Submission
                    </h4>
                    <span
                      className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                        sub?.status === "GRADED"
                          ? "bg-green-500/20 text-green-400 border border-green-500/30"
                          : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                      }`}
                    >
                      {sub?.status}
                    </span>
                  </div>

                  <div className="p-3 bg-secondary/15 rounded-xl border border-white/5 space-y-2">
                    <div className="text-[10px] text-muted-foreground">
                      Submitted: {sub?.submittedAt ? new Date(sub.submittedAt).toLocaleString() : ""}
                    </div>
                    {sub?.body && (
                      <p className="text-xs text-white/95 whitespace-pre-line mt-1 bg-slate-950/30 p-2.5 rounded-lg border border-white/5">
                        {sub.body}
                      </p>
                    )}
                    {sub?.fileUrl && (
                      <div className="pt-1">
                        <a
                          href={sub.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary font-bold hover:underline inline-flex items-center gap-1"
                        >
                          <FileText className="h-3.5 w-3.5" /> View Submitted File <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    )}
                  </div>

                  {sub?.status === "GRADED" && (
                    <div className="p-4 bg-green-500/10 rounded-xl border border-green-500/20 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-green-400 flex items-center gap-1.5">
                          <CheckCircle2 className="h-4 w-4" /> Score & Evaluation
                        </span>
                        <span className="text-sm font-extrabold text-white">
                          {sub.score} / {selectedAssignment.maxScore}
                        </span>
                      </div>
                      {sub.feedback && (
                        <p className="text-xs text-muted-foreground border-t border-green-500/10 pt-2 leading-relaxed">
                          <span className="font-bold text-white block mb-0.5">Instructor Feedback:</span>
                          {sub.feedback}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
