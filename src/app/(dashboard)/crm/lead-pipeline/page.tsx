"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  User,
  Phone,
  Calendar,
  Clock,
  Video,
  MapPin,
  MessageSquare,
  Search,
  ExternalLink,
  Plus,
  ShieldCheck,
  AlertCircle,
  GraduationCap,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime, cn } from "@/lib/utils";
import { isLostStatus } from "@/lib/leads/lead-status";
import type { LeadStatus } from "@prisma/client";
import { readMeetingMode, MEETING_MODE_LABELS, type MeetingMode } from "@/lib/crm/meeting-mode";
import { toast } from "@/components/ui/use-toast";

interface LeadActivity {
  id: string;
  activityType: string;
  metadata?: unknown;
  dueAt?: string | null;
  completedAt?: string | null;
  title?: string | null;
}

interface LeadRecord {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  courseInterest?: string | null;
  status: string;
  source?: string;
  score?: number;
  manualAmount?: number | string | null;
  counselor?: { id: string; name: string } | null;
  admissions?: { id: string; applicationNo: string; stage: string }[];
  activities?: LeadActivity[];
  deals?: { id: string; title: string; stage: string; value?: number | string | null }[];
  createdAt: string;
  updatedAt: string;
}

interface ColumnConfig {
  id: string;
  label: string;
  color: string;
  bg: string;
  badge: string;
  description: string;
}

const COLUMNS: ColumnConfig[] = [
  {
    id: "NEW",
    label: "New Leads",
    color: "border-blue-500/50 text-blue-400",
    bg: "bg-blue-500/10",
    badge: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    description: "Fresh inbound enquiries awaiting initial engagement",
  },
  {
    id: "INTERESTED",
    label: "Interested",
    color: "border-emerald-500/50 text-emerald-400",
    bg: "bg-emerald-500/10",
    badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    description: "Active conversations with qualified interest",
  },
  {
    id: "PROSPECT",
    label: "Prospect",
    color: "border-purple-500/50 text-purple-400",
    bg: "bg-purple-500/10",
    badge: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    description: "Meeting scheduled (Online or Campus Visit)",
  },
  {
    id: "ADMISSION",
    label: "Admission",
    color: "border-teal-500/50 text-teal-400",
    bg: "bg-teal-500/10",
    badge: "bg-teal-500/20 text-teal-400 border-teal-500/30",
    description: "Converted to official student dossier",
  },
  {
    id: "LOST",
    label: "Lost Leads",
    color: "border-rose-500/50 text-rose-400",
    bg: "bg-rose-500/10",
    badge: "bg-rose-500/20 text-rose-400 border-rose-500/30",
    description: "Disqualified or opted out leads",
  },
  {
    id: "NOT_CONNECTED",
    label: "Not Connected",
    color: "border-slate-500/50 text-slate-400",
    bg: "bg-slate-500/10",
    badge: "bg-slate-500/20 text-slate-400 border-slate-500/30",
    description: "Ringing, unreachable or scheduled call back",
  },
];

function getColumnForLead(lead: LeadRecord): string {
  if (lead.status === "WON" || lead.status === "CONVERTED" || (lead.admissions && lead.admissions.length > 0)) {
    return "ADMISSION";
  }
  if (lead.status === "PROSPECT") {
    return "PROSPECT";
  }
  if (["INTERESTED", "CONNECTED", "CALL_BACK"].includes(lead.status)) {
    return "INTERESTED";
  }
  if (["NOT_CONNECTED", "RINGING", "NOT_REACHABLE", "SWITCHED_OFF", "VOICEMAIL"].includes(lead.status)) {
    return "NOT_CONNECTED";
  }
  if (isLostStatus(lead.status as LeadStatus) || lead.status === "LOST") {
    return "LOST";
  }
  return "NEW";
}

function hasScheduledMeeting(lead: LeadRecord): boolean {
  return (lead.activities ?? []).some((a) => {
    if (a.activityType !== "MEETING") return false;
    const mode = readMeetingMode(a.metadata);
    return mode === "ONLINE" || mode === "CAMPUS_VISIT" || mode === "OFFLINE" || !a.completedAt;
  });
}

