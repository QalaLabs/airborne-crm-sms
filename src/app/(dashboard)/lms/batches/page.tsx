"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Plus, Users, GraduationCap, X } from "lucide-react";
import {
  BATCH_FREQUENCIES,
  FREQUENCY_LABELS,
  dateInputToIso,
  scheduleError,
  scheduleSummary,
} from "@/lib/lms/batch-schedule";

interface LmsCourse { id: string; title: string }
interface BatchRow {
  id: string;
  name: string;
  type: string;
  courseId: string;
  startDate?: string | null;
  endDate?: string | null;
  metadata?: unknown;
  course: { id: string; title: string };
  _count: { students: number; teachers: number; timetableSlots: number };
  teachers: Array<{ teacher: { id: string; name: string; email: string } }>;
}
interface BatchDetail extends BatchRow {
  students: Array<{ student: { id: string; firstName: string; lastName: string; studentCode: string; email: string } }>;
}
interface Student { id: string; firstName: string; lastName: string; studentCode: string; email: string }
interface UserRow { id: string; name: string; email: string; role: string }

const BATCH_TYPES = ["MORNING", "EVENING", "WEEKEND", "CUSTOM"] as const;

const FREQUENCIES = BATCH_FREQUENCIES.map((value) => ({ value, label: FREQUENCY_LABELS[value] }));

