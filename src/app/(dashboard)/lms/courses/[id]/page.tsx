"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { apiFetch, isStorageUnavailable } from "@/lib/api";
import { isOverviewOnly } from "@/lib/lms/course-overview";
import { CourseOverviewDetails } from "@/components/lms/course-overview-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  ChevronRight,
  ChevronDown,
  FileText,
  Play,
  BookOpen,
  HelpCircle,
  Users,
  Megaphone,
  Eye,
  EyeOff,
  Pencil,
  Check,
  Copy,
  Upload,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Option { id: string; text: string }

interface Content { id: string; title: string; type: "PDF" | "VIDEO" | "NOTES" | "ATTACHMENT"; url: string; body?: string | null; duration?: number | null; order: number }
interface Topic { id: string; title: string; order: number; contents: Content[] }
interface Chapter { id: string; title: string; order: number; topics: Topic[] }
interface Module {
  id: string; title: string; order: number; passPercent: number; maxAttempts: number;
  quizQuestionCount?: number | null;
  randomizeQuestions?: boolean;
  chapters: Chapter[];
  _count?: { questions: number };
}
interface Stage { id: string; title: string; order: number; modules: Module[] }
interface Course {
  id: string; title: string; slug: string; description?: string | null;
  isPublished: boolean; status: string;
  metadata?: unknown;
  stages: Stage[];
}
interface Question {
  id: string; stem: string; options: Option[]; correctOptionId: string; order: number; points: number;
  difficulty?: string; negativePoints?: number;
}
interface Enrollment {
  id: string; studentId: string; status: string; enrolledAt: string;
  student: { firstName: string; lastName: string; studentCode: string; email: string };
  course: { title: string };
}
interface Student { id: string; firstName: string; lastName: string; studentCode: string; email: string }

// ─── Sortable Item ─────────────────────────────────────────────────────────

function SortableItem({
  id, children, className,
}: { id: string; children: React.ReactNode; className?: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className={cn("relative", className)}>
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="absolute left-1 top-1/2 -translate-y-1/2 cursor-grab p-1 text-muted-foreground/50 hover:text-muted-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      {children}
    </div>
  );
}

// ─── Inline Edit ───────────────────────────────────────────────────────────

function InlineEdit({
  value, onSave, className,
}: { value: string; onSave: (v: string) => void; className?: string }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  return editing ? (
    <div className="flex items-center gap-1">
      <input
        ref={ref}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { onSave(draft); setEditing(false); }
          if (e.key === "Escape") { setDraft(value); setEditing(false); }
        }}
        className={cn("rounded border border-primary bg-transparent px-1 text-sm focus:outline-none", className)}
      />
      <button type="button" onClick={() => { onSave(draft); setEditing(false); }}>
        <Check className="h-3.5 w-3.5 text-emerald-400" />
      </button>
    </div>
  ) : (
    <button
      type="button"
      onClick={() => { setDraft(value); setEditing(true); }}
      className={cn("flex items-center gap-1 rounded hover:bg-white/5 px-1 text-left text-sm font-medium", className)}
    >
      {value}
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 ml-1" />
    </button>
  );
}

// ─── Question Bank Tab ─────────────────────────────────────────────────────

