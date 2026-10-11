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
import { Plus, Trash2, CalendarDays, MapPin, Video } from "lucide-react";

interface BatchRow { id: string; name: string; course: { title: string } }
interface TimetableSlot {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  room?: string | null;
  onlineUrl?: string | null;
  subjectTag?: string | null;
  batch: { id: string; name: string; type: string };
  teacher?: { id: string; name: string } | null;
  course?: { title: string } | null;
}
interface UserRow { id: string; name: string; email: string }

function toLocalDatetime(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function LmsTimetablePage() {
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = React.useState(false);
  const [batchId, setBatchId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [startsAt, setStartsAt] = React.useState(toLocalDatetime(new Date()));
  const [endsAt, setEndsAt] = React.useState(toLocalDatetime(new Date(Date.now() + 3600000)));
  const [room, setRoom] = React.useState("");
  const [onlineUrl, setOnlineUrl] = React.useState("");
  const [subjectTag, setSubjectTag] = React.useState("");
  const [teacherId, setTeacherId] = React.useState("");

  const { data: batches } = useQuery({
    queryKey: ["lms-batches"],
    queryFn: () => apiFetch<BatchRow[]>("/lms/batches"),
  });

  const { data: slots, isLoading } = useQuery({
    queryKey: ["lms-timetable"],
    queryFn: () => apiFetch<TimetableSlot[]>("/lms/timetable"),
  });

  const { data: teachers } = useQuery({
    queryKey: ["users-teachers"],
    queryFn: async () => {
      const res = await fetch("/api/v1/users?role=TEACHER&limit=100", { credentials: "include" });
      if (!res.ok) return [] as UserRow[];
      const json = await res.json() as { data: UserRow[] };
      return json.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiFetch("/lms/timetable", {
        method: "POST",
        body: JSON.stringify({
          batchId,
          title,
          startsAt: new Date(startsAt).toISOString(),
          endsAt: new Date(endsAt).toISOString(),
          room: room || null,
          onlineUrl: onlineUrl || null,
          subjectTag: subjectTag || null,
          teacherId: teacherId || null,
        }),
      }),
    onSuccess: () => {
      toast({ title: "Slot created" });
      setCreateOpen(false);
      setTitle("");
      void queryClient.invalidateQueries({ queryKey: ["lms-timetable"] });
    },
    onError: (err: Error) => toast({ title: "Create failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/timetable/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Slot deleted" });
      void queryClient.invalidateQueries({ queryKey: ["lms-timetable"] });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable"
        description="Schedule upcoming lectures and sessions for batches."
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add slot
          </Button>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      <div className="space-y-2">
        {(slots ?? []).map((slot) => {
          const start = new Date(slot.startsAt);
          const end = new Date(slot.endsAt);
          const isPast = end < new Date();
          return (
            <div
              key={slot.id}
              className={cn(
                "flex items-start gap-4 rounded-xl border p-4",
                isPast ? "border-border/50 bg-card/30 opacity-60" : "border-border bg-card/60",
              )}
            >
              <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/15 text-primary">
                <span className="text-lg font-bold leading-none">{start.getDate()}</span>
                <span className="text-[10px] uppercase">{start.toLocaleDateString("en-IN", { month: "short" })}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{slot.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {slot.batch.name} · {slot.course?.title ?? "-"}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <CalendarDays className="h-3 w-3" />
                    {start.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                    {" – "}
                    {end.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                  {slot.room && (
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{slot.room}</span>
                  )}
                  {slot.onlineUrl && (
                    <a href={slot.onlineUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-primary hover:underline">
                      <Video className="h-3 w-3" />Join online
                    </a>
                  )}
                  {slot.subjectTag && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{slot.subjectTag}</span>
                  )}
                  {slot.teacher && <span>Teacher: {slot.teacher.name}</span>}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                onClick={() => { if (confirm("Delete this slot?")) deleteMutation.mutate(slot.id); }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        {!isLoading && (slots?.length ?? 0) === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            No upcoming slots. Add one to schedule lectures.
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create timetable slot</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Batch *</label>
              <select
                className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
              >
                <option value="">Select batch…</option>
                {(batches ?? []).map((b) => (
                  <option key={b.id} value={b.id}>{b.name} ({b.course.title})</option>
                ))}
              </select>
            </div>
            <Input placeholder="Title *" value={title} onChange={(e) => setTitle(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Starts at</label>
                <Input type="datetime-local" className="mt-1" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Ends at</label>
                <Input type="datetime-local" className="mt-1" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
              </div>
            </div>
            <Input placeholder="Room (optional)" value={room} onChange={(e) => setRoom(e.target.value)} />
            <Input placeholder="Online URL (optional)" value={onlineUrl} onChange={(e) => setOnlineUrl(e.target.value)} />
            <Input placeholder="Subject tag (optional)" value={subjectTag} onChange={(e) => setSubjectTag(e.target.value)} />
            <div>
              <label className="text-xs text-muted-foreground">Teacher (optional)</label>
              <select
                className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm"
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
              >
                <option value="">None</option>
                {(teachers ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={!batchId || !title || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? "Creating…" : "Create slot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