export default function LmsBatchesPage() {
  const queryClient = useQueryClient();
  const [courseFilter, setCourseFilter] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [courseId, setCourseId] = React.useState("");
  const [type, setType] = React.useState<(typeof BATCH_TYPES)[number]>("MORNING");
  const [frequency, setFrequency] = React.useState("");
  const [startTime, setStartTime] = React.useState("");
  const [endTime, setEndTime] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const formError = scheduleError({
    startTime: startTime || null,
    endTime: endTime || null,
    startDate: dateInputToIso(startDate),
    endDate: dateInputToIso(endDate),
  });
  const [selectedStudentIds, setSelectedStudentIds] = React.useState<string[]>([]);
  const [selectedTeacherIds, setSelectedTeacherIds] = React.useState<string[]>([]);
  const [teacherUuidInput, setTeacherUuidInput] = React.useState("");

  const { data: courses } = useQuery({
    queryKey: ["lms-courses"],
    queryFn: () => apiFetch<LmsCourse[]>("/lms/courses"),
  });

  const { data: batches, isLoading } = useQuery({
    queryKey: ["lms-batches", courseFilter],
    queryFn: () => apiFetch<BatchRow[]>(`/lms/batches${courseFilter ? `?courseId=${courseFilter}` : ""}`),
  });

  const { data: batchDetail } = useQuery({
    queryKey: ["lms-batch", selectedId],
    queryFn: () => apiFetch<BatchDetail>(`/lms/batches/${selectedId}`),
    enabled: !!selectedId,
  });

  const { data: students } = useQuery({
    queryKey: ["students-list"],
    queryFn: () => apiFetch<Student[]>("/students?limit=200"),
  });

  const { data: teachersRaw } = useQuery({
    queryKey: ["users-teachers"],
    queryFn: async () => {
      const res = await fetch("/api/v1/users?role=TEACHER&limit=100", { credentials: "include" });
      if (!res.ok) return [] as UserRow[];
      const json = await res.json() as { data: UserRow[] };
      return json.data ?? [];
    },
  });

  React.useEffect(() => {
    if (batchDetail) {
      setSelectedStudentIds(batchDetail.students.map((s) => s.student.id));
      setSelectedTeacherIds(batchDetail.teachers.map((t) => t.teacher.id));
    }
  }, [batchDetail]);

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("/lms/batches", {
        method: "POST",
        body: JSON.stringify({
          courseId,
          name,
          type,
          startDate: dateInputToIso(startDate),
          endDate: dateInputToIso(endDate),
          schedule: {
            frequency: frequency || null,
            startTime: startTime || null,
            endTime: endTime || null,
          },
        }),
      }),
    onSuccess: () => {
      toast({ title: "Batch created" });
      setCreateOpen(false);
      setName("");
      setCourseId("");
      setFrequency("");
      setStartTime("");
      setEndTime("");
      setStartDate("");
      setEndDate("");
      void queryClient.invalidateQueries({ queryKey: ["lms-batches"] });
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const membersMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/lms/batches/${selectedId}/members`, {
        method: "PUT",
        body: JSON.stringify({ studentIds: selectedStudentIds, teacherIds: selectedTeacherIds }),
      }),
    onSuccess: () => {
      toast({ title: "Members updated" });
      void queryClient.invalidateQueries({ queryKey: ["lms-batch", selectedId] });
      void queryClient.invalidateQueries({ queryKey: ["lms-batches"] });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  function toggleStudent(id: string) {
    setSelectedStudentIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function toggleTeacher(id: string) {
    setSelectedTeacherIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  function addTeacherUuid() {
    const id = teacherUuidInput.trim();
    if (!id) return;
    if (!selectedTeacherIds.includes(id)) setSelectedTeacherIds((prev) => [...prev, id]);
    setTeacherUuidInput("");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Batches"
        description="Manage course batches, assign students and teachers."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New batch
          </Button>
        }
      />

      <div className="max-w-xs">
        <label className="text-xs text-muted-foreground">Filter by course</label>
        <select
          className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm"
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
        >
          <option value="">All courses</option>
          {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {(batches ?? []).map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setSelectedId(b.id)}
              className={cn(
                "w-full rounded-xl border p-4 text-left transition-colors",
                selectedId === b.id
                  ? "border-primary/50 bg-primary/10"
                  : "border-border bg-card/60 hover:bg-card/80",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{b.name}</p>
                  <p className="text-xs text-muted-foreground">{b.course.title}</p>
                </div>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold uppercase">{b.type}</span>
              </div>
              {scheduleSummary(b) && (
                <p data-testid="batch-schedule" className="mt-1 text-xs text-foreground/80">{scheduleSummary(b)}</p>
              )}
              <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><Users className="h-3 w-3" />{b._count.students} students</span>
                <span className="flex items-center gap-1"><GraduationCap className="h-3 w-3" />{b._count.teachers} teachers</span>
                <span>{b._count.timetableSlots} slots</span>
              </div>
            </button>
          ))}
          {!isLoading && (batches?.length ?? 0) === 0 && (
            <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
              No batches yet. Create one to get started.
            </div>
          )}
        </div>

        {selectedId && batchDetail && (
          <div className="rounded-xl border border-border bg-card/60 p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{batchDetail.name}</h3>
              <button type="button" onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Students ({selectedStudentIds.length})</p>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-border bg-secondary/30 p-2 space-y-1">
                {(students ?? []).map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-white/5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.includes(s.id)}
                      onChange={() => toggleStudent(s.id)}
                      className="accent-[#c8102e]"
                    />
                    <span>{s.firstName} {s.lastName}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{s.studentCode}</span>
                  </label>
                ))}
                {(students?.length ?? 0) === 0 && (
                  <p className="px-2 py-1 text-xs text-muted-foreground">No students found via /students API.</p>
                )}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase text-muted-foreground mb-2">Teachers ({selectedTeacherIds.length})</p>
              {(teachersRaw?.length ?? 0) > 0 ? (
                <div className="max-h-32 overflow-y-auto rounded-lg border border-border bg-secondary/30 p-2 space-y-1">
                  {teachersRaw!.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-white/5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedTeacherIds.includes(t.id)}
                        onChange={() => toggleTeacher(t.id)}
                        className="accent-[#c8102e]"
                      />
                      <span>{t.name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">{t.email}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    placeholder="Teacher user UUID"
                    value={teacherUuidInput}
                    onChange={(e) => setTeacherUuidInput(e.target.value)}
                    className="text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={addTeacherUuid}>Add</Button>
                </div>
              )}
              {selectedTeacherIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedTeacherIds.map((id) => (
                    <span key={id} className="rounded bg-secondary px-2 py-0.5 text-[10px] font-mono">{id.slice(0, 8)}…</span>
                  ))}
                </div>
              )}
            </div>

            <Button
              disabled={membersMutation.isPending}
              onClick={() => membersMutation.mutate()}
            >
              {membersMutation.isPending ? "Saving…" : "Save members"}
            </Button>
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Create batch</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Course *</label>
              <select
                className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
              >
                <option value="">Select course…</option>
                {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>
            <Input placeholder="Batch name" value={name} onChange={(e) => setName(e.target.value)} />
            <div>
              <label className="text-xs text-muted-foreground">Type</label>
              <select
                className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm"
                value={type}
                onChange={(e) => setType(e.target.value as (typeof BATCH_TYPES)[number])}
              >
                {BATCH_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground" htmlFor="batch-frequency">Frequency</label>
              <select
                id="batch-frequency"
                className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
              >
                <option value="">Select frequency…</option>
                {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground" htmlFor="batch-start-time">Start time</label>
                <Input id="batch-start-time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground" htmlFor="batch-end-time">End time</label>
                <Input id="batch-end-time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground" htmlFor="batch-start-date">Start date</label>
                <Input id="batch-start-date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground" htmlFor="batch-end-date">End date</label>
                <Input id="batch-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1" />
              </div>
            </div>
            {formError && <p data-testid="batch-schedule-error" className="text-xs text-rose-400">{formError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={!courseId || !name || !!formError || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