function QuestionBankTab({ course }: { course: Course }) {
  const queryClient = useQueryClient();
  const [selectedModuleId, setSelectedModuleId] = React.useState<string>("");
  const [addOpen, setAddOpen] = React.useState(false);
  const [editQuestion, setEditQuestion] = React.useState<Question | null>(null);
  const [stem, setStem] = React.useState("");
  const [points, setPoints] = React.useState(1);
  const [difficulty, setDifficulty] = React.useState<"EASY" | "MEDIUM" | "HARD">("MEDIUM");
  const [negativePoints, setNegativePoints] = React.useState(0);
  const [options, setOptions] = React.useState<Option[]>([
    { id: "a", text: "" }, { id: "b", text: "" }, { id: "c", text: "" }, { id: "d", text: "" },
  ]);
  const [correctId, setCorrectId] = React.useState("a");

  const allModules = course.stages.flatMap((s) => s.modules.map((m) => ({ ...m, stageName: s.title })));

  const { data: questions, isLoading } = useQuery({
    queryKey: ["lms-questions", selectedModuleId],
    queryFn: () => apiFetch<Question[]>(`/lms/questions?moduleId=${selectedModuleId}`),
    enabled: !!selectedModuleId,
  });

  const mod = allModules.find((m) => m.id === selectedModuleId);

  function resetForm() {
    setStem(""); setPoints(1); setCorrectId("a"); setDifficulty("MEDIUM"); setNegativePoints(0);
    setOptions([{ id: "a", text: "" }, { id: "b", text: "" }, { id: "c", text: "" }, { id: "d", text: "" }]);
  }

  function openAdd() { resetForm(); setEditQuestion(null); setAddOpen(true); }

  function openEdit(q: Question) {
    setStem(q.stem); setPoints(q.points); setCorrectId(q.correctOptionId);
    setDifficulty((q.difficulty as "EASY" | "MEDIUM" | "HARD") ?? "MEDIUM");
    setNegativePoints(q.negativePoints ?? 0);
    setOptions(q.options as Option[]);
    setEditQuestion(q); setAddOpen(true);
  }

  const saveMutation = useMutation({
    mutationFn: (body: object) => editQuestion
      ? apiFetch(`/lms/questions/${editQuestion.id}`, { method: "PATCH", body: JSON.stringify(body) })
      : apiFetch("/lms/questions", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast({ title: editQuestion ? "Question updated" : "Question added" });
      setAddOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["lms-questions", selectedModuleId] });
      void queryClient.invalidateQueries({ queryKey: ["lms-course", course.id] });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (qId: string) => apiFetch(`/lms/questions/${qId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Question deleted" });
      void queryClient.invalidateQueries({ queryKey: ["lms-questions", selectedModuleId] });
      void queryClient.invalidateQueries({ queryKey: ["lms-course", course.id] });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  function handleSave() {
    const validOpts = options.filter((o) => o.text.trim());
    if (!stem.trim() || validOpts.length < 2 || !correctId) {
      toast({ title: "Validation", description: "Provide stem, at least 2 options, and correct answer", variant: "destructive" });
      return;
    }
    const body = {
      moduleId: selectedModuleId, stem, options: validOpts, correctOptionId: correctId, points,
      difficulty, negativePoints: negativePoints || undefined,
    };
    saveMutation.mutate(body);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <select
          className="h-9 rounded-lg border border-border bg-secondary/60 px-3 text-sm"
          value={selectedModuleId}
          onChange={(e) => setSelectedModuleId(e.target.value)}
        >
          <option value="">Select a module…</option>
          {allModules.map((m) => (
            <option key={m.id} value={m.id}>{m.stageName} / {m.title}</option>
          ))}
        </select>
        {selectedModuleId && (
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add question
          </Button>
        )}
        {mod && (
          <p className="text-xs text-muted-foreground ml-auto">
            Pass ≥ {mod.passPercent}% · Max {mod.maxAttempts} attempts
          </p>
        )}
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading questions…</p>}
      {!selectedModuleId && <p className="text-sm text-muted-foreground">Select a module to manage its MCQ question bank.</p>}

      <div className="space-y-2">
        {(questions ?? []).map((q, idx) => (
          <div key={q.id} className="group rounded-xl border border-border bg-card/60 p-4">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-xs font-bold text-muted-foreground">{idx + 1}.</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{q.stem}</p>
                <div className="mt-2 grid grid-cols-2 gap-1.5">
                  {(q.options as Option[]).map((opt) => (
                    <div
                      key={opt.id}
                      className={cn(
                        "rounded-md border px-2 py-1 text-xs",
                        opt.id === q.correctOptionId
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                          : "border-border text-muted-foreground",
                      )}
                    >
                      <span className="font-bold uppercase mr-1">{opt.id})</span>{opt.text}
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  {q.points} pt{q.points !== 1 ? "s" : ""}
                  {q.difficulty ? ` · ${q.difficulty}` : ""}
                  {(q.negativePoints ?? 0) > 0 ? ` · −${q.negativePoints} wrong` : ""}
                </p>
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100">
                <button type="button" onClick={() => openEdit(q)} className="rounded p-1 hover:bg-white/10">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => { if (confirm("Delete this question?")) deleteMutation.mutate(q.id); }}
                  className="rounded p-1 hover:bg-red-500/20 text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
        {selectedModuleId && !isLoading && (questions?.length ?? 0) === 0 && (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No questions yet. Add MCQ questions for this module&apos;s assessment.
          </p>
        )}
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{editQuestion ? "Edit question" : "Add question"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Question stem *</label>
              <textarea
                rows={3}
                value={stem}
                onChange={(e) => setStem(e.target.value)}
                placeholder="What is the standard cruising altitude for IFR flights in India?"
                className="mt-1 w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none focus:border-primary"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Options (mark correct with radio)</label>
              <div className="mt-1 space-y-1.5">
                {options.map((opt, i) => (
                  <div key={opt.id} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correct"
                      checked={correctId === opt.id}
                      onChange={() => setCorrectId(opt.id)}
                      className="accent-[#c8102e]"
                    />
                    <span className="w-4 text-xs font-bold uppercase text-muted-foreground">{opt.id})</span>
                    <Input
                      value={opt.text}
                      onChange={(e) => {
                        const updated = [...options];
                        updated[i] = { ...opt, text: e.target.value };
                        setOptions(updated);
                      }}
                      placeholder={`Option ${opt.id.toUpperCase()}`}
                      className="h-8 text-sm"
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Points</label>
                <Input
                  type="number" min={1} value={points}
                  onChange={(e) => setPoints(Number(e.target.value))}
                  className="h-8 w-20 text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Difficulty</label>
                <select
                  className="h-8 rounded-lg border border-border bg-secondary/60 px-2 text-sm"
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value as "EASY" | "MEDIUM" | "HARD")}
                >
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">Negative pts</label>
                <Input
                  type="number" min={0} value={negativePoints}
                  onChange={(e) => setNegativePoints(Number(e.target.value))}
                  className="h-8 w-20 text-sm"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? "Saving…" : editQuestion ? "Update" : "Add question"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Enrollments Tab ───────────────────────────────────────────────────────

function EnrollmentsTab({ course }: { course: Course }) {
  const queryClient = useQueryClient();
  const [studentSearch, setStudentSearch] = React.useState("");
  const [selectedStudentId, setSelectedStudentId] = React.useState("");

  const { data: enrollments } = useQuery({
    queryKey: ["lms-enrollments", course.id],
    queryFn: () => apiFetch<Enrollment[]>(`/lms/enrollments?courseId=${course.id}`),
  });

  const { data: students } = useQuery({
    queryKey: ["students-list"],
    queryFn: () => apiFetch<Student[]>("/students?limit=200"),
  });

  const enrollMutation = useMutation({
    mutationFn: () => apiFetch("/lms/enrollments", { method: "POST", body: JSON.stringify({ studentId: selectedStudentId, courseId: course.id }) }),
    onSuccess: () => {
      toast({ title: "Student enrolled" });
      setSelectedStudentId("");
      void queryClient.invalidateQueries({ queryKey: ["lms-enrollments", course.id] });
    },
    onError: (err: Error) => toast({ title: "Enroll failed", description: err.message, variant: "destructive" }),
  });

  const unenrollMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/enrollments/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Student unenrolled" });
      void queryClient.invalidateQueries({ queryKey: ["lms-enrollments", course.id] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to unenroll student", description: err.message, variant: "destructive" });
    },
  });

  const filtered = (students ?? []).filter((s) => {
    const q = studentSearch.toLowerCase();
    return !q || s.firstName.toLowerCase().includes(q) || s.lastName.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) || s.studentCode.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card/60 p-4">
        <h3 className="mb-3 text-sm font-semibold">Enroll a student</h3>
        <div className="flex gap-2">
          <Input
            placeholder="Search student by name, email or code…"
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            className="flex-1"
          />
        </div>
        {studentSearch && (
          <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border bg-secondary/30">
            {filtered.slice(0, 10).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSelectedStudentId(s.id); setStudentSearch(`${s.firstName} ${s.lastName} (${s.studentCode})`); }}
                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-white/10"
              >
                <div>
                  <p className="font-medium">{s.firstName} {s.lastName}</p>
                  <p className="text-xs text-muted-foreground">{s.email} · {s.studentCode}</p>
                </div>
              </button>
            ))}
            {filtered.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No students found.</p>}
          </div>
        )}
        <Button
          className="mt-3"
          disabled={!selectedStudentId || enrollMutation.isPending}
          onClick={() => enrollMutation.mutate()}
        >
          <Users className="mr-1.5 h-3.5 w-3.5" />
          Enroll
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-card/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Student</th>
              <th className="px-3 py-2">Code</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Enrolled</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(enrollments ?? []).map((e) => (
              <tr key={e.id} className="border-t border-border hover:bg-white/[0.02]">
                <td className="px-3 py-2">
                  {e.student.firstName} {e.student.lastName}
                  <div className="text-xs text-muted-foreground">{e.student.email}</div>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">{e.student.studentCode}</td>
                <td className="px-3 py-2">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                    e.status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-400" : "bg-muted text-muted-foreground"
                  )}>{e.status}</span>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {new Date(e.enrolledAt).toLocaleDateString("en-IN")}
                </td>
                <td className="px-3 py-2 text-right">
                  {e.status === "ACTIVE" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={unenrollMutation.isPending}
                      onClick={() => {
                        if (confirm("Are you sure you want to soft-unenroll this student? Their progress history will be preserved but they will lose course portal access.")) {
                          unenrollMutation.mutate(e.id);
                        }
                      }}
                      className="h-7 text-xs border-white/10 hover:bg-red-500/10 text-red-400"
                    >
                      Unenroll
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {(enrollments?.length ?? 0) === 0 && (
              <tr><td colSpan={5} className="px-3 py-8 text-center text-sm text-muted-foreground">No enrollments yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Content List for a Topic ──────────────────────────────────────────────

function ContentManager({ topic, courseId }: { topic: Topic; courseId: string }) {
  const queryClient = useQueryClient();
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [type, setType] = React.useState<"PDF" | "VIDEO" | "NOTES" | "ATTACHMENT">("PDF");
  const [url, setUrl] = React.useState("");
  const [body, setBody] = React.useState("");
  const [duration, setDuration] = React.useState("");
  const [uploading, setUploading] = React.useState(false);

  const addMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/lms/topics/${topic.id}/contents`, {
        method: "POST",
        body: JSON.stringify({
          title,
          type,
          url: url || "#",
          body: type === "NOTES" ? body || null : null,
          duration: duration ? Number(duration) : null,
        }),
      }),
    onSuccess: () => {
      toast({ title: "Content added" });
      setOpen(false); setTitle(""); setUrl(""); setBody(""); setDuration("");
      void queryClient.invalidateQueries({ queryKey: ["lms-course", courseId] });
    },
    onError: (err: Error) => toast({ title: "Add content failed", description: err.message, variant: "destructive" }),
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const { uploadUrl, fileKey, fileUrl } = await apiFetch<{ uploadUrl: string; fileKey: string; fileUrl: string }>("/media/presign", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type, size: file.size }),
      });
      const uploadRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!uploadRes.ok) throw new Error("Upload failed");
      setUrl(fileUrl);
      if (!title) setTitle(file.name);
      toast({ title: "File uploaded" });
    } catch (err) {
      toast({
        title: "Upload failed",
        description: isStorageUnavailable(err)
          ? "Media storage is not configured"
          : err instanceof Error
            ? err.message
            : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const deleteMutation = useMutation({
    mutationFn: (contentId: string) => apiFetch(`/lms/contents/${contentId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Content removed" });
      void queryClient.invalidateQueries({ queryKey: ["lms-course", courseId] });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const typeIcon = { PDF: FileText, VIDEO: Play, NOTES: BookOpen, ATTACHMENT: FileText };

  return (
    <div className="mt-1 space-y-1 pl-4">
      {topic.contents.map((c) => {
        const Icon = typeIcon[c.type];
        return (
          <div key={c.id} className="group flex items-center gap-2 rounded-md bg-black/20 px-2 py-1.5 text-xs">
            <Icon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
            <span className="flex-1 truncate text-white/80">{c.title}</span>
            <span className="text-muted-foreground/50 uppercase">{c.type}</span>
            <a href={c.url} target="_blank" rel="noreferrer" className="opacity-0 group-hover:opacity-60 text-primary hover:opacity-100">
              <Eye className="h-3 w-3" />
            </a>
            <button
              type="button"
              onClick={() => { if (confirm(`Remove "${c.title}"?`)) deleteMutation.mutate(c.id); }}
              className="opacity-0 group-hover:opacity-60 text-red-400 hover:opacity-100"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-white/5 hover:text-white"
      >
        <Plus className="h-3 w-3" /> Add content
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add content to &quot;{topic.title}&quot;</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <select
              className="h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm"
              value={type}
              onChange={(e) => setType(e.target.value as "PDF" | "VIDEO" | "NOTES" | "ATTACHMENT")}
            >
              <option value="PDF">PDF</option>
              <option value="VIDEO">Video</option>
              <option value="NOTES">Notes</option>
              <option value="ATTACHMENT">Attachment</option>
            </select>
            {(type === "PDF" || type === "VIDEO" || type === "ATTACHMENT") && (
              <>
                <Input
                  placeholder="URL (presigned S3 or direct link)"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <input ref={fileInputRef} type="file" className="hidden" onChange={handleFileUpload} />
                  <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileInputRef.current?.click()}>
                    <Upload className="mr-1.5 h-3.5 w-3.5" />
                    {uploading ? "Uploading…" : "Upload file"}
                  </Button>
                  {url && <span className="text-xs text-muted-foreground truncate">URL set</span>}
                </div>
              </>
            )}
            {type === "NOTES" && (
              <textarea
                rows={4}
                placeholder="Notes body (optional - can also use URL)"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none"
              />
            )}
            {type === "VIDEO" && (
              <Input
                type="number" placeholder="Duration (seconds, optional)"
                value={duration} onChange={(e) => setDuration(e.target.value)}
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!title || (type === "NOTES" ? !body && !url : !url) || addMutation.isPending}
              onClick={() => addMutation.mutate()}
            >
              {addMutation.isPending ? "Saving…" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Curriculum Tree Tab ───────────────────────────────────────────────────

function CurriculumTab({ course }: { course: Course }) {
  const queryClient = useQueryClient();
  const courseId = course.id;
  const [expandedModules, setExpandedModules] = React.useState<Set<string>>(new Set());
  const [addingStage, setAddingStage] = React.useState(false);
  const [stageTitle, setStageTitle] = React.useState("");
  const [addingModuleFor, setAddingModuleFor] = React.useState<string | null>(null);
  const [moduleTitle, setModuleTitle] = React.useState("");
  const [passPercent, setPassPercent] = React.useState(70);
  const [maxAttempts, setMaxAttempts] = React.useState(3);
  const [addingChapterFor, setAddingChapterFor] = React.useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = React.useState("");
  const [addingTopicFor, setAddingTopicFor] = React.useState<string | null>(null);
  const [topicTitle, setTopicTitle] = React.useState("");
  const [settingsModule, setSettingsModule] = React.useState<Module | null>(null);
  const [quizQuestionCount, setQuizQuestionCount] = React.useState<number | "">("");
  const [randomizeQuestions, setRandomizeQuestions] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [importJson, setImportJson] = React.useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["lms-course", courseId] });

  // ─ Stage mutations
  const addStage = useMutation({
    mutationFn: () => apiFetch(`/lms/stages`, { method: "POST", body: JSON.stringify({ courseId, title: stageTitle }) }),
    onSuccess: () => { toast({ title: "Stage added" }); setAddingStage(false); setStageTitle(""); void invalidate(); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const deleteStage = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/stages/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Stage deleted" }); void invalidate(); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const renameStage = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => apiFetch(`/lms/stages/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    onSuccess: () => void invalidate(),
  });
  const reorderStages = useMutation({
    mutationFn: (items: { id: string; order: number }[]) => apiFetch(`/lms/stages`, { method: "PATCH", body: JSON.stringify({ courseId, items }) }),
    onSuccess: () => void invalidate(),
  });

  // ─ Module mutations
  const addModule = useMutation({
    mutationFn: () => apiFetch(`/lms/modules`, { method: "POST", body: JSON.stringify({ stageId: addingModuleFor, title: moduleTitle, passPercent, maxAttempts }) }),
    onSuccess: () => { toast({ title: "Module added" }); setAddingModuleFor(null); setModuleTitle(""); void invalidate(); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const deleteModule = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/modules/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Module deleted" }); void invalidate(); },
  });
  const renameModule = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => apiFetch(`/lms/modules/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    onSuccess: () => void invalidate(),
  });
  const duplicateModule = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/modules/${id}/duplicate`, { method: "POST" }),
    onSuccess: () => { toast({ title: "Module duplicated" }); void invalidate(); },
    onError: (err: Error) => toast({ title: "Duplicate failed", description: err.message, variant: "destructive" }),
  });
  const updateModuleSettings = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) =>
      apiFetch(`/lms/modules/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
    onSuccess: () => {
      toast({ title: "Module settings saved" });
      setSettingsModule(null);
      void invalidate();
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });
  const importMutation = useMutation({
    mutationFn: (payload: object) =>
      apiFetch(`/lms/courses/${courseId}/import`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => {
      toast({ title: "Curriculum imported" });
      setImportOpen(false);
      setImportJson("");
      void invalidate();
    },
    onError: (err: Error) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  // ─ Chapter mutations
  const addChapter = useMutation({
    mutationFn: () => apiFetch(`/lms/chapters`, { method: "POST", body: JSON.stringify({ moduleId: addingChapterFor, title: chapterTitle }) }),
    onSuccess: () => { toast({ title: "Chapter added" }); setAddingChapterFor(null); setChapterTitle(""); void invalidate(); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const deleteChapter = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/chapters/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Chapter deleted" }); void invalidate(); },
  });
  const renameChapter = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => apiFetch(`/lms/chapters/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    onSuccess: () => void invalidate(),
  });

  // ─ Topic mutations
  const addTopic = useMutation({
    mutationFn: () => apiFetch(`/lms/topics`, { method: "POST", body: JSON.stringify({ chapterId: addingTopicFor, title: topicTitle }) }),
    onSuccess: () => { toast({ title: "Topic added" }); setAddingTopicFor(null); setTopicTitle(""); void invalidate(); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const deleteTopic = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/topics/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast({ title: "Topic deleted" }); void invalidate(); },
  });
  const renameTopic = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => apiFetch(`/lms/topics/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
    onSuccess: () => void invalidate(),
  });

  function toggleModule(id: string) {
    setExpandedModules((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function handleStageReorder(stageId: string, event: DragEndEvent) {
    const stage = course.stages.find((s) => s.id === stageId);
    if (!stage) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Reorder modules within stage
    const oldIdx = stage.modules.findIndex((m) => m.id === active.id);
    const newIdx = stage.modules.findIndex((m) => m.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = [...stage.modules];
    const [item] = reordered.splice(oldIdx, 1);
    if (item) reordered.splice(newIdx, 0, item);
    const items = reordered.map((m, i) => ({ id: m.id, order: i }));
    apiFetch(`/lms/modules`, { method: "PATCH", body: JSON.stringify({ stageId, items }) })
      .then(() => void invalidate())
      .catch(() => {});
  }

  function handleTopReorder(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = course.stages.findIndex((s) => s.id === active.id);
    const newIdx = course.stages.findIndex((s) => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = [...course.stages];
    const [item] = reordered.splice(oldIdx, 1);
    if (item) reordered.splice(newIdx, 0, item);
    const items = reordered.map((s, i) => ({ id: s.id, order: i }));
    reorderStages.mutate(items);
  }

  function openModuleSettings(mod: Module) {
    setSettingsModule(mod);
    setQuizQuestionCount(mod.quizQuestionCount ?? "");
    setRandomizeQuestions(mod.randomizeQuestions ?? false);
  }

  function handleImport() {
    try {
      const payload = JSON.parse(importJson) as object;
      importMutation.mutate(payload);
    } catch {
      toast({ title: "Invalid JSON", description: "Check your import payload format.", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>
          Bulk import JSON
        </Button>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleTopReorder}>
        <SortableContext items={course.stages.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          {course.stages.map((stage) => (
            <SortableItem key={stage.id} id={stage.id}>
              <div className="ml-5 rounded-xl border border-border bg-card/60">
                {/* Stage Header */}
                <div className="group flex items-center gap-2 rounded-t-xl border-b border-border bg-card/80 px-3 py-2">
                  <BookOpen className="h-3.5 w-3.5 text-primary shrink-0" />
                  <div className="flex-1 group">
                    <InlineEdit value={stage.title} onSave={(t) => renameStage.mutate({ id: stage.id, title: t })} />
                  </div>
                  <span className="text-[10px] text-muted-foreground">{stage.modules.length} modules</span>
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Delete stage "${stage.title}" and ALL its content?`)) deleteStage.mutate(stage.id); }}
                    className="opacity-0 group-hover:opacity-60 rounded p-1 text-red-400 hover:bg-red-500/10 hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* Modules */}
                <div className="p-2 space-y-2">
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => handleStageReorder(stage.id, e)}>
                    <SortableContext items={stage.modules.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                      {stage.modules.map((mod) => {
                        const expanded = expandedModules.has(mod.id);
                        return (
                          <SortableItem key={mod.id} id={mod.id}>
                            <div className="ml-5 rounded-lg border border-border/60 bg-background/40">
                              {/* Module Header */}
                              <div className="group flex items-center gap-2 px-3 py-2">
                                <button type="button" onClick={() => toggleModule(mod.id)} className="text-muted-foreground/60 hover:text-muted-foreground">
                                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                                </button>
                                <div className="flex-1 group">
                                  <InlineEdit value={mod.title} onSave={(t) => renameModule.mutate({ id: mod.id, title: t })} />
                                </div>
                                <span className="text-[10px] text-muted-foreground">{mod.passPercent}% pass · {mod._count?.questions ?? 0} Qs</span>
                                <button
                                  type="button"
                                  title="Duplicate module"
                                  onClick={() => duplicateModule.mutate(mod.id)}
                                  className="opacity-0 group-hover:opacity-60 rounded p-1 text-muted-foreground hover:bg-white/10 hover:opacity-100"
                                >
                                  <Copy className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  title="Module settings"
                                  onClick={() => openModuleSettings(mod)}
                                  className="opacity-0 group-hover:opacity-60 rounded p-1 text-muted-foreground hover:bg-white/10 hover:opacity-100"
                                >
                                  <Settings className="h-3 w-3" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { if (confirm(`Delete module "${mod.title}"?`)) deleteModule.mutate(mod.id); }}
                                  className="opacity-0 group-hover:opacity-60 rounded p-1 text-red-400 hover:bg-red-500/10 hover:opacity-100"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>

                              {/* Chapters */}
                              {expanded && (
                                <div className="px-3 pb-2 space-y-2 border-t border-border/30 pt-2">
                                  {mod.chapters.map((ch) => (
                                    <div key={ch.id} className="rounded-md border border-border/40 bg-background/30">
                                      <div className="group flex items-center gap-2 px-2 py-1.5">
                                        <div className="flex-1 group">
                                          <InlineEdit
                                            value={ch.title}
                                            onSave={(t) => renameChapter.mutate({ id: ch.id, title: t })}
                                            className="text-xs"
                                          />
                                        </div>
                                        <span className="text-[10px] text-muted-foreground">{ch.topics.length} topics</span>
                                        <button
                                          type="button"
                                          onClick={() => { if (confirm(`Delete chapter "${ch.title}"?`)) deleteChapter.mutate(ch.id); }}
                                          className="opacity-0 group-hover:opacity-50 text-red-400 hover:opacity-100"
                                        >
                                          <Trash2 className="h-3 w-3" />
                                        </button>
                                      </div>
                                      {/* Topics */}
                                      <div className="px-2 pb-2 space-y-1">
                                        {ch.topics.map((topic) => (
                                          <div key={topic.id} className="rounded border border-border/30 bg-black/10">
                                            <div className="group flex items-center gap-2 px-2 py-1">
                                              <div className="flex-1 group">
                                                <InlineEdit
                                                  value={topic.title}
                                                  onSave={(t) => renameTopic.mutate({ id: topic.id, title: t })}
                                                  className="text-[11px]"
                                                />
                                              </div>
                                              <span className="text-[10px] text-muted-foreground">{topic.contents.length} files</span>
                                              <button
                                                type="button"
                                                onClick={() => { if (confirm(`Delete topic "${topic.title}"?`)) deleteTopic.mutate(topic.id); }}
                                                className="opacity-0 group-hover:opacity-50 text-red-400 hover:opacity-100"
                                              >
                                                <Trash2 className="h-3 w-3" />
                                              </button>
                                            </div>
                                            <ContentManager topic={topic} courseId={courseId} />
                                          </div>
                                        ))}
                                        {/* Add topic inline */}
                                        {addingTopicFor === ch.id ? (
                                          <div className="flex items-center gap-1 pl-2">
                                            <Input
                                              className="h-7 text-xs flex-1"
                                              placeholder="Topic title…"
                                              value={topicTitle}
                                              onChange={(e) => setTopicTitle(e.target.value)}
                                              onKeyDown={(e) => {
                                                if (e.key === "Enter") addTopic.mutate();
                                                if (e.key === "Escape") { setAddingTopicFor(null); setTopicTitle(""); }
                                              }}
                                              autoFocus
                                            />
                                            <Button size="sm" className="h-7" disabled={!topicTitle || addTopic.isPending} onClick={() => addTopic.mutate()}>Add</Button>
                                            <Button size="sm" variant="ghost" className="h-7" onClick={() => { setAddingTopicFor(null); setTopicTitle(""); }}>✕</Button>
                                          </div>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => { setAddingTopicFor(ch.id); setTopicTitle(""); }}
                                            className="flex items-center gap-1 pl-2 py-0.5 text-[11px] text-muted-foreground hover:text-white"
                                          >
                                            <Plus className="h-3 w-3" /> Add topic
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                  {/* Add chapter inline */}
                                  {addingChapterFor === mod.id ? (
                                    <div className="flex items-center gap-1">
                                      <Input
                                        className="h-7 text-xs flex-1"
                                        placeholder="Chapter title…"
                                        value={chapterTitle}
                                        onChange={(e) => setChapterTitle(e.target.value)}
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") addChapter.mutate();
                                          if (e.key === "Escape") { setAddingChapterFor(null); setChapterTitle(""); }
                                        }}
                                        autoFocus
                                      />
                                      <Button size="sm" className="h-7" disabled={!chapterTitle || addChapter.isPending} onClick={() => addChapter.mutate()}>Add</Button>
                                      <Button size="sm" variant="ghost" className="h-7" onClick={() => { setAddingChapterFor(null); setChapterTitle(""); }}>✕</Button>
                                    </div>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => { setAddingChapterFor(mod.id); setChapterTitle(""); }}
                                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-white py-1"
                                    >
                                      <Plus className="h-3 w-3" /> Add chapter
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          </SortableItem>
                        );
                      })}
                    </SortableContext>
                  </DndContext>

                  {/* Add module inline */}
                  {addingModuleFor === stage.id ? (
                    <div className="ml-5 space-y-1.5 rounded-lg border border-dashed border-primary/40 p-3">
                      <Input className="h-8 text-sm" placeholder="Module title…" value={moduleTitle} onChange={(e) => setModuleTitle(e.target.value)} autoFocus />
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[10px] text-muted-foreground">Pass %</label>
                          <Input type="number" className="h-7 text-xs" value={passPercent} min={0} max={100} onChange={(e) => setPassPercent(Number(e.target.value))} />
                        </div>
                        <div className="flex-1">
                          <label className="text-[10px] text-muted-foreground">Max attempts</label>
                          <Input type="number" className="h-7 text-xs" value={maxAttempts} min={1} onChange={(e) => setMaxAttempts(Number(e.target.value))} />
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button size="sm" className="h-7" disabled={!moduleTitle || addModule.isPending} onClick={() => addModule.mutate()}>Add module</Button>
                        <Button size="sm" variant="ghost" className="h-7" onClick={() => { setAddingModuleFor(null); setModuleTitle(""); }}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setAddingModuleFor(stage.id); setModuleTitle(""); setPassPercent(70); setMaxAttempts(3); }}
                      className="ml-5 flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-white/5 hover:text-white"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add module
                    </button>
                  )}
                </div>
              </div>
            </SortableItem>
          ))}
        </SortableContext>
      </DndContext>

      {/* Add stage inline */}
      {addingStage ? (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-primary/50 p-3">
          <Input
            className="flex-1"
            placeholder="Stage title e.g. Stage 1: Fundamentals"
            value={stageTitle}
            onChange={(e) => setStageTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") addStage.mutate();
              if (e.key === "Escape") { setAddingStage(false); setStageTitle(""); }
            }}
            autoFocus
          />
          <Button disabled={!stageTitle || addStage.isPending} onClick={() => addStage.mutate()}>Add stage</Button>
          <Button variant="ghost" onClick={() => { setAddingStage(false); setStageTitle(""); }}>Cancel</Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setAddingStage(true); setStageTitle(""); }}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground hover:border-primary/50 hover:text-white w-full"
        >
          <Plus className="h-4 w-4" /> Add Stage
        </button>
      )}

      <Dialog open={!!settingsModule} onOpenChange={(v) => !v && setSettingsModule(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Module settings - {settingsModule?.title}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Quiz question count (random subset)</label>
              <Input
                type="number"
                min={1}
                placeholder="All questions"
                className="mt-1"
                value={quizQuestionCount}
                onChange={(e) => setQuizQuestionCount(e.target.value ? Number(e.target.value) : "")}
              />
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={randomizeQuestions}
                onChange={(e) => setRandomizeQuestions(e.target.checked)}
                className="accent-[#c8102e]"
              />
              Randomize question order
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSettingsModule(null)}>Cancel</Button>
            <Button
              disabled={updateModuleSettings.isPending}
              onClick={() => {
                if (!settingsModule) return;
                updateModuleSettings.mutate({
                  id: settingsModule.id,
                  data: {
                    quizQuestionCount: quizQuestionCount === "" ? null : Number(quizQuestionCount),
                    randomizeQuestions,
                  },
                });
              }}
            >
              Save settings
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Bulk import curriculum</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Paste JSON with <code className="text-primary">{"{ stages: [...] }"}</code> structure. Stages are appended to the course.
          </p>
          <textarea
            rows={12}
            value={importJson}
            onChange={(e) => setImportJson(e.target.value)}
            placeholder='{"stages":[{"title":"Stage 1","modules":[{"title":"Module 1","chapters":[]}]}]}'
            className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs font-mono focus:outline-none"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>Cancel</Button>
            <Button disabled={!importJson.trim() || importMutation.isPending} onClick={handleImport}>
              {importMutation.isPending ? "Importing…" : "Import"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Announcements Tab ─────────────────────────────────────────────────────

function AnnouncementsTab({ course }: { course: Course }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [annoTitle, setAnnoTitle] = React.useState("");
  const [annoBody, setAnnoBody] = React.useState("");

  const { data: announcements } = useQuery({
    queryKey: ["lms-announcements", course.id],
    queryFn: () => apiFetch<Array<{ id: string; title: string; body: string; publishedAt: string | null; createdAt: string }>>(`/lms/announcements?courseId=${course.id}`),
  });

  const addMutation = useMutation({
    mutationFn: () => apiFetch("/lms/announcements", { method: "POST", body: JSON.stringify({ title: annoTitle, body: annoBody, courseId: course.id, publishedAt: new Date().toISOString() }) }),
    onSuccess: () => {
      toast({ title: "Announcement posted" });
      setOpen(false); setAnnoTitle(""); setAnnoBody("");
      void queryClient.invalidateQueries({ queryKey: ["lms-announcements", course.id] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Button size="sm" onClick={() => setOpen(true)}>
        <Megaphone className="mr-1.5 h-3.5 w-3.5" /> New announcement
      </Button>
      <div className="space-y-2">
        {(announcements ?? []).map((a) => (
          <div key={a.id} className="rounded-xl border border-border bg-card/60 p-4">
            <p className="font-medium">{a.title}</p>
            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">{a.body}</p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {a.publishedAt ? new Date(a.publishedAt).toLocaleString("en-IN") : "Draft"}
            </p>
          </div>
        ))}
        {(announcements?.length ?? 0) === 0 && (
          <p className="text-sm text-muted-foreground">No announcements yet. Post one to notify enrolled students.</p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Post announcement</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Input placeholder="Title" value={annoTitle} onChange={(e) => setAnnoTitle(e.target.value)} />
            <textarea
              rows={4}
              value={annoBody}
              onChange={(e) => setAnnoBody(e.target.value)}
              placeholder="Announcement body…"
              className="w-full rounded-lg border border-border bg-secondary/40 px-3 py-2 text-sm focus:outline-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!annoTitle || !annoBody || addMutation.isPending} onClick={() => addMutation.mutate()}>Post</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────

export default function LmsCourseBuilderPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const courseId = params.id;

  const { data: course, isLoading, isError, refetch } = useQuery({
    queryKey: ["lms-course", courseId],
    queryFn: () => apiFetch<Course>(`/lms/courses/${courseId}`),
  });

  const publishMutation = useMutation({
    mutationFn: (isPublished: boolean) =>
      apiFetch(`/lms/courses/${courseId}`, { method: "PATCH", body: JSON.stringify({ isPublished }) }),
    onSuccess: () => {
      toast({ title: course?.isPublished ? "Course unpublished" : "Course published" });
      void queryClient.invalidateQueries({ queryKey: ["lms-course", courseId] });
      void queryClient.invalidateQueries({ queryKey: ["lms-courses"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 rounded-lg bg-card/60" />
        <div className="h-4 w-64 rounded bg-card/40" />
        <div className="h-64 rounded-xl bg-card/40" />
      </div>
    );
  }

  if (isError || !course) {
    return (
      <div className="rounded-xl border border-destructive/40 p-4 text-sm">
        Failed to load course.{" "}
        <button type="button" className="underline" onClick={() => void refetch()}>Retry</button>
      </div>
    );
  }

  if (isOverviewOnly(course)) {
    return (
      <div className="space-y-6" data-testid="lms-course-overview-detail">
        <div className="flex items-start gap-4">
          <button type="button" onClick={() => router.push("/lms")} className="mt-1 rounded-md p-1.5 hover:bg-white/10" aria-label="Back to LMS courses">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <h1 className="text-2xl font-semibold text-white truncate">{course.title}</h1>
        </div>
        <div className="rounded-xl border border-border bg-card/60 p-4">
          <CourseOverviewDetails title={course.title} description={course.description} metadata={course.metadata} />
        </div>
      </div>
    );
  }

  const totalTopics = course.stages.flatMap((s) => s.modules.flatMap((m) => m.chapters.flatMap((c) => c.topics))).length;
  const totalContent = course.stages.flatMap((s) => s.modules.flatMap((m) => m.chapters.flatMap((c) => c.topics.flatMap((t) => t.contents)))).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button type="button" onClick={() => router.push("/lms")} className="mt-1 rounded-md p-1.5 hover:bg-white/10">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-semibold text-white truncate">{course.title}</h1>
            <span className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              course.isPublished ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400",
            )}>
              {course.isPublished ? "Published" : "Draft"}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            /{course.slug} · {course.stages.length} stages · {totalTopics} topics · {totalContent} content files
          </p>
        </div>
        <Button
          variant={course.isPublished ? "outline" : "default"}
          size="sm"
          disabled={publishMutation.isPending}
          onClick={() => publishMutation.mutate(!course.isPublished)}
        >
          {course.isPublished ? (
            <><EyeOff className="mr-1.5 h-3.5 w-3.5" /> Unpublish</>
          ) : (
            <><Eye className="mr-1.5 h-3.5 w-3.5" /> Publish</>
          )}
        </Button>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="curriculum">
        <TabsList className="h-9">
          <TabsTrigger value="curriculum" className="text-xs">
            <BookOpen className="mr-1.5 h-3.5 w-3.5" /> Curriculum
          </TabsTrigger>
          <TabsTrigger value="questions" className="text-xs">
            <HelpCircle className="mr-1.5 h-3.5 w-3.5" /> Questions
          </TabsTrigger>
          <TabsTrigger value="enrollments" className="text-xs">
            <Users className="mr-1.5 h-3.5 w-3.5" /> Enrollments
          </TabsTrigger>
          <TabsTrigger value="announcements" className="text-xs">
            <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Announcements
          </TabsTrigger>
        </TabsList>

        <TabsContent value="curriculum" className="mt-4">
          <CurriculumTab course={course} />
        </TabsContent>

        <TabsContent value="questions" className="mt-4">
          <QuestionBankTab course={course} />
        </TabsContent>

        <TabsContent value="enrollments" className="mt-4">
          <EnrollmentsTab course={course} />
        </TabsContent>

        <TabsContent value="announcements" className="mt-4">
          <AnnouncementsTab course={course} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
