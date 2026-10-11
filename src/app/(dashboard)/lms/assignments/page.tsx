"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { formatInIST, fromISTInput, toISTInput } from "@/lib/time/ist";
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
  Plus,
  Edit2,
  Trash2,
  ChevronRight,
  User,
  FileText,
  CheckCircle2,
  Loader2,
  FileCheck,
  AlertCircle,
} from "lucide-react";
import type { LmsCourse, LmsBatch, LmsModule } from "@prisma/client";

// Define TypeScript structures local to file since we fetched them with includes
interface ListAssignment {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  maxScore: number;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  course: { id: string; title: string };
  batch: { id: string; name: string } | null;
  _count: { submissions: number };
}

interface Submission {
  id: string;
  body: string | null;
  fileUrl: string | null;
  score: number | null;
  feedback: string | null;
  status: "SUBMITTED" | "GRADED" | "RETURNED";
  submittedAt: string;
  student: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
}

interface SingleAssignment extends ListAssignment {
  submissions: Submission[];
}

export default function FacultyAssignmentsPage() {
  const queryClient = useQueryClient();
  const [courseFilter, setCourseFilter] = React.useState<string>("");
  const [batchFilter, setBatchFilter] = React.useState<string>("");

  // Dialog control states
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false);
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [submissionsDialogOpen, setSubmissionsDialogOpen] = React.useState(false);
  const [gradeDialogOpen, setGradeDialogOpen] = React.useState(false);

  // Form states
  const [selectedAssignmentId, setSelectedAssignmentId] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [courseId, setCourseId] = React.useState("");
  const [batchId, setBatchId] = React.useState("");
  const [moduleId, setModuleId] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [maxScore, setMaxScore] = React.useState(100);
  const [status, setStatus] = React.useState<"DRAFT" | "PUBLISHED" | "CLOSED">("DRAFT");

  // Grading states
  const [selectedSubmission, setSelectedSubmission] = React.useState<Submission | null>(null);
  const [gradeScore, setGradeScore] = React.useState(0);
  const [gradeFeedback, setGradeFeedback] = React.useState("");

  // Queries
  const { data: courses = [] } = useQuery<LmsCourse[]>({
    queryKey: ["lms-courses"],
    queryFn: () => apiFetch<LmsCourse[]>("/lms/courses"),
  });

  const { data: batches = [] } = useQuery<LmsBatch[]>({
    queryKey: ["lms-batches"],
    queryFn: () => apiFetch<LmsBatch[]>("/lms/batches"),
  });

  // Modules map based on courseId
  const { data: modules = [] } = useQuery<LmsModule[]>({
    queryKey: ["lms-modules", courseId],
    queryFn: () => (courseId ? apiFetch<LmsModule[]>(`/lms/modules?courseId=${courseId}`) : Promise.resolve([])),
    enabled: !!courseId,
  });

  const { data: assignments = [], isLoading } = useQuery<ListAssignment[]>({
    queryKey: ["lms-assignments", courseFilter, batchFilter],
    queryFn: () => {
      let query = "/lms/assignments";
      const params = new URLSearchParams();
      if (courseFilter) params.append("courseId", courseFilter);
      if (batchFilter) params.append("batchId", batchFilter);
      const str = params.toString();
      return apiFetch<ListAssignment[]>(str ? `${query}?${str}` : query);
    },
  });

  const { data: selectedAssignment, refetch: refetchSubmissions } = useQuery<SingleAssignment>({
    queryKey: ["lms-assignment", selectedAssignmentId],
    queryFn: () => apiFetch<SingleAssignment>(`/lms/assignments/${selectedAssignmentId}`),
    enabled: !!selectedAssignmentId,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch<ListAssignment>("/lms/assignments", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lms-assignments"] });
      setCreateDialogOpen(false);
      resetForm();
      toast({ title: "Assignment created successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to create assignment", description: err.message, variant: "destructive" });
    },
  });

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      apiFetch<ListAssignment>(`/lms/assignments/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lms-assignments"] });
      setEditDialogOpen(false);
      resetForm();
      toast({ title: "Assignment updated successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update assignment", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/assignments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lms-assignments"] });
      toast({ title: "Assignment deleted successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to delete assignment", description: err.message, variant: "destructive" });
    },
  });

  const gradeMutation = useMutation({
    mutationFn: ({ subId, body }: { subId: string; body: any }) =>
      apiFetch(`/lms/submissions/${subId}/grade`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      refetchSubmissions();
      setGradeDialogOpen(false);
      setSelectedSubmission(null);
      toast({ title: "Submission graded successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to grade submission", description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSelectedAssignmentId(null);
    setTitle("");
    setDescription("");
    setCourseId("");
    setBatchId("");
    setModuleId("");
    setDueAt("");
    setMaxScore(100);
    setStatus("DRAFT");
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!courseId || !title.trim()) return;

    createMutation.mutate({
      courseId,
      batchId: batchId || null,
      moduleId: moduleId || null,
      title: title.trim(),
      description: description.trim() || null,
      dueAt: dueAt ? fromISTInput(dueAt) : null,
      maxScore,
      status,
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAssignmentId) return;

    editMutation.mutate({
      id: selectedAssignmentId,
      body: {
        batchId: batchId || null,
        moduleId: moduleId || null,
        title: title.trim(),
        description: description.trim() || null,
        dueAt: dueAt ? fromISTInput(dueAt) : null,
        maxScore,
        status,
      },
    });
  };

  const handleDelete = (id: string) => {
    if (confirm("Are you sure you want to delete this assignment? All student submissions will also be deleted.")) {
      deleteMutation.mutate(id);
    }
  };

  const handleGradeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSubmission) return;

    gradeMutation.mutate({
      subId: selectedSubmission.id,
      body: {
        score: gradeScore,
        feedback: gradeFeedback.trim() || null,
        status: "GRADED",
      },
    });
  };

  const openEdit = (a: ListAssignment) => {
    setSelectedAssignmentId(a.id);
    setTitle(a.title);
    setDescription(a.description || "");
    setCourseId(a.course.id);
    setBatchId(a.batch?.id || "");
    setDueAt(toISTInput(a.dueAt));
    setMaxScore(a.maxScore);
    setStatus(a.status);
    setEditDialogOpen(true);
  };

  const openSubmissions = (id: string) => {
    setSelectedAssignmentId(id);
    setSubmissionsDialogOpen(true);
  };

  const openGrade = (sub: Submission) => {
    setSelectedSubmission(sub);
    setGradeScore(sub.score ?? 0);
    setGradeFeedback(sub.feedback || "");
    setGradeDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="LMS Assignments Manager"
        description="Create academic assignments, set deadlines, and grade student submissions."
        action={
          <Button onClick={() => setCreateDialogOpen(true)} className="bg-primary text-white text-xs font-bold">
            <Plus className="h-4 w-4 mr-1.5" /> Create Assignment
          </Button>
        }
      />

      {/* Filters block */}
      <div className="glass-card rounded-2xl p-5 border border-white/10 flex flex-wrap gap-4 items-center">
        <div className="space-y-1.5 min-w-[200px]">
          <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">
            Filter Course
          </label>
          <select
            value={courseFilter}
            onChange={(e) => setCourseFilter(e.target.value)}
            className="w-full h-9 rounded-lg border border-white/10 bg-secondary/40 text-xs text-white px-2 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5 min-w-[200px]">
          <label className="text-[10px] font-extrabold uppercase text-muted-foreground tracking-wider">
            Filter Batch
          </label>
          <select
            value={batchFilter}
            onChange={(e) => setBatchFilter(e.target.value)}
            className="w-full h-9 rounded-lg border border-white/10 bg-secondary/40 text-xs text-white px-2 focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="">All Batches</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Assignments list */}
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-20 space-y-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-xs text-muted-foreground font-semibold">Loading assignments...</p>
        </div>
      ) : assignments.length === 0 ? (
        <div className="text-center py-20 glass-card rounded-2xl border border-white/10 border-dashed">
          <BookOpen className="h-10 w-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <h3 className="text-sm font-bold text-white">No assignments found</h3>
          <p className="text-xs text-muted-foreground mt-1">Get started by creating your first course assignment.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {assignments.map((a) => (
            <div
              key={a.id}
              className="glass-card rounded-2xl p-5 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:border-white/20 transition-all"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                      a.status === "PUBLISHED"
                        ? "bg-green-500/20 text-green-400 border border-green-500/30"
                        : a.status === "CLOSED"
                        ? "bg-red-500/20 text-red-400 border border-red-500/30"
                        : "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                    }`}
                  >
                    {a.status}
                  </span>
                  <span className="text-[10px] text-muted-foreground font-semibold uppercase">{a.course.title}</span>
                </div>
                <h3 className="text-sm font-bold text-white">{a.title}</h3>
                {a.description && <p className="text-xs text-muted-foreground line-clamp-2 max-w-2xl">{a.description}</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-[10px] text-muted-foreground">
                  {a.batch && (
                    <span className="flex items-center gap-1 font-semibold">
                      🎓 Batch: {a.batch.name}
                    </span>
                  )}
                  {a.dueAt && (
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" /> Due: {formatInIST(a.dueAt)}
                    </span>
                  )}
                  <span>Max Score: {a.maxScore}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
                <Button
                  size="sm"
                  onClick={() => openSubmissions(a.id)}
                  className="bg-secondary/40 hover:bg-secondary/60 text-white text-xs font-semibold"
                >
                  Submissions ({a._count.submissions})
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openEdit(a)}
                  className="border-white/10 text-xs font-semibold"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleDelete(a.id)}
                  className="border-white/10 hover:bg-red-500/10 text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-md glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" /> Create Assignment
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Course *</label>
                <select
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                  required
                  className="w-full h-9 rounded-lg border border-white/10 bg-secondary/40 text-xs text-white px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">Select Course</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Target Batch (Optional)</label>
                <select
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  className="w-full h-9 rounded-lg border border-white/10 bg-secondary/40 text-xs text-white px-2 focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">All Batches</option>
                  {batches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Title *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Navigation & Map Reading Assignment"
                required
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Description / Instructions</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter instructions for the students..."
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white h-24"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Due Date</label>
                <Input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Maximum Score</label>
                <Input
                  type="number"
                  value={maxScore}
                  onChange={(e) => setMaxScore(parseInt(e.target.value) || 100)}
                  min={1}
                  className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Initial Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full h-9 rounded-lg border border-white/10 bg-secondary/40 text-xs text-white px-2 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="DRAFT">Draft (Invisible to students)</option>
                <option value="PUBLISHED">Published (Available immediately)</option>
                <option value="CLOSED">Closed (Deadlines passed)</option>
              </select>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} className="border-white/10 text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-primary text-white text-xs font-bold">
                {createMutation.isPending ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-primary" /> Edit Assignment
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Title *</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Description / Instructions</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white h-24"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Due Date</label>
                <Input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(e) => setDueAt(e.target.value)}
                  className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Maximum Score</label>
                <Input
                  type="number"
                  value={maxScore}
                  onChange={(e) => setMaxScore(parseInt(e.target.value) || 100)}
                  min={1}
                  className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Assignment Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as any)}
                className="w-full h-9 rounded-lg border border-white/10 bg-secondary/40 text-xs text-white px-2 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="DRAFT">Draft (Invisible to students)</option>
                <option value="PUBLISHED">Published (Available to students)</option>
                <option value="CLOSED">Closed (Deadlines passed)</option>
              </select>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => setEditDialogOpen(false)} className="border-white/10 text-xs">
                Cancel
              </Button>
              <Button type="submit" disabled={editMutation.isPending} className="bg-primary text-white text-xs font-bold">
                {editMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Submissions Dialog */}
      <Dialog open={submissionsDialogOpen} onOpenChange={setSubmissionsDialogOpen}>
        <DialogContent className="max-w-3xl glass-panel border-white/10 bg-slate-900/98 text-white max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <FileCheck className="h-5 w-5 text-primary" /> Submissions List
            </DialogTitle>
          </DialogHeader>

          {selectedAssignment ? (
            <div className="space-y-4 pt-2">
              <div className="p-3 bg-secondary/20 rounded-xl border border-white/5">
                <h4 className="text-xs font-bold text-white">{selectedAssignment.title}</h4>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Total Submissions: {selectedAssignment.submissions.length}
                </p>
              </div>

              {selectedAssignment.submissions.length === 0 ? (
                <div className="text-center py-10 border border-dashed border-white/10 rounded-xl">
                  <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
                  <p className="text-xs text-muted-foreground font-semibold">No students have submitted yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {selectedAssignment.submissions.map((sub) => (
                    <div
                      key={sub.id}
                      className="p-4 bg-secondary/15 rounded-xl border border-white/5 hover:border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <User className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs font-bold text-white">
                            {sub.student.firstName} {sub.student.lastName}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">({sub.student.email})</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          Submitted on {new Date(sub.submittedAt).toLocaleString()}
                        </div>
                        {sub.body && (
                          <div className="text-xs bg-slate-950/40 p-2.5 rounded-lg border border-white/5 font-semibold text-white/90 mt-2 whitespace-pre-line">
                            {sub.body}
                          </div>
                        )}
                        {sub.fileUrl && (
                          <div className="pt-1.5">
                            <a
                              href={sub.fileUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary font-bold hover:underline inline-flex items-center gap-1"
                            >
                              <FileText className="h-3.5 w-3.5" /> View Submitted File
                            </a>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <div className="text-right">
                          <span
                            className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                              sub.status === "GRADED"
                                ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                : "bg-blue-500/20 text-blue-400 border border-blue-500/30"
                            }`}
                          >
                            {sub.status}
                          </span>
                          {sub.status === "GRADED" && (
                            <div className="text-xs font-bold text-white mt-1">
                              Score: {sub.score} / {selectedAssignment.maxScore}
                            </div>
                          )}
                        </div>

                        <Button onClick={() => openGrade(sub)} className="bg-primary text-white text-xs font-semibold py-1.5 h-8">
                          Grade
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Grading Dialog */}
      <Dialog open={gradeDialogOpen} onOpenChange={setGradeDialogOpen}>
        <DialogContent className="max-w-sm glass-panel border-white/10 bg-slate-900/98 text-white">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" /> Grade Submission
            </DialogTitle>
          </DialogHeader>

          {selectedSubmission && (
            <form onSubmit={handleGradeSubmit} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <span className="text-xs text-muted-foreground font-semibold">Student</span>
                <div className="text-xs font-bold text-white">
                  {selectedSubmission.student.firstName} {selectedSubmission.student.lastName}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Score (Max: {selectedAssignment?.maxScore})</label>
                <Input
                  type="number"
                  value={gradeScore}
                  onChange={(e) => setGradeScore(parseInt(e.target.value) || 0)}
                  min={0}
                  max={selectedAssignment?.maxScore || 100}
                  className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Feedback</label>
                <Textarea
                  value={gradeFeedback}
                  onChange={(e) => setGradeFeedback(e.target.value)}
                  placeholder="Enter grading feedback or instructions..."
                  className="bg-secondary/40 border-white/10 text-xs font-semibold text-white h-24"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="outline" onClick={() => setGradeDialogOpen(false)} className="border-white/10 text-xs">
                  Cancel
                </Button>
                <Button type="submit" disabled={gradeMutation.isPending} className="bg-primary text-white text-xs font-bold">
                  {gradeMutation.isPending ? "Grading..." : "Submit Grade"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
