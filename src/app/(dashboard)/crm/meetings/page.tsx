"use client";

import * as React from "react";
import { Calendar, Clock, Video, Plus } from "lucide-react";
import { getMeetings, scheduleMeeting, cancelMeeting } from "@/lib/crm/meetings";
import type { Meeting } from "@/lib/crm/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRMDataTable, CRMColumn } from "@/components/shared/crm-data-table";
import { toast } from "@/components/ui/use-toast";
import { apiFetch } from "@/lib/api";
import { fromISTInput } from "@/lib/time/ist";
import { MEETING_MODES, MEETING_MODE_LABELS, readMeetingMode, type MeetingMode } from "@/lib/crm/meeting-mode";

interface LeadOption {
  id: string;
  name: string;
  phone: string | null;
  courseInterest: string | null;
  status: string;
}

function MeetingModeBadge({ meeting }: { meeting: Meeting }) {
  const mode = readMeetingMode(meeting.metadata);
  return (
    <Badge
      variant="outline"
      data-testid="meeting-mode"
      className={`text-[9px] font-semibold ${mode ? "border-primary/40 text-primary" : "border-white/10 text-muted-foreground"}`}
    >
      {mode ? MEETING_MODE_LABELS[mode] : "Mode not set"}
    </Badge>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CRMMeetingsPage() {
  const [upcoming, setUpcoming] = React.useState<Meeting[]>([]);
  const [past, setPast] = React.useState<Meeting[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showSchedule, setShowSchedule] = React.useState(false);
  const [cancelling, setCancelling] = React.useState<string | null>(null);

  const load = React.useCallback(() => {
    Promise.all([getMeetings("upcoming"), getMeetings("past")])
      .then(([u, p]) => {
        setUpcoming(u.meetings);
        setPast(p.meetings);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleCancel = React.useCallback((id: string) => {
    if (!window.confirm("Cancel this meeting? This keeps the record for audit.")) return;
    setCancelling(id);
    cancelMeeting(id)
      .then(() => {
        toast({ title: "Meeting cancelled" });
        load();
      })
      .catch((err: unknown) =>
        toast({ title: "Failed to cancel meeting", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
      )
      .finally(() => setCancelling(null));
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-white">Meetings</h1>
            <p className="text-sm text-muted-foreground">Schedule, prep, and track meetings</p>
          </div>
        </div>
        <div className="p-6 text-white text-xs">Loading meetings schedule...</div>
      </div>
    );
  }

  if (error) {
    return <div className="p-6 text-red-500 font-bold">Error loading meetings: {error}</div>;
  }

  const totalMeetings = upcoming.length + past.length;
  const completedCount = past.filter((m) => m.completedAt).length;
  const conversionRate = totalMeetings > 0 ? ((completedCount / totalMeetings) * 100).toFixed(0) : "0";
  const avgDuration = past.length > 0
    ? (past.reduce((s, m) => s + (m.durationMins ?? 0), 0) / past.length).toFixed(0)
    : "-";

  const columns: CRMColumn<Meeting>[] = [
    {
      key: "title",
      header: "Meeting",
      render: (m) => (
        <div>
          <p className="font-semibold text-white">{m.title || "Meeting"}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{m.lead.name}</p>
        </div>
      ),
    },
    {
      key: "dueAt",
      header: "Scheduled",
      render: (m) => (
        <span className="flex items-center gap-1.5">
          <Clock className="h-3 w-3 text-muted-foreground" />
          {formatDateTime(m.dueAt)}
        </span>
      ),
    },
    {
      key: "mode",
      header: "Mode",
      render: (m) => <MeetingModeBadge meeting={m} />,
    },
    {
      key: "durationMins",
      header: "Duration",
      render: (m) => (m.durationMins ? `${m.durationMins}m` : "—"),
    },
    {
      key: "outcome",
      header: "Outcome",
      render: (m) => <span className="text-muted-foreground">{m.outcome ?? "—"}</span>,
    },
    {
      key: "performer",
      header: "Scheduled by",
      render: (m) => m.performer?.name ?? "—",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Meetings</h1>
          <p className="text-sm text-muted-foreground">Real MEETING records stored on leads</p>
        </div>
        <Button size="sm" className="text-xs h-8" onClick={() => setShowSchedule(true)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Schedule Meeting
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card border-white/10 shadow-lg">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-semibold">Upcoming</p>
            <p className="text-2xl font-bold text-white mt-1">{upcoming.length}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-white/10 shadow-lg">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-semibold">Total Booked</p>
            <p className="text-2xl font-bold text-white mt-1">{totalMeetings}</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-white/10 shadow-lg">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-semibold">Completed</p>
            <p className="text-2xl font-bold text-white mt-1">{completedCount}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{conversionRate}% of all meetings</p>
          </CardContent>
        </Card>
        <Card className="bg-card border-white/10 shadow-lg">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground font-semibold">Avg Duration</p>
            <p className="text-2xl font-bold text-white mt-1">{avgDuration === "-" ? "-" : `${avgDuration}m`}</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card border-white/10 shadow-lg">
        <CardHeader className="border-b border-white/5 pb-3">
          <CardTitle className="text-sm font-semibold text-white">Upcoming Meetings</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {upcoming.length === 0 ? (
            <p className="text-xs text-muted-foreground">No upcoming meetings scheduled yet.</p>
          ) : (
            <div className="space-y-3">
              {upcoming.map((meeting) => (
                <div
                  key={meeting.id}
                  data-testid="upcoming-meeting"
                  className="flex items-start gap-3 p-3 rounded-lg border border-white/5 bg-secondary/10 hover:border-primary/50 transition-colors"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 shrink-0">
                    <Calendar className="h-5 w-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-bold text-white truncate">{meeting.title || "Meeting"}</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <MeetingModeBadge meeting={meeting} />
                        <Badge variant="outline" className="border-white/10 text-[9px] font-semibold">
                          {meeting.lead.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-[10px] text-muted-foreground font-semibold">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDateTime(meeting.dueAt)}
                      </span>
                      <span className="flex items-center gap-1">
                        <Video className="h-3 w-3" />
                        {meeting.durationMins ? `${meeting.durationMins}m` : "unscheduled"}
                      </span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 truncate">
                      {meeting.lead.name}
                      {meeting.lead.phone ? ` · ${meeting.lead.phone}` : ""}
                      {meeting.lead.courseInterest ? ` · ${meeting.lead.courseInterest}` : ""}
                    </div>
                    {meeting.notes && (
                      <p className="text-[11px] text-muted-foreground mt-1.5">{meeting.notes}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 shrink-0 text-[10px] border-white/10 text-muted-foreground hover:text-red-400"
                    disabled={cancelling === meeting.id}
                    onClick={() => handleCancel(meeting.id)}
                  >
                    {cancelling === meeting.id ? "Cancelling..." : "Cancel"}
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-white/10 shadow-lg">
        <CardHeader className="border-b border-white/5 pb-3">
          <CardTitle className="text-sm font-semibold text-white">Past Meetings</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {past.length === 0 ? (
            <p className="text-xs text-muted-foreground">No completed meetings on record yet.</p>
          ) : (
            <CRMDataTable columns={columns} data={past} searchable={false} pageSize={10} />
          )}
        </CardContent>
      </Card>

      {showSchedule && (
        <ScheduleMeetingDialog
          onClose={() => setShowSchedule(false)}
          onScheduled={() => {
            setShowSchedule(false);
            toast({ title: "Meeting scheduled" });
            load();
          }}
        />
      )}
    </div>
  );
}

function ScheduleMeetingDialog({
  onClose,
  onScheduled,
}: {
  onClose: () => void;
  onScheduled: () => void;
}) {
  const [leads, setLeads] = React.useState<LeadOption[]>([]);
  const [loadingLeads, setLoadingLeads] = React.useState(true);
  const [leadId, setLeadId] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [dueAt, setDueAt] = React.useState("");
  const [duration, setDuration] = React.useState("30");
  const [mode, setMode] = React.useState<MeetingMode>("ONLINE");
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  React.useEffect(() => {
    apiFetch<LeadOption[]>("/leads?limit=100")
      .then((list) => {
        setLeads(Array.isArray(list) ? list : []);
        setLoadingLeads(false);
      })
      .catch(() => {
        setLoadingLeads(false);
      });
  }, []);

  const canSubmit = Boolean(leadId) && Boolean(dueAt);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    scheduleMeeting({
      leadId,
      title: title.trim() || undefined,
      dueAt: fromISTInput(dueAt),
      durationMins: parseInt(duration, 10) || undefined,
      mode,
      notes: notes.trim() || undefined,
    })
      .then(onScheduled)
      .catch((err: unknown) =>
        toast({ title: "Failed to schedule meeting", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
      )
      .finally(() => setSubmitting(false));
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-card border-white/10">
        <DialogHeader>
          <DialogTitle className="text-white text-base">Schedule Meeting</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Lead</Label>
            <Select value={leadId} onValueChange={setLeadId} disabled={loadingLeads}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue placeholder={loadingLeads ? "Loading leads..." : "Select a lead"} />
              </SelectTrigger>
              <SelectContent>
                {leads.map((l) => (
                  <SelectItem key={l.id} value={l.id} className="text-xs">
                    {l.name}{l.courseInterest ? ` — ${l.courseInterest}` : ""}
                  </SelectItem>
                ))}
                {leads.length === 0 && !loadingLeads && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">No leads found.</p>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Optional" className="h-9 text-xs" />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">When (IST)</Label>
              <Input
                type="datetime-local"
                aria-label="Meeting time"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Duration (min)</Label>
              <Input
                type="number"
                min={0}
                max={1440}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground" id="meeting-mode-label">Mode</Label>
            <div role="radiogroup" aria-labelledby="meeting-mode-label" className="grid grid-cols-3 gap-2">
              {MEETING_MODES.map((m) => (
                <Button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  size="sm"
                  variant={mode === m ? "default" : "outline"}
                  className="h-8 text-xs border-white/10"
                  onClick={() => setMode(m)}
                >
                  {MEETING_MODE_LABELS[m]}
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Notes</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="text-xs" />
          </div>
          <DialogFooter>
            <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-white/10" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="h-8 text-xs" disabled={!canSubmit || submitting}>
              {submitting ? "Scheduling..." : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