function getMeetingSummary(lead: LeadRecord): { title: string; mode: string; date?: string } | null {
  const meeting = (lead.activities ?? []).find((a) => a.activityType === "MEETING");
  if (!meeting) return null;
  const mode = readMeetingMode(meeting.metadata);
  const modeLabel = mode ? MEETING_MODE_LABELS[mode] : "Meeting";
  return {
    title: meeting.title || modeLabel,
    mode: modeLabel,
    date: meeting.dueAt ? formatDateTime(meeting.dueAt) : undefined,
  };
}

function formatINR(val?: number | string | null): string {
  const n = Number(val ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `₹${n.toLocaleString("en-IN")}`;
}

function LeadPipelineCard({
  lead,
  onClick,
  isDragging,
  canDelete,
  onDelete,
}: {
  lead: LeadRecord;
  onClick: () => void;
  isDragging?: boolean;
  canDelete?: boolean;
  onDelete?: (lead: LeadRecord) => void;
}) {
  const meetingInfo = getMeetingSummary(lead);
  const agreedAmount = formatINR(lead.manualAmount || lead.deals?.[0]?.value);
  const admission = lead.admissions?.[0];

  return (
    <div
      onClick={onClick}
      className={cn(
        "group relative rounded-xl border border-white/10 bg-slate-900/90 p-3.5 space-y-2.5 transition-all shadow-md hover:border-primary/50 hover:bg-slate-900 cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50 ring-2 ring-primary rotate-1"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <Link
            href={`/leads/${lead.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-bold text-white hover:text-primary transition-colors flex items-center gap-1.5 truncate"
          >
            <span>{lead.name}</span>
            <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary shrink-0" />
          </Link>
          <p className="text-[11px] text-muted-foreground mt-0.5 truncate flex items-center gap-1">
            <Phone className="h-2.5 w-2.5 text-muted-foreground/70" />
            {lead.phone}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {lead.score != null && lead.score > 0 && (
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 shrink-0">
              {lead.score}
            </span>
          )}
          {canDelete && (
            <button
              type="button"
              title="Move to Recycle Bin"
              onClick={(e) => {
                e.stopPropagation();
                onDelete?.(lead);
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-rose-500/20 text-muted-foreground hover:text-rose-400"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {lead.courseInterest && (
        <div className="text-[11px] font-semibold text-slate-300 bg-white/5 rounded-md px-2 py-1 truncate border border-white/5">
          {lead.courseInterest}
        </div>
      )}

      {/* Meeting info badge if present */}
      {meetingInfo && (
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-purple-300 bg-purple-500/10 border border-purple-500/20 rounded-md px-2 py-1">
          {meetingInfo.mode.includes("Online") ? (
            <Video className="h-3 w-3 text-purple-400 shrink-0" />
          ) : (
            <MapPin className="h-3 w-3 text-purple-400 shrink-0" />
          )}
          <span className="truncate">{meetingInfo.title}</span>
          {meetingInfo.date && <span className="text-[9px] text-purple-400/80 ml-auto">{meetingInfo.date}</span>}
        </div>
      )}

      {/* Admission dossier pill if admitted */}
      {admission && (
        <div className="flex items-center justify-between text-[10px] font-bold text-teal-300 bg-teal-500/10 border border-teal-500/20 rounded-md px-2 py-1">
          <span className="flex items-center gap-1">
            <ShieldCheck className="h-3 w-3 text-teal-400" />
            {admission.applicationNo}
          </span>
          <span className="text-[9px] text-teal-400/80 uppercase">{admission.stage.replace(/_/g, " ")}</span>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-white/5 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <User className="h-3 w-3 text-primary/70" />
          <span className="truncate max-w-[110px]">{lead.counselor?.name ?? "Unassigned"}</span>
        </div>
        {agreedAmount ? (
          <span className="font-bold text-amber-400 font-mono">{agreedAmount}</span>
        ) : (
          <span className="text-[9px]">{formatDate(lead.createdAt)}</span>
        )}
      </div>
    </div>
  );
}

function SortablePipelineCard({
  lead,
  onClick,
  canDelete,
  onDelete,
}: {
  lead: LeadRecord;
  onClick: () => void;
  canDelete?: boolean;
  onDelete?: (lead: LeadRecord) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
    >
      <LeadPipelineCard lead={lead} onClick={onClick} isDragging={isDragging} canDelete={canDelete} onDelete={onDelete} />
    </div>
  );
}

function PipelineColumn({
  column,
  leads,
  onCardClick,
  canDelete,
  onDelete,
}: {
  column: ColumnConfig;
  leads: LeadRecord[];
  onCardClick: (lead: LeadRecord) => void;
  canDelete?: boolean;
  onDelete?: (lead: LeadRecord) => void;
}) {
  const { setNodeRef } = useSortable({ id: column.id });

  return (
    <div className="flex flex-col min-w-[310px] max-w-[310px] shrink-0">
      <div
        className={cn(
          "flex items-center justify-between rounded-t-2xl border-t-2 bg-slate-900/90 px-4 py-3 border-x border-white/10 backdrop-blur-md",
          column.color
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white tracking-wide uppercase">{column.label}</span>
          <span className="text-[10px] text-muted-foreground hidden sm:inline">({column.description.split(" ")[0]})</span>
        </div>
        <span className="text-xs font-extrabold bg-white/10 px-2.5 py-0.5 rounded-full text-white">
          {leads.length}
        </span>
      </div>

      <div
        ref={setNodeRef}
        className="flex-1 rounded-b-2xl border border-t-0 border-white/10 bg-secondary/15 p-3 space-y-2.5 min-h-[580px] backdrop-blur-sm"
      >
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => (
            <SortablePipelineCard key={lead.id} lead={lead} onClick={() => onCardClick(lead)} canDelete={canDelete} onDelete={onDelete} />
          ))}
        </SortableContext>

        {leads.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground border-2 border-dashed border-white/5 rounded-xl">
            <p className="text-xs font-semibold">Drop leads here</p>
            <p className="text-[10px] text-muted-foreground mt-1">Ready for {column.label}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LeadPipelinePage() {
  const router = useRouter();
  const { data: session } = useSession();
  const canDelete = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";
  const [deleteTarget, setDeleteTarget] = React.useState<LeadRecord | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const [leads, setLeads] = React.useState<LeadRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [activeId, setActiveId] = React.useState<string | null>(null);

  const handleDeleteLead = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiFetch(`/leads/${deleteTarget.id}`, { method: "DELETE" });
      setLeads((prev) => prev.filter((l) => l.id !== deleteTarget.id));
      toast({
        title: "Lead moved to Recycle Bin",
        description: `${deleteTarget.name} has been moved to the Recycle Bin.`,
      });
      setDeleteTarget(null);
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  // Meeting Gate Dialog State
  const [meetingGateOpen, setMeetingGateOpen] = React.useState(false);
  const [targetLead, setTargetLead] = React.useState<LeadRecord | null>(null);
  const [meetingMode, setMeetingMode] = React.useState<MeetingMode>("ONLINE");
  const [meetingDueAt, setMeetingDueAt] = React.useState("");
  const [meetingTitle, setMeetingTitle] = React.useState("Career Counselling & Program Briefing");
  const [meetingNotes, setMeetingNotes] = React.useState("");
  const [submittingMeeting, setSubmittingMeeting] = React.useState(false);

  // Admission Convert Dialog State
  const [convertModalOpen, setConvertModalOpen] = React.useState(false);
  const [convertCourse, setConvertCourse] = React.useState("");
  const [convertFee, setConvertFee] = React.useState("");
  const [submittingConvert, setSubmittingConvert] = React.useState(false);

  // Lost Lead Dialog State
  const [lostModalOpen, setLostModalOpen] = React.useState(false);
  const [lostReason, setLostReason] = React.useState("NOT_INTERESTED");
  const [submittingLost, setSubmittingLost] = React.useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    })
  );

  const fetchLeads = React.useCallback(async () => {
    try {
      const res = await apiFetch<LeadRecord[]>("/leads?limit=100&sortBy=updatedAt&sortDir=desc");
      setLeads(Array.isArray(res) ? res : []);
    } catch (e) {
      toast({ title: "Failed to load leads", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void fetchLeads();
  }, [fetchLeads]);

  const filteredLeads = React.useMemo(() => {
    if (!search.trim()) return leads;
    const q = search.toLowerCase();
    return leads.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        l.phone.includes(q) ||
        (l.email && l.email.toLowerCase().includes(q)) ||
        (l.courseInterest && l.courseInterest.toLowerCase().includes(q))
    );
  }, [leads, search]);

  const byColumn = React.useMemo(() => {
    const acc: Record<string, LeadRecord[]> = {
      NEW: [],
      INTERESTED: [],
      PROSPECT: [],
      ADMISSION: [],
      LOST: [],
      NOT_CONNECTED: [],
    };
    for (const l of filteredLeads) {
      const col = getColumnForLead(l);
      if (acc[col]) {
        acc[col]!.push(l);
      } else {
        acc["NEW"]!.push(l);
      }
    }
    return acc;
  }, [filteredLeads]);

  const activeLead = activeId ? leads.find((l) => l.id === activeId) : null;

  const handleDragStart = (e: DragStartEvent) => {
    setActiveId(e.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const lead = leads.find((l) => l.id === active.id);
    if (!lead) return;

    const overId = over.id as string;
    const targetColumn =
      COLUMNS.find((c) => c.id === overId)?.id ??
      (() => {
        const targetLeadItem = leads.find((l) => l.id === overId);
        return targetLeadItem ? getColumnForLead(targetLeadItem) : undefined;
      })();

    if (!targetColumn) return;

    const currentColumn = getColumnForLead(lead);
    if (currentColumn === targetColumn) return;

    // Gated Validation: Moving to PROSPECT requires a scheduled meeting
    if (targetColumn === "PROSPECT") {
      const hasMeeting = hasScheduledMeeting(lead);
      if (!hasMeeting) {
        setTargetLead(lead);
        setMeetingMode("ONLINE");
        setMeetingTitle(`Counselling Session — ${lead.courseInterest || "Aviation Training"}`);
        // Default to tomorrow 11:00 AM IST
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(11, 0, 0, 0);
        setMeetingDueAt(tomorrow.toISOString().slice(0, 16));
        setMeetingNotes("");
        setMeetingGateOpen(true);
        return;
      }

      // If meeting already exists, directly transition status to PROSPECT
      try {
        await apiFetch(`/leads/${lead.id}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "PROSPECT" }),
        });
        toast({ title: "Moved to Prospect", description: `${lead.name} is now a Prospect.` });
        void fetchLeads();
      } catch (err) {
        toast({ title: "Update failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
      }
      return;
    }

    // Moving to ADMISSION triggers conversion to admission dossier
    if (targetColumn === "ADMISSION") {
      setTargetLead(lead);
      setConvertCourse(lead.courseInterest || "");
      setConvertFee(lead.manualAmount ? String(lead.manualAmount) : "");
      setConvertModalOpen(true);
      return;
    }

    // Moving to LOST requires a lost reason
    if (targetColumn === "LOST") {
      setTargetLead(lead);
      setLostReason("NOT_INTERESTED");
      setLostModalOpen(true);
      return;
    }

    // Direct transitions for NEW, INTERESTED, NOT_CONNECTED
    const targetStatus = targetColumn === "INTERESTED" ? "INTERESTED" : targetColumn === "NOT_CONNECTED" ? "NOT_CONNECTED" : "NEW";

    try {
      await apiFetch(`/leads/${lead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: targetStatus }),
      });
      toast({ title: "Pipeline Updated", description: `${lead.name} moved to ${COLUMNS.find((c) => c.id === targetColumn)?.label}.` });
      void fetchLeads();
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const handleScheduleMeetingAndProceed = async () => {
    if (!targetLead || !meetingDueAt) return;
    setSubmittingMeeting(true);
    try {
      // 1. Schedule the meeting
      await apiFetch("/crm/meetings", {
        method: "POST",
        body: JSON.stringify({
          leadId: targetLead.id,
          title: meetingTitle || undefined,
          dueAt: new Date(meetingDueAt).toISOString(),
          mode: meetingMode,
          notes: meetingNotes || undefined,
        }),
      });

      // 2. Shift lead to PROSPECT
      await apiFetch(`/leads/${targetLead.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "PROSPECT" }),
      });

      toast({
        title: "Meeting Scheduled",
        description: `${MEETING_MODE_LABELS[meetingMode]} meeting logged and ${targetLead.name} moved to Prospect.`,
      });
      setMeetingGateOpen(false);
      setTargetLead(null);
      void fetchLeads();
    } catch (err) {
      toast({ title: "Scheduling failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSubmittingMeeting(false);
    }
  };

  const handleConfirmConvert = async () => {
    if (!targetLead) return;
    setSubmittingConvert(true);
    try {
      const res = await apiFetch<{ admission: { id: string; applicationNo: string } }>(
        "/admissions/convert-lead",
        {
          method: "POST",
          body: JSON.stringify({
            leadId: targetLead.id,
            courseName: convertCourse || undefined,
            feeAmount: convertFee ? Number(convertFee) : undefined,
          }),
        }
      );
      toast({
        title: "Admission Created",
        description: `Application ${res.admission.applicationNo} created for ${targetLead.name}.`,
      });
      setConvertModalOpen(false);
      setTargetLead(null);
      void fetchLeads();
      router.push(`/admissions?id=${res.admission.id}`);
    } catch (err) {
      toast({ title: "Conversion failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSubmittingConvert(false);
    }
  };

  const handleConfirmLost = async () => {
    if (!targetLead) return;
    setSubmittingLost(true);
    try {
      await apiFetch(`/leads/${targetLead.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "LOST",
          lostReason,
        }),
      });
      toast({ title: "Lead Marked Lost", description: `${targetLead.name} marked as lost.` });
      setLostModalOpen(false);
      setTargetLead(null);
      void fetchLeads();
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSubmittingLost(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Lead Sales Pipeline
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Stage leads through conversion. Advancing to Prospect requires an Online or Campus Visit meeting.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search candidate, phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-secondary/40 border-white/10 text-xs font-semibold text-white"
            />
          </div>
          <Button
            size="sm"
            onClick={() => router.push("/leads")}
            variant="outline"
            className="border-white/10 hover:bg-white/5 text-xs font-bold"
          >
            All Leads Table
          </Button>
          {canDelete && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="border-white/10 hover:bg-white/5 text-xs font-bold"
            >
              <Link href="/leads/trash">
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Recycle Bin
              </Link>
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex gap-5 overflow-x-auto pb-6">
          {COLUMNS.map((col) => (
            <div key={col.id} className="min-w-[310px] space-y-3">
              <div className="h-11 rounded-t-2xl bg-white/5 animate-pulse" />
              <div className="h-[580px] rounded-b-2xl bg-white/5 animate-pulse" />
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto pb-6 pt-2">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="flex gap-5 min-w-max px-1">
              {COLUMNS.map((column) => (
                <PipelineColumn
                  key={column.id}
                  column={column}
                  leads={byColumn[column.id] ?? []}
                  onCardClick={(lead) => router.push(`/leads/${lead.id}`)}
                  canDelete={canDelete}
                  onDelete={setDeleteTarget}
                />
              ))}
            </div>
            <DragOverlay>
              {activeLead ? (
                <LeadPipelineCard lead={activeLead} onClick={() => {}} isDragging={false} />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      )}

      {/* Meeting Gate Modal: Required before moving to Prospect */}
      <Dialog open={meetingGateOpen} onOpenChange={(o) => !o && setMeetingGateOpen(false)}>
        <DialogContent className="glass-panel border-white/10 bg-slate-900/95 max-w-md text-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Video className="h-5 w-5 text-purple-400" />
              Schedule Meeting to Enter Prospect
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="p-3 rounded-xl bg-purple-500/10 border border-purple-500/20 text-xs text-purple-200">
              Candidate <span className="font-bold text-white">{targetLead?.name}</span> ({targetLead?.phone}) requires a scheduled meeting (Online or Campus Visit) to qualify as a Prospect.
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">Meeting Format *</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={meetingMode === "ONLINE" ? "default" : "outline"}
                  onClick={() => setMeetingMode("ONLINE")}
                  className={cn(
                    "h-10 text-xs font-bold border-white/10",
                    meetingMode === "ONLINE" ? "bg-purple-600 hover:bg-purple-500 text-white" : "hover:bg-white/5"
                  )}
                >
                  <Video className="h-3.5 w-3.5 mr-1.5" /> Online (Meet/Zoom)
                </Button>
                <Button
                  type="button"
                  variant={meetingMode === "CAMPUS_VISIT" ? "default" : "outline"}
                  onClick={() => setMeetingMode("CAMPUS_VISIT")}
                  className={cn(
                    "h-10 text-xs font-bold border-white/10",
                    meetingMode === "CAMPUS_VISIT" ? "bg-purple-600 hover:bg-purple-500 text-white" : "hover:bg-white/5"
                  )}
                >
                  <MapPin className="h-3.5 w-3.5 mr-1.5" /> Campus Visit
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">Scheduled Date & Time *</Label>
              <Input
                type="datetime-local"
                value={meetingDueAt}
                onChange={(e) => setMeetingDueAt(e.target.value)}
                className="bg-secondary/40 border-white/10 text-xs font-semibold"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">Session Title / Agenda</Label>
              <Input
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                placeholder="e.g. Flight Training Counselling"
                className="bg-secondary/40 border-white/10 text-xs font-medium"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">Notes / Counselor Remarks</Label>
              <Textarea
                rows={2}
                value={meetingNotes}
                onChange={(e) => setMeetingNotes(e.target.value)}
                placeholder="Key questions or parent accompaniment..."
                className="bg-secondary/40 border-white/10 text-xs font-medium"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setMeetingGateOpen(false)} className="text-xs font-bold">
              Cancel
            </Button>
            <Button
              disabled={submittingMeeting || !meetingDueAt}
              onClick={handleScheduleMeetingAndProceed}
              className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold shadow-lg shadow-purple-600/20"
            >
              {submittingMeeting ? "Scheduling..." : "Confirm & Move to Prospect"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Convert to Admission Modal */}
      <Dialog open={convertModalOpen} onOpenChange={(o) => !o && setConvertModalOpen(false)}>
        <DialogContent className="glass-panel border-white/10 bg-slate-900/95 max-w-md text-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-teal-400" />
              Convert Lead to Admission
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Create an official Admission Dossier for <span className="font-bold text-white">{targetLead?.name}</span>.
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">Course Enrolling For</Label>
              <Input
                value={convertCourse}
                onChange={(e) => setConvertCourse(e.target.value)}
                placeholder="e.g. Commercial Pilot License"
                className="bg-secondary/40 border-white/10 text-xs font-semibold"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">Agreed Fee (₹)</Label>
              <Input
                type="number"
                value={convertFee}
                onChange={(e) => setConvertFee(e.target.value)}
                placeholder="Total Course Fee"
                className="bg-secondary/40 border-white/10 text-xs font-semibold"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConvertModalOpen(false)} className="text-xs font-bold">
              Cancel
            </Button>
            <Button
              disabled={submittingConvert}
              onClick={handleConfirmConvert}
              className="bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
            >
              {submittingConvert ? "Converting..." : "Create Admission Dossier"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark Lost Modal */}
      <Dialog open={lostModalOpen} onOpenChange={(o) => !o && setLostModalOpen(false)}>
        <DialogContent className="glass-panel border-white/10 bg-slate-900/95 max-w-md text-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-rose-400" />
              Mark Lead as Lost
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Select disqualification reason for <span className="font-bold text-white">{targetLead?.name}</span>:
            </p>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">Loss Reason *</Label>
              <Select value={lostReason} onValueChange={setLostReason}>
                <SelectTrigger className="bg-secondary/40 border-white/10 text-xs font-semibold">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="glass-panel border-white/10 text-xs">
                  <SelectItem value="NOT_INTERESTED">Not Interested</SelectItem>
                  <SelectItem value="PRICE_HIGH">Price / Budget Mismatch</SelectItem>
                  <SelectItem value="LOCATION_OUT_OF_SCOPE">Location Out of Scope</SelectItem>
                  <SelectItem value="LANGUAGE_BARRIER">Language Barrier</SelectItem>
                  <SelectItem value="JOB_SEEKER">Job Seeker</SelectItem>
                  <SelectItem value="NOT_ELIGIBLE">Not Eligible</SelectItem>
                  <SelectItem value="JOINED_OTHERS">Joined Another Academy</SelectItem>
                  <SelectItem value="INVALID_NUMBER">Invalid Number</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setLostModalOpen(false)} className="text-xs font-bold">
              Cancel
            </Button>
            <Button
              disabled={submittingLost}
              onClick={handleConfirmLost}
              className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold"
            >
              {submittingLost ? "Saving..." : "Confirm Lost"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <AlertDialogContent className="glass-panel border-white/10 bg-slate-900/95 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Move {deleteTarget?.name} to Recycle Bin?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This lead will be moved to the Recycle Bin. You can restore them from there within 30 days, after which they are permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting} className="border-white/10 bg-secondary/30 text-white hover:bg-secondary">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteLead();
              }}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold"
            >
              {deleting ? "Moving..." : "Move to Recycle Bin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}