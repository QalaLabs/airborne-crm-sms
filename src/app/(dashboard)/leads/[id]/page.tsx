"use client";

import { admissionStageLabel, canonicalAdmissionStage } from "@/lib/admissions/stage-labels";
import * as React from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, Mail, Phone, Calendar, User, MessageSquare,
  PhoneCall, Clock, FileText, Sparkles, Plus, CheckCircle2,
  UserPlus, GraduationCap, Send, Workflow, ChevronLeft, ChevronRight, X, Pencil,
  Bot, Volume2, Download, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch } from "@/lib/api";
import { updateDeal, revertDealToProspect, convertDealToAdmission } from "@/lib/crm/deals";
import { formatDate, formatDateTime } from "@/lib/utils";
import { toISTInput, fromISTInput } from "@/lib/time/ist";
import { statusLabel } from "@/lib/leads/lead-status";
import { LEAD_SOURCE_OPTIONS, leadSourceLabel } from "@/lib/leads/lead-source";
import { roleCan } from "@/lib/utils/permissions";
import { toast } from "@/components/ui/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InteraktSyncCard } from "@/components/leads/interakt-sync-card";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

interface LeadAdmission {
  id: string;
  applicationNo: string;
  stage: string;
  courseName?: string | null;
  batchName?: string | null;
  feePaid?: string | number | null;
  feeBalance?: string | number | null;
  feeFinal?: string | number | null;
}

interface LeadDeal {
  id: string;
  title: string;
  stage: string;
  value?: string | number | null;
  currency?: string;
  assignedTo?: string | null;
  lostReason?: string | null;
  wonAt?: string | null;
  lostAt?: string | null;
  convertedAt?: string | null;
  revertedAt?: string | null;
  isActive: boolean;
  admissionId?: string | null;
  admission?: { id: string; applicationNo: string; stage: string } | null;
}

const ELIGIBILITY_LABEL: Record<string, string> = {
  eligible: "Meets course criteria",
  review: "Needs counsellor review",
  not_applicable: "No pre-check for this course",
};

interface Lead {
  id: string;
  name: string;
  email?: string | null;
  phone: string;
  status: string;
  source: string;
  score: number;
  courseInterest?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  googleId?: string | null;
  manualAmount?: number | string | null;
  nextFollowUp?: string | null;
  lastActivityAt?: string | null;
  lastDisposition?: string | null;
  dispositionAt?: string | null;
  convertedAt?: string | null;
  lostReason?: string | null;
  assignedTo?: string | null;
  counselor?: { id: string; name: string; email?: string | null } | null;
  admissions?: LeadAdmission[];
  deals?: LeadDeal[];
  scoreHistory?: { id: string; score: number; reason?: string | null; createdAt: string }[];
  customFields?: { eligibility?: { course?: string | null; result?: string; answers?: Record<string, string> } } | null;
  createdAt: string;
  updatedAt: string;
}

interface LeadActivity {
  id: string;
  activityType: string;
  title?: string | null;
  notes?: string | null;
  outcome?: string | null;
  dueAt?: string | null;
  completedAt?: string | null;
  durationMins?: number | null;
  metadata?: Record<string, any> | null;
  performer?: { id: string; name: string } | null;
  createdAt: string;
}

interface TimelineEntry {
  id: string;
  kind: "activity" | "notification" | "automation";
  at: string;
  title: string;
  detail?: string | null;
  status?: string | null;
  channel?: string | null;
  actorName?: string | null;
  workflowName?: string | null;
  activityType?: string | null;
  metadata?: Record<string, any> | null;
  durationMins?: number | null;
}

interface CounselorOption {
  id: string;
  name: string;
  role: string;
}

/**
 * Status picker. Group headings (Connected / Not Connected / Lost) are
 * headings only — they are not offered as selectable reasons themselves.
 */
const STATUS_GROUPS = [
  {
    label: "Connected",
    statuses: ["NEW", "CALL_BACK", "INTERESTED", "PROSPECT", "WON"],
  },
  {
    label: "Not Connected",
    statuses: ["RINGING", "NOT_REACHABLE", "SWITCHED_OFF", "VOICEMAIL"],
  },
  {
    label: "Lost",
    statuses: [
      "INCOMING_BARD",
      "OUT_OF_SERVICE",
      "NOT_AWARE",
      "NOT_CONTACTABLE",
      "LOCATION_OUT_OF_SCOPE",
      "LANGUAGE_BARRIER",
      "PRICE_HIGH",
      "JOINED_OTHERS",
      "NOT_ELIGIBLE",
      "INVALID_NUMBER",
      "TEST_LEAD",
      "NOT_INTERESTED",
      "REASON_NOT_SHARED",
      "JOB_SEEKER",
    ],
  },
] as const;

const LOST_STATUSES = new Set<string>([
  "LOST",
  "INCOMING_BARD",
  "OUT_OF_SERVICE",
  "NOT_AWARE",
  "NOT_CONTACTABLE",
  "LOCATION_OUT_OF_SCOPE",
  "LANGUAGE_BARRIER",
  "PRICE_HIGH",
  "JOINED_OTHERS",
  "NOT_ELIGIBLE",
  "INVALID_NUMBER",
  "TEST_LEAD",
  "NOT_INTERESTED",
  "REASON_NOT_SHARED",
  "JOB_SEEKER",
]);

const DEAL_STAGE_ORDER = [
  "ENQUIRY",
  "FEE_PAYMENT",
  "VERIFICATION",
  "ENROLLED",
  "DROPPED",
  "CANCELLED",
];

const ACTIVITY_TYPES = [
  "NOTE",
  "CALL",
  "EMAIL",
  "WHATSAPP",
  "SMS",
  "MEETING",
  "TASK",
] as const;

const activitySchema = z.object({
  activityType: z.enum(ACTIVITY_TYPES),
  title: z.string().max(500).optional(),
  notes: z.string().min(2, "Add a short note").max(5000),
  outcome: z.string().max(255).optional(),
  dueAt: z.string().optional(),
  durationMins: z.coerce.number().min(0).max(1440).optional(),
});

type ActivityForm = z.infer<typeof activitySchema>;

const ACTIVITY_ICONS: Record<string, React.ElementType> = {
  NOTE: MessageSquare,
  CALL: PhoneCall,
  EMAIL: Mail,
  WHATSAPP: MessageSquare,
  SMS: Phone,
  MEETING: Calendar,
  TASK: CheckCircle2,
  FOLLOW_UP: Clock,
  STATUS_CHANGE: Sparkles,
  ASSIGNMENT: UserPlus,
  SYSTEM: FileText,
};

function priorityFromScore(score: number) {
  if (score >= 70) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

function formatWhatsAppPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.startsWith("0") && digits.length === 11) return `91${digits.slice(1)}`;
  return digits;
}

function getWhatsAppGreeting(lead: { name: string; courseInterest?: string | null; status: string }): string {
  const name = lead.name || "there";
  const course = lead.courseInterest || "pilot training programs";
  switch (lead.status) {
    case "NEW":
      return `Hello ${name}, thank you for contacting Airborne Aviation! We received your enquiry for ${course}. How can we assist you with your pilot training journey today?`;
    case "INTERESTED":
    case "CONNECTED":
    case "CALL_BACK":
      return `Hi ${name}, following up on your discussion with Airborne Aviation regarding ${course}. When would be a good time to connect for a detailed session?`;
    case "PROSPECT":
      return `Hi ${name}, greetings from Airborne Aviation! Would you like to schedule an online counseling session or a campus visit for ${course}?`;
    case "WON":
    case "ADMISSION":
      return `Congratulations ${name}! Welcome to Airborne Aviation. We are preparing your admission details for ${course}. Let us know if you need any assistance!`;
    default:
      return `Hello ${name}, greetings from Airborne Aviation regarding your interest in ${course}! How can we help you today?`;
  }
}

function CallRecordingPlayer({
  metadata,
  durationMins,
  notes,
}: {
  metadata?: Record<string, any> | null;
  durationMins?: number | null;
  notes?: string | null;
}) {
  const meta = metadata ?? {};
  const recordingUrl =
    meta.recording_url ||
    meta.recordingUrl ||
    meta.record_url ||
    meta.file_url ||
    meta.gcs_recording_url ||
    null;

  const transcript =
    meta.transcript ||
    (notes && typeof notes === "string" && notes.includes("AI Voice Advisor Call Log:") ? notes : null);

  const durationSec = meta.duration_seconds
    ? Number(meta.duration_seconds)
    : durationMins
    ? durationMins * 60
    : null;

  const durationLabel = durationSec
    ? `${Math.floor(durationSec / 60)}m ${durationSec % 60}s`
    : durationMins
    ? `${durationMins} mins`
    : null;

  if (!recordingUrl && !transcript) return null;

  return (
    <div className="mt-3 p-3 rounded-xl bg-slate-950/70 border border-emerald-500/30 space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold text-emerald-400 flex-wrap gap-2">
        <span className="flex items-center gap-1.5">
          <Volume2 className="h-3.5 w-3.5 text-emerald-400 animate-pulse" />
          <span>Call Recording</span>
        </span>
        {durationLabel ? (
          <span className="text-[10px] font-mono text-muted-foreground bg-white/5 px-2 py-0.5 rounded">
            {durationLabel}
          </span>
        ) : null}
      </div>

      {recordingUrl ? (
        <div className="space-y-1.5">
          <audio controls className="w-full h-8 rounded bg-slate-900 border border-white/10" preload="metadata" src={recordingUrl}>
            Your browser does not support audio playback.
          </audio>
          <div className="flex items-center justify-between pt-0.5 text-[10px] text-muted-foreground">
            <a
              href={recordingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-emerald-400 underline flex items-center gap-1"
            >
              <Download className="h-3 w-3" /> Download / Open Audio
            </a>
          </div>
        </div>
      ) : null}

      {transcript ? (
        <details className="text-xs pt-1 border-t border-white/5">
          <summary className="cursor-pointer font-semibold text-indigo-300 hover:text-white select-none text-[11px]">
            View Call Transcript
          </summary>
          <div className="mt-1.5 p-2.5 rounded bg-black/40 border border-white/5 font-mono text-[10px] text-slate-300 leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
            {transcript}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export default function LeadDetailPage() {
  const { data: session } = useSession();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState<"timeline" | "scoring" | "manual">("timeline");
  const [logOpen, setLogOpen] = React.useState(false);
  const [logDefaultType, setLogDefaultType] = React.useState<(typeof ACTIVITY_TYPES)[number]>("NOTE");
  const [assignOpen, setAssignOpen] = React.useState(false);
  const [counselorId, setCounselorId] = React.useState("");
  const [followUp, setFollowUp] = React.useState("");
  const [lostReason, setLostReason] = React.useState("");
  const [editingStatus, setEditingStatus] = React.useState(false);
  const [pendingStatus, setPendingStatus] = React.useState<string | null>(null);
  const [followUpNote, setFollowUpNote] = React.useState("");
  const [courseId, setCourseId] = React.useState<string>("unselected");
  const [batchId, setBatchId] = React.useState<string>("unselected");
  const [feeDecided, setFeeDecided] = React.useState<string>("");

  const canEditProfile = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";
  const [editProfileOpen, setEditProfileOpen] = React.useState(false);
  const [editProfileForm, setEditProfileForm] = React.useState({
    name: "",
    email: "",
    phone: "",
    courseInterest: "",
    city: "",
    state: "",
    pincode: "",
    manualAmount: "",
  });

  const [agentCallOpen, setAgentCallOpen] = React.useState(false);
  const [agentCallObjective, setAgentCallObjective] = React.useState("");

  const agentCallMutation = useMutation({
    mutationFn: (body: { objective?: string }) =>
      apiFetch<{ success: boolean; message: string; dispatch?: any }>(`/leads/${id}/agent-call`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setAgentCallOpen(false);
      setAgentCallObjective("");
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      queryClient.invalidateQueries({ queryKey: ["lead", id, "activities"] });
      queryClient.invalidateQueries({ queryKey: ["lead", id, "timeline"] });
      toast({
        title: "AI Voice Call Initiated",
        description: data.message || `Outbound agent call dispatched to ${lead?.phone}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Call Dispatch Failed",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const triggerInteraktMutation = useMutation({
    mutationFn: () => apiFetch(`/leads/${id}/interakt`, { method: "POST" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id, "interakt"] });
      queryClient.invalidateQueries({ queryKey: ["lead", id, "timeline"] });
      toast({ title: "Interakt Triggered", description: "Template dispatch & event sync initiated." });
    },
    onError: (err: Error) => {
      toast({ title: "Interakt Failed", description: err.message, variant: "destructive" });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: typeof editProfileForm) =>
      apiFetch(`/leads/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: data.name.trim(),
          email: data.email.trim() ? data.email.trim() : undefined,
          phone: data.phone.trim(),
          courseInterest: data.courseInterest.trim() || undefined,
          city: data.city.trim() || undefined,
          state: data.state.trim() || undefined,
          pincode: data.pincode.trim() || undefined,
          manualAmount: data.manualAmount ? Number(data.manualAmount) : undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["lead", id] });
      queryClient.invalidateQueries({ queryKey: ["lead", id, "timeline"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Lead Updated", description: "Lead profile details successfully updated." });
      setEditProfileOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Update Failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: courses = [] } = useQuery({
    queryKey: ["courses"],
    queryFn: () => apiFetch<{ id: string; title: string }[]>("/courses"),
  });

  const { data: batches = [] } = useQuery({
    queryKey: ["lms-batches"],
    queryFn: () => apiFetch<{ id: string; name: string }[]>("/lms/batches"),
  });

  const { data: lead, isLoading } = useQuery({
    queryKey: ["lead", id],
    queryFn: () => apiFetch<Lead>(`/leads/${id}`),
    enabled: !!id,
  });

  const { data: activities, isLoading: activitiesLoading } = useQuery({
    queryKey: ["lead", id, "activities"],
    queryFn: () => apiFetch<LeadActivity[]>(`/leads/${id}/activities?limit=50`),
    enabled: !!id,
  });

  const { data: timeline, isLoading: timelineLoading } = useQuery({
    queryKey: ["lead", id, "timeline"],
    queryFn: () => apiFetch<TimelineEntry[]>(`/timeline?entityType=LEAD&entityId=${id}&limit=50`),
    enabled: !!id,
  });

  const { data: counselors } = useQuery({
    queryKey: ["users", "counselors"],
    queryFn: async () => {
      try {
        return await apiFetch<CounselorOption[]>(`/users?role=ADMISSIONS_COUNSELOR&limit=100`);
      } catch {
        return [] as CounselorOption[];
      }
    },
  });

  const { data: neighborLeads } = useQuery({
    queryKey: ["leads", "neighbors"],
    queryFn: async () => {
      try {
        const storedFilters = typeof window !== "undefined" ? sessionStorage.getItem("lastLeadFilters") : null;
        const queryParams = storedFilters || "limit=100&sortBy=updatedAt&sortDir=desc";
        // append fields=id,name to ensure minimal payload
        const url = `/leads?${queryParams}&fields=id,name`;
        
        const res = await apiFetch<{ id: string; name: string }[]>(url);
        return Array.isArray(res) ? res : [];
      } catch {
        return [] as { id: string; name: string }[];
      }
    },
  });

  const leadIndex = (neighborLeads ?? []).findIndex((l) => l.id === id);
  const prevLead = leadIndex > 0 ? (neighborLeads ?? [])[leadIndex - 1] : undefined;
  const nextLead =
    leadIndex >= 0 && leadIndex < (neighborLeads?.length ?? 0) - 1
      ? (neighborLeads ?? [])[leadIndex + 1]
      : undefined;

  React.useEffect(() => {
    if (lead?.nextFollowUp) {
      setFollowUp(toISTInput(lead.nextFollowUp));
    }
  }, [lead?.nextFollowUp]);

  React.useEffect(() => {
    if (lead) {
      setEditProfileForm({
        name: lead.name || "",
        email: lead.email || "",
        phone: lead.phone || "",
        courseInterest: lead.courseInterest || "",
        city: lead.city || "",
        state: lead.state || "",
        pincode: lead.pincode || "",
        manualAmount: lead.manualAmount != null ? String(lead.manualAmount) : "",
      });
    }
  }, [lead]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["lead", id] });
    queryClient.invalidateQueries({ queryKey: ["lead", id, "activities"] });
    queryClient.invalidateQueries({ queryKey: ["lead", id, "timeline"] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  };

  const updateStatusMutation = useMutation({
    mutationFn: (payload: { status: string; lostReason?: string; nextFollowUp?: string | null; dealData?: any }) =>
      apiFetch(`/leads/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Status updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const canEditSource = roleCan(session?.user?.role, "write", "leads");
  const [editingSource, setEditingSource] = React.useState(false);
  const [sourceDraft, setSourceDraft] = React.useState("");
  const updateSourceMutation = useMutation({
    mutationFn: (source: string) => apiFetch(`/leads/${id}`, { method: "PATCH", body: JSON.stringify({ source }) }),
    onSuccess: () => {
      invalidate();
      setEditingSource(false);
      toast({ title: "Source updated" });
    },
    onError: (err: Error) => toast({ title: "Could not update source", description: err.message, variant: "destructive" }),
  });
  const convertLeadMutation = useMutation({
    mutationFn: (payload: { dealData?: any; notes?: string }) =>
      apiFetch(`/leads/${id}/convert`, { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (res: any) => {
      invalidate();
      toast({ title: "Converted to Admission", description: `Dossier ${res.admission?.applicationNo} created.` });
      router.push(`/admissions?id=${res.admission?.id}`);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ActivityForm>({
    resolver: zodResolver(activitySchema),
    defaultValues: { activityType: "NOTE", notes: "" },
  });

  const activityType = watch("activityType");

  const openLog = (type: (typeof ACTIVITY_TYPES)[number] = "NOTE") => {
    setLogDefaultType(type);
    reset({ activityType: type, notes: "", title: "", outcome: "", dueAt: "" });
    setValue("activityType", type);
    setLogOpen(true);
  };

  const addActivityMutation = useMutation({
    mutationFn: (body: ActivityForm) => {
      const payload: Record<string, unknown> = {
        activityType: body.activityType,
        title: body.title || undefined,
        notes: body.notes,
        outcome: body.outcome || undefined,
        durationMins: body.durationMins || undefined,
      };
      if (body.dueAt) {
        payload.dueAt = fromISTInput(body.dueAt);
      }
      return apiFetch(`/leads/${id}/activities`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Activity logged" });
      setLogOpen(false);
      reset();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const completeTaskMutation = useMutation({
    mutationFn: (activityId: string) =>
      apiFetch(`/leads/${id}/activities/${activityId}`, {
        method: "PATCH",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Task completed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: (cid: string) =>
      apiFetch(`/leads/${id}/assign`, {
        method: "PATCH",
        body: JSON.stringify({ counselorId: cid }),
      }),
    onSuccess: () => {
      invalidate();
      setAssignOpen(false);
      toast({ title: "Counselor assigned" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const followUpMutation = useMutation({
    mutationFn: (value: string | null) =>
      apiFetch(`/leads/${id}/follow-up`, {
        method: "PATCH",
        body: JSON.stringify({ nextFollowUp: value }),
      }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Follow-up saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ admission: { id: string; applicationNo: string }; created: boolean }>(`/leads/${id}/convert`, {
        method: "POST",
        body: JSON.stringify({
          courseName: lead?.courseInterest ?? undefined,
          counselorId: lead?.assignedTo ?? undefined,
        }),
      }),
    onSuccess: (res) => {
      invalidate();
      toast({
        title: res.created ? "Admission created" : "Admission already exists",
        description: res.admission.applicationNo,
      });
      router.push(`/admissions?id=${res.admission.id}`);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const activityList = Array.isArray(activities) ? activities : [];
  const tasks = activityList.filter((a) => a.activityType === "TASK");
  const openTasks = tasks.filter((a) => !a.completedAt);
  const comms = activityList.filter((a) =>
    ["CALL", "EMAIL", "WHATSAPP", "SMS", "MEETING"].includes(a.activityType),
  );
  const canonicalPipeline = ["NEW", "CONNECTED", "INTERESTED", "PROSPECT", "WON"];
  const statusIndex = canonicalPipeline.indexOf(lead?.status ?? "NEW");
  const primaryAdmission = lead?.admissions?.[0];
  const activeDeal = lead?.deals?.find((d) => d.isActive);
  const closedDeal = lead?.deals?.find((d) => !d.isActive);
  const counselorOptions = Array.isArray(counselors) ? counselors : [];

  const dealStageMutation = useMutation({
    mutationFn: ({ dealId, stage }: { dealId: string; stage: string }) =>
      updateDeal(dealId, { stage: stage as never }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Pipeline stage updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const convertDealMutation = useMutation({
    mutationFn: (dealId: string) => convertDealToAdmission(dealId, {}),
    onSuccess: (res) => {
      invalidate();
      toast({
        title: res.created ? "Admission created" : "Admission already exists",
        description: res.admission.applicationNo,
      });
      router.push(`/admissions?id=${res.admission.id}`);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const revertDealMutation = useMutation({
    mutationFn: (dealId: string) => revertDealToProspect(dealId, "Reverted to prospect from lead detail"),
    onSuccess: () => {
      invalidate();
      toast({ title: "Moved back to Prospect" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 pb-12">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
          <Skeleton className="h-96 w-full" />
        </div>
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <p className="text-muted-foreground font-semibold">Lead not found.</p>
        <Button variant="ghost" onClick={() => router.push("/leads")} className="mt-4">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to leads
        </Button>
      </div>
    );
  }

  const priority = priorityFromScore(lead.score ?? 0);

  return (
    <div className="space-y-6 pb-12">
      <div className="glass-card rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-6 bg-slate-900/80 backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={() => router.push("/leads")} className="h-10 w-10">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {prevLead ? (
            <Button
              variant="ghost"
              size="icon"
              title={`Previous: ${prevLead.name}`}
              onClick={() => router.push(`/leads/${prevLead.id}`)}
              className="h-10 w-10"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : null}
          {nextLead ? (
            <Button
              variant="ghost"
              size="icon"
              title={`Next: ${nextLead.name}`}
              onClick={() => router.push(`/leads/${nextLead.id}`)}
              className="h-10 w-10"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          ) : null}
        </div>
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-white tracking-tight">{lead.name}</h1>
              {lead.phone ? (
                <div className="flex items-center gap-2">
                  <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 text-sm font-bold text-white hover:text-primary">
                    <Phone className="h-3.5 w-3.5 text-primary" /> {lead.phone}
                  </a>
                  <a
                    href={`https://wa.me/${formatWhatsAppPhone(lead.phone)}?text=${encodeURIComponent(getWhatsAppGreeting(lead))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30 transition-all shadow-sm"
                    title="Open WhatsApp Web chat with pre-filled greeting"
                  >
                    <MessageSquare className="h-3.5 w-3.5" /> WhatsApp Web
                  </a>
                  <Button
                    size="sm"
                    onClick={() => setAgentCallOpen(true)}
                    disabled={agentCallMutation.isPending}
                    className="h-7 px-2.5 text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm flex items-center gap-1.5"
                    title="Initiate outbound AI Voice Assistant call to this candidate"
                  >
                    {agentCallMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin text-white" />
                    ) : (
                      <Bot className="h-3.5 w-3.5 text-white" />
                    )}
                    {agentCallMutation.isPending ? "Dialing..." : "Agent Call"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => triggerInteraktMutation.mutate()}
                    disabled={triggerInteraktMutation.isPending}
                    className="h-7 px-2.5 text-xs font-semibold border-white/10 hover:bg-white/5"
                    title="Trigger Interakt notification & template"
                  >
                    <Workflow className="h-3 w-3 mr-1 text-primary" />
                    {triggerInteraktMutation.isPending ? "Triggering..." : "Interakt Trigger"}
                  </Button>
                </div>
              ) : null}
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary break-all">
                  <Mail className="h-3.5 w-3.5 shrink-0 text-primary" /> {lead.email}
                </a>
              ) : null}
              <span className="text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1">
                <Sparkles className="h-3 w-3" /> Score: {lead.score ?? 0}
              </span>
              <span className="text-[10px] font-extrabold bg-rose-500/20 text-rose-400 border border-rose-500/30 px-2 py-0.5 rounded-full">
                {priority}
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Created {formatDate(lead.createdAt)} · Source: <span data-testid="lead-source-label">{leadSourceLabel(lead.source ?? "")}</span>
              {lead.nextFollowUp ? ` · Follow-up ${formatDateTime(lead.nextFollowUp)}` : ""}
            </p>
          </div>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1 text-xs text-muted-foreground font-semibold">
            <span>Status</span>
            <div className="flex items-center gap-2">
              <StatusBadge status={lead.status} domain="lead" className="h-9 px-3" />
              <Button
                size="sm"
                variant={editingStatus ? "default" : "outline"}
                onClick={() => setEditingStatus((v) => !v)}
                className="border-white/10 text-xs font-bold h-9"
              >
                <Sparkles className="h-3.5 w-3.5 mr-1" />
                {editingStatus ? "Close" : "Update Status"}
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1 text-xs text-muted-foreground font-semibold">
            <span>Source</span>
            {editingSource ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Lead source"
                  value={sourceDraft}
                  onChange={(e) => setSourceDraft(e.target.value)}
                  className="h-9 rounded-lg border border-white/10 bg-secondary/40 px-2 text-xs font-semibold text-foreground"
                >
                  {LEAD_SOURCE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value} className="bg-slate-900">{s.label}</option>
                  ))}
                </select>
                <Button
                  size="sm"
                  className="h-9 text-xs font-bold"
                  disabled={updateSourceMutation.isPending || sourceDraft === lead.source}
                  onClick={() => updateSourceMutation.mutate(sourceDraft)}
                >
                  {updateSourceMutation.isPending ? "Saving..." : "Save source"}
                </Button>
                <Button size="sm" variant="outline" className="h-9 text-xs border-white/10" onClick={() => setEditingSource(false)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="h-9 inline-flex items-center rounded-md border border-white/10 px-3 text-xs text-foreground">
                  {leadSourceLabel(lead.source ?? "")}
                </span>
                {canEditSource && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-white/10 text-xs font-bold h-9"
                    onClick={() => {
                      setSourceDraft(lead.source);
                      setEditingSource(true);
                    }}
                  >
                    Edit source
                  </Button>
                )}
              </div>
            )}
          </div>
            {(session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN" || session?.user?.role === "MARKETING_MANAGER") && (
              <Button size="sm" variant="outline" className="border-white/10 text-xs font-bold" onClick={() => setAssignOpen(true)}>
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Assign
              </Button>
            )}
          <Button
            size="sm"
            className="bg-primary text-white text-xs font-bold"
            onClick={() => convertMutation.mutate()}
            disabled={convertMutation.isPending || LOST_STATUSES.has(lead.status)}
          >
            <GraduationCap className="h-3.5 w-3.5 mr-1" /> Convert to Admission
          </Button>
        </div>
      </div>

      {editingStatus ? (
        <div className="glass-card rounded-2xl p-5 border border-white/10 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Update Status
            </h3>
            <Button size="sm" variant="outline" className="border-white/10 text-[10px] font-bold" onClick={() => setEditingStatus(false)}>
              Done
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {STATUS_GROUPS.map((group) => (
              <div key={group.label} className="space-y-2">
                <p className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">{group.label}</p>
                <div className="space-y-1.5">
                  {group.statuses.map((s) => {
                    const selected = lead.status === s;
                    return (
                      <label
                        key={s}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors text-xs font-bold ${
                          selected
                            ? "bg-primary/20 border-primary/40 text-white"
                            : "bg-secondary/30 border-white/5 text-muted-foreground hover:bg-white/5"
                        }`}
                      >
                        <input
                          type="radio"
                          name="lead-status"
                          value={s}
                          checked={selected}
                          onChange={() => {
                            if (LOST_STATUSES.has(s)) {
                              // The selected lost reason is the reason — no note dialog.
                              setPendingStatus(null);
                              updateStatusMutation.mutate({
                                status: s,
                                lostReason: lostReason.trim() ? lostReason : undefined,
                              });
                              setEditingStatus(false);
                              return;
                            }
                            // I3/I8: Connected / Not Connected (and other live
                            // statuses) open the status dialog to schedule a
                            // follow-up and/or log a note before applying.
                            setPendingStatus(s);
                            setFollowUpNote("");
                          }}
                          disabled={updateStatusMutation.isPending}
                          className="accent-primary h-3.5 w-3.5 cursor-pointer"
                        />
                        {statusLabel(s)}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="max-w-xl">
            <Input
              placeholder="Additional lost details (optional)"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              className="bg-secondary/40 border-white/10 text-xs"
            />
          </div>
        </div>
      ) : null}
      {lead.lostReason ? (
        <p className="text-xs text-rose-400 font-semibold">Current lost reason: {lead.lostReason}</p>
      ) : null}

      <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-1">
        {[
          { id: "timeline" as const, label: "Timeline", icon: Clock },
          { id: "scoring" as const, label: "Scoring", icon: Sparkles },
          { id: "manual" as const, label: "Manual Addition", icon: Plus },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${
                isActive
                  ? "bg-primary/20 text-white border-primary/30"
                  : "text-muted-foreground hover:bg-white/5 border-transparent"
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <Button
          size="sm"
          className="bg-primary text-white text-xs font-bold h-[38px]"
          onClick={() => openLog("NOTE")}
        >
          <Plus className="h-3.5 w-3.5 mr-1" /> Manual Addition
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-6">
            <h2 className="text-base font-bold text-white flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-primary" /> Profile
              </div>
              {canEditProfile && (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/10 text-xs font-semibold h-8"
                  onClick={() => setEditProfileOpen(true)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Details
                </Button>
              )}
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Info label="Email" value={lead.email || "-"} icon={Mail} />
              <Info label="Phone" value={lead.phone} icon={Phone} mono />
              <Info label="Course interest" value={lead.courseInterest || "-"} />
              {lead.customFields?.eligibility?.result ? (
                <div data-testid="lead-eligibility" data-result={lead.customFields.eligibility.result}>
                  <Info
                    label="Eligibility pre-check (advisory)"
                    value={`${ELIGIBILITY_LABEL[lead.customFields.eligibility.result] ?? lead.customFields.eligibility.result}${
                      lead.customFields.eligibility.course ? ` · ${lead.customFields.eligibility.course}` : ""
                    }`}
                  />
                </div>
              ) : null}
              <Info label="Counselor" value={lead.counselor?.name || "Unassigned"} />
              <Info label="City" value={lead.city || "-"} />
              <Info label="Pincode" value={lead.pincode || "-"} />
              {lead.googleId ? <Info label="Google ID" value={lead.googleId} mono /> : null}
              {lead.manualAmount != null ? (
                <Info
                  label="Manual amount"
                  value={`₹${Number(lead.manualAmount).toLocaleString("en-IN")}`}
                />
              ) : null}
              {lead.lastDisposition ? (
                <Info
                  label="Last disposition"
                  value={`${lead.lastDisposition}${lead.dispositionAt ? ` · ${formatDate(lead.dispositionAt)}` : ""}`}
                />
              ) : null}
              <Info
                label="Last activity"
                value={lead.lastActivityAt ? formatDateTime(lead.lastActivityAt) : "-"}
              />
            </div>

            <div className="space-y-3 pt-2 border-t border-white/10">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Pipeline</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {canonicalPipeline.map((st, idx) => {
                  const isDone = statusIndex >= 0 && idx <= statusIndex;
                  return (
                    <div
                      key={st}
                      className={`p-2 rounded-xl border text-center ${
                        isDone
                          ? "bg-primary/20 border-primary/30 text-white"
                          : "bg-secondary/30 border-white/5 text-muted-foreground"
                      }`}
                    >
                      <span className="text-[10px] font-bold block">{st.replace(/_/g, " ")}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {activeTab === "timeline" && (
            <UnifiedTimeline
              loading={timelineLoading}
              items={Array.isArray(timeline) ? timeline : []}
              onAdd={() => openLog("NOTE")}
              quickActions
              onQuick={(t) => openLog(t)}
            />
          )}

          {activeTab === "manual" && (
            <UnifiedTimeline
              loading={timelineLoading}
              items={(Array.isArray(timeline) ? timeline : []).filter(
                (e) =>
                  e.kind === "activity" &&
                  !!e.activityType &&
                  (ACTIVITY_TYPES as readonly string[]).includes(e.activityType),
              )}
              onAdd={() => openLog("NOTE")}
              quickActions
              onQuick={(t) => openLog(t)}
              empty="No manual entries yet — add a note, call, email, WhatsApp, meeting or task."
            />
          )}

          {activeTab === "scoring" && (
            <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
              <h2 className="text-base font-bold text-white border-b border-white/10 pb-3">Score history</h2>
              <p className="text-sm text-white font-bold">Current score: {lead.score ?? 0}</p>
              {!lead.scoreHistory?.length ? (
                <p className="text-xs text-muted-foreground">No score history yet. Logging activities updates score.</p>
              ) : (
                <div className="space-y-2">
                  {lead.scoreHistory.map((h) => (
                    <div key={h.id} className="flex justify-between text-xs p-3 rounded-xl bg-secondary/30 border border-white/5">
                      <span className="text-white font-bold">{h.score}</span>
                      <span className="text-muted-foreground">{h.reason || "-"}</span>
                      <span className="text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <InteraktSyncCard leadId={id} />
          <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
            <h3 className="text-sm font-bold uppercase tracking-wider text-white border-b border-white/10 pb-3">
              Follow-up
            </h3>
            <Input
              type="datetime-local"
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              className="bg-secondary/40 border-white/10 text-xs"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                className="text-xs font-bold flex-1"
                onClick={() =>
                  followUpMutation.mutate(followUp ? fromISTInput(followUp) : null)
                }
                disabled={followUpMutation.isPending}
              >
                Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs font-bold border-white/10"
                onClick={() => {
                  setFollowUp("");
                  followUpMutation.mutate(null);
                }}
              >
                Clear
              </Button>
            </div>
            <Button size="sm" variant="outline" className="w-full border-white/10 text-xs font-bold" onClick={() => openLog("TASK")}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Schedule task
            </Button>
          </div>

          {activeDeal || closedDeal ? (
            <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white border-b border-white/10 pb-3">
                Lead Pipeline {activeDeal ? "" : "(archived)"}
              </h3>
              <div>
                <span className="text-xs text-muted-foreground font-semibold">Opportunity</span>
                <p className="text-sm font-bold text-white mt-0.5 truncate">{activeDeal?.title ?? closedDeal?.title}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={activeDeal?.stage ?? closedDeal?.stage ?? "ENQUIRY"} domain="admission" />
                {activeDeal?.wonAt ? <StatusBadge status="WON" domain="lead" /> : null}
                {activeDeal?.lostAt ? <StatusBadge status="LOST" domain="lead" /> : null}
              </div>
              {activeDeal && activeDeal.value != null && Number(activeDeal.value) > 0 && (
                <p className="text-sm font-bold text-white">₹{Number(activeDeal.value).toLocaleString("en-IN")}</p>
              )}
              {activeDeal?.admission ? (
                <p className="text-xs text-emerald-400 font-semibold">
                  Converted to {activeDeal.admission.applicationNo}
                </p>
              ) : null}
              {activeDeal && !activeDeal.wonAt && !activeDeal.lostAt && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {["FEE_PAYMENT", "VERIFICATION", "ENROLLED"]
                    .filter(
                      (s) =>
                        DEAL_STAGE_ORDER.indexOf(s) >
                        DEAL_STAGE_ORDER.indexOf(canonicalAdmissionStage(activeDeal.stage)),
                    )
                    .map((nextStage) => (
                      <Button
                        key={nextStage}
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] font-bold border-white/10"
                        disabled={dealStageMutation.isPending || convertDealMutation.isPending}
                        onClick={() =>
                          nextStage === "ENROLLED"
                            ? convertDealMutation.mutate(activeDeal.id)
                            : dealStageMutation.mutate({ dealId: activeDeal.id, stage: nextStage })
                        }
                      >
                        {admissionStageLabel(nextStage)}
                      </Button>
                    ))}
                  {["DROPPED", "CANCELLED"].map((lostStage) => (
                    <Button
                      key={lostStage}
                      size="sm"
                      variant="outline"
                      className="h-7 text-[10px] font-bold border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                      disabled={dealStageMutation.isPending}
                      onClick={() => dealStageMutation.mutate({ dealId: activeDeal.id, stage: lostStage })}
                    >
                      {admissionStageLabel(lostStage)}
                    </Button>
                  ))}
                </div>
              )}
              {activeDeal?.wonAt ? (
                <Button
                  variant="outline"
                  className="w-full border-white/10 text-xs font-bold"
                  size="sm"
                  disabled={revertDealMutation.isPending}
                  onClick={() => revertDealMutation.mutate(activeDeal.id)}
                >
                  Move back to Prospect
                </Button>
              ) : null}
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-3">
              <h3 className="text-sm font-bold text-white">Not in the Lead Pipeline yet</h3>
              <p className="text-xs text-muted-foreground">
                Set this lead&apos;s status to Prospect to add it to the Lead Pipeline, or convert directly to an admission.
              </p>
            </div>
          )}

          {primaryAdmission ? (
            <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
              <h3 className="text-sm font-bold uppercase tracking-wider text-white border-b border-white/10 pb-3">
                Admission
              </h3>
              <div>
                <span className="text-xs text-muted-foreground font-semibold">Application</span>
                <p className="text-sm font-bold text-white mt-0.5">{primaryAdmission.applicationNo}</p>
              </div>
              <StatusBadge status={primaryAdmission.stage} domain="admission" />
              <Button variant="outline" className="w-full border-white/10 text-xs font-bold" asChild>
                <a href={`/admissions?id=${primaryAdmission.id}`}>Open admission</a>
              </Button>
            </div>
          ) : (
            <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-3">
              <h3 className="text-sm font-bold text-white">No admission yet</h3>
              <p className="text-xs text-muted-foreground">Convert this lead to start the admissions workflow.</p>
            </div>
          )}

          <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-3 text-xs">
            <h3 className="text-sm font-bold text-white border-b border-white/10 pb-3">Metadata</h3>
            <div>
              <span className="text-muted-foreground block font-semibold">Lead ID</span>
              <span className="font-mono text-white font-bold break-all">{lead.id}</span>
            </div>
            <div>
              <span className="text-muted-foreground block font-semibold">Updated</span>
              <span className="text-white font-bold">{formatDateTime(lead.updatedAt)}</span>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="max-w-md glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Log activity</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => addActivityMutation.mutate(d))} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Type</Label>
              <select
                className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/40 px-3 py-1 text-xs font-semibold"
                {...register("activityType")}
                defaultValue={logDefaultType}
              >
                {ACTIVITY_TYPES.map((t) => (
                  <option key={t} value={t} className="bg-slate-900">
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Title (optional)</Label>
              <Input className="bg-secondary/40 border-white/10 text-xs" {...register("title")} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Notes *</Label>
              <Textarea rows={4} className="bg-secondary/40 border-white/10 text-xs" {...register("notes")} />
              {errors.notes && <p className="text-xs text-destructive">{errors.notes.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Outcome (optional)</Label>
              <Input className="bg-secondary/40 border-white/10 text-xs" {...register("outcome")} />
            </div>
            {(activityType === "TASK" || activityType === "MEETING") && (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground">Due at</Label>
                <Input type="datetime-local" className="bg-secondary/40 border-white/10 text-xs" {...register("dueAt")} />
              </div>
            )}
            {activityType === "CALL" && (
              <div className="space-y-1.5">
                <Label className="text-xs font-bold text-muted-foreground">Duration (minutes)</Label>
                <Input type="number" className="bg-secondary/40 border-white/10 text-xs" {...register("durationMins")} />
              </div>
            )}
            <DialogFooter className="pt-4 border-t border-white/10">
              <Button type="button" variant="outline" onClick={() => setLogOpen(false)} className="border-white/10 text-xs font-bold">
                Cancel
              </Button>
              <Button type="submit" disabled={addActivityMutation.isPending} className="bg-primary text-white text-xs font-bold">
                {addActivityMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-white font-bold">Assign counselor</DialogTitle>
          </DialogHeader>
          <Select value={counselorId} onValueChange={setCounselorId}>
            <SelectTrigger className="bg-secondary/60 border-white/10 text-xs">
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent className="glass-panel border-white/10 text-xs">
              {counselorOptions.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.name} ({u.role})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button
              className="text-xs font-bold"
              disabled={!counselorId || assignMutation.isPending}
              onClick={() => assignMutation.mutate(counselorId)}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!pendingStatus} onOpenChange={(o) => !o && setPendingStatus(null)}>
        <DialogContent className="max-w-sm glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-white font-bold flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" /> Status: {(pendingStatus ?? "").replace(/_/g, " ")}
            </DialogTitle>
            <p className="text-xs text-muted-foreground pt-1.5">
              Schedule the next follow-up and/or note the outcome before applying.
            </p>
          </DialogHeader>
          <div className="space-y-4 pt-2 max-h-[60vh] overflow-y-auto pr-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Next follow-up (calendar)</Label>
              <Input
                type="datetime-local"
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                className="bg-secondary/40 border-white/10 text-xs"
              />
            </div>
            
            {(pendingStatus === "PROSPECT" || pendingStatus === "WON") && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-muted-foreground">Course Decided</Label>
                  <Select value={courseId} onValueChange={setCourseId}>
                    <SelectTrigger className="bg-secondary/40 border-white/10 text-xs">
                      <SelectValue placeholder="Select course" />
                    </SelectTrigger>
                    <SelectContent className="glass-panel border-white/10 text-xs">
                      <SelectItem value="unselected">-- Not Selected --</SelectItem>
                      {courses.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-muted-foreground">Batch Decided</Label>
                  <Select value={batchId} onValueChange={setBatchId}>
                    <SelectTrigger className="bg-secondary/40 border-white/10 text-xs">
                      <SelectValue placeholder="Select batch" />
                    </SelectTrigger>
                    <SelectContent className="glass-panel border-white/10 text-xs">
                      <SelectItem value="unselected">-- Not Selected --</SelectItem>
                      {batches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-bold text-muted-foreground">Fee Decided (₹)</Label>
                  <Input
                    type="number"
                    value={feeDecided}
                    onChange={(e) => setFeeDecided(e.target.value)}
                    placeholder="e.g. 50000"
                    className="bg-secondary/40 border-white/10 text-xs"
                  />
                </div>
              </>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-muted-foreground">Note (optional)</Label>
              <Textarea
                rows={3}
                value={followUpNote}
                onChange={(e) => setFollowUpNote(e.target.value)}
                placeholder="What happened on this call / contact?"
                className="bg-secondary/40 border-white/10 text-xs"
              />
            </div>
          </div>
          <DialogFooter className="pt-4 border-t border-white/10">
            <Button
              type="button"
              variant="outline"
              className="border-white/10 text-xs font-bold"
              onClick={() => setPendingStatus(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="text-xs font-bold"
              disabled={!pendingStatus || updateStatusMutation.isPending || convertLeadMutation.isPending || addActivityMutation.isPending}
              onClick={async () => {
                if (!pendingStatus) return;

                const dealData = pendingStatus === "PROSPECT" || pendingStatus === "WON" ? {
                  ...(courseId !== "unselected" && { courseId }),
                  ...(batchId !== "unselected" && { batchId }),
                  ...(feeDecided && { value: Number(feeDecided) }),
                } : undefined;

                const noteText = followUpNote.trim();

                try {
                  if (pendingStatus === "WON") {
                    await convertLeadMutation.mutateAsync({
                      dealData,
                      notes: noteText.length >= 2 ? noteText : undefined,
                    });
                  } else {
                    await updateStatusMutation.mutateAsync({
                      status: pendingStatus,
                      nextFollowUp: followUp ? fromISTInput(followUp) : undefined,
                      dealData
                    });

                    if (noteText.length >= 2) {
                      await addActivityMutation.mutateAsync({
                        activityType: "NOTE",
                        notes: noteText,
                      });
                    }
                  }
                  
                  setPendingStatus(null);
                  setFollowUpNote("");
                  setEditingStatus(false);
                } catch (e) {
                  // error handled by mutation onError
                }
              }}
            >
              {(updateStatusMutation.isPending || convertLeadMutation.isPending || addActivityMutation.isPending) ? "Saving..." : "Apply & Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Initiate Agent Call Modal */}
      <Dialog open={agentCallOpen} onOpenChange={setAgentCallOpen}>
        <DialogContent className="glass-card border-white/10 text-white max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
                <Bot className="h-4 w-4" />
              </div>
              Initiate Outbound AI Agent Call
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              The AI Voice Assistant will dial <span className="text-white font-mono font-bold">{lead.phone}</span> immediately via TeleCMI and engage the candidate as Captain Navrang. The call audio recording and transcript will be saved directly against this lead.
            </p>

            <div className="p-3 rounded-xl bg-secondary/30 border border-white/5 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Candidate:</span>
                <span className="font-semibold text-white">{lead.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Course Interest:</span>
                <span className="font-semibold text-white">{lead.courseInterest || "Commercial Pilot License (CPL)"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Caller ID:</span>
                <span className="font-mono text-indigo-300">+91 79434 46755 (Airborne AI)</span>
              </div>
              <div className="flex justify-between items-center pt-1 border-t border-white/5">
                <span className="text-muted-foreground">Concurrency Guard:</span>
                <span className="font-mono text-emerald-400 text-[11px] font-semibold">Active (Max 2 simultaneous calls)</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">
                Call Objective & Guidance for AI (Optional)
              </Label>
              <Textarea
                value={agentCallObjective}
                onChange={(e) => setAgentCallObjective(e.target.value)}
                placeholder="e.g. Inquire if candidate passed 10+2 with Physics & Maths, inform about upcoming CPL batch, or invite for campus visit at Ramphal Chowk."
                className="bg-secondary/40 border-white/10 text-xs h-24"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAgentCallOpen(false)} disabled={agentCallMutation.isPending}>
              Cancel
            </Button>
            <Button
              className="bg-indigo-600 hover:bg-indigo-500 text-white font-bold gap-2 text-xs"
              disabled={agentCallMutation.isPending}
              onClick={() => agentCallMutation.mutate({ objective: agentCallObjective })}
            >
              {agentCallMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Connecting Carrier...
                </>
              ) : (
                <>
                  <PhoneCall className="h-3.5 w-3.5" />
                  Dial Candidate Now
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Profile Details Modal */}
      <Dialog open={editProfileOpen} onOpenChange={setEditProfileOpen}>
        <DialogContent className="glass-card border-white/10 text-white max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Edit Lead Profile</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 py-4">
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Full Name *</Label>
              <Input
                value={editProfileForm.name}
                onChange={(e) => setEditProfileForm((prev) => ({ ...prev, name: e.target.value }))}
                className="bg-secondary/40 border-white/10"
                placeholder="Full Name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Phone Number *</Label>
              <Input
                value={editProfileForm.phone}
                onChange={(e) => setEditProfileForm((prev) => ({ ...prev, phone: e.target.value }))}
                className="bg-secondary/40 border-white/10"
                placeholder="+91..."
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Email Address (Optional)</Label>
              <Input
                value={editProfileForm.email}
                onChange={(e) => setEditProfileForm((prev) => ({ ...prev, email: e.target.value }))}
                className="bg-secondary/40 border-white/10"
                placeholder="student@example.com"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Course Interest</Label>
              <Input
                value={editProfileForm.courseInterest}
                onChange={(e) => setEditProfileForm((prev) => ({ ...prev, courseInterest: e.target.value }))}
                className="bg-secondary/40 border-white/10"
                placeholder="e.g. Commercial Pilot License (CPL)"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">City</Label>
              <Input
                value={editProfileForm.city}
                onChange={(e) => setEditProfileForm((prev) => ({ ...prev, city: e.target.value }))}
                className="bg-secondary/40 border-white/10"
                placeholder="City"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">State</Label>
              <Input
                value={editProfileForm.state}
                onChange={(e) => setEditProfileForm((prev) => ({ ...prev, state: e.target.value }))}
                className="bg-secondary/40 border-white/10"
                placeholder="State"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Pincode</Label>
              <Input
                value={editProfileForm.pincode}
                onChange={(e) => setEditProfileForm((prev) => ({ ...prev, pincode: e.target.value }))}
                className="bg-secondary/40 border-white/10"
                placeholder="Pincode"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Agreed / Manual Amount (₹)</Label>
              <Input
                type="number"
                value={editProfileForm.manualAmount}
                onChange={(e) => setEditProfileForm((prev) => ({ ...prev, manualAmount: e.target.value }))}
                className="bg-secondary/40 border-white/10"
                placeholder="Fee amount"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setEditProfileOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-primary text-white"
              disabled={updateProfileMutation.isPending || !editProfileForm.name.trim() || !editProfileForm.phone.trim()}
              onClick={() => updateProfileMutation.mutate(editProfileForm)}
            >
              {updateProfileMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({
  label,
  value,
  icon: Icon,
  mono,
}: {
  label: string;
  value: string;
  icon?: React.ElementType;
  mono?: boolean;
}) {
  return (
    <div className="p-4 rounded-xl bg-secondary/30 border border-white/5 space-y-1">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <div className={`flex items-center gap-2 text-sm font-bold text-white ${mono ? "font-mono" : ""}`}>
        {Icon ? <Icon className="h-4 w-4 text-primary" /> : null}
        {value}
      </div>
    </div>
  );
}

const KIND_STYLES: Record<
  TimelineEntry["kind"],
  { icon: React.ElementType; label: string; badge: string }
> = {
  activity: { icon: FileText, label: "Activity", badge: "bg-sky-500/20 text-sky-400 border-sky-500/30" },
  notification: { icon: Send, label: "Message", badge: "bg-violet-500/20 text-violet-400 border-violet-500/30" },
  automation: { icon: Workflow, label: "Automation", badge: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" },
};

function UnifiedTimeline({
  loading,
  items,
  onAdd,
  empty = "Nothing yet — activities, messages and automations will appear here.",
  quickActions,
  onQuick,
  quickTypes = ["NOTE", "CALL", "EMAIL", "WHATSAPP", "TASK"],
}: {
  loading: boolean;
  items: TimelineEntry[];
  onAdd: () => void;
  empty?: string;
  quickActions?: boolean;
  onQuick?: (t: (typeof ACTIVITY_TYPES)[number]) => void;
  quickTypes?: (typeof ACTIVITY_TYPES)[number][];
}) {
  return (
    <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-6">
      <div className="flex items-center justify-between border-b border-white/10 pb-3 gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Unified timeline
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5 font-semibold">
            Activities · messages · automations in one stream
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {quickActions && onQuick
            ? quickTypes.map((t) => (
                <Button key={t} size="sm" variant="outline" className="border-white/10 text-[10px] font-bold" onClick={() => onQuick(t)}>
                  {t}
                </Button>
              ))
            : null}
          <Button size="sm" onClick={onAdd} className="bg-primary text-white text-xs font-bold">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <p className="text-xs text-muted-foreground text-center py-8 font-semibold">{empty}</p>
      ) : (
        <div className="space-y-4">
          {items.map((entry) => {
            const kindStyle = KIND_STYLES[entry.kind] ?? KIND_STYLES.activity;
            const KindIcon = kindStyle.icon;
            const activityIcon = entry.activityType ? ACTIVITY_ICONS[entry.activityType] : undefined;
            const Icon = entry.kind === "activity" && activityIcon ? activityIcon : KindIcon;
            return (
              <div key={entry.id} className="flex gap-4 p-4 rounded-xl bg-secondary/30 border border-white/5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary border border-primary/30">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1 gap-2 flex-wrap">
                    <span className="text-xs font-bold text-white">{entry.title}</span>
                    <span className="text-[10px] font-medium text-muted-foreground">{formatDateTime(entry.at)}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-[9px] font-extrabold uppercase tracking-wider border px-1.5 py-0.5 rounded-full ${kindStyle.badge}`}>
                      {entry.channel ? `${kindStyle.label} · ${entry.channel}` : kindStyle.label}
                    </span>
                    {entry.status ? (
                      <span
                        className={`text-[9px] font-extrabold uppercase tracking-wider border px-1.5 py-0.5 rounded-full ${
                          /FAILED|ERROR|OPEN/i.test(entry.status)
                            ? "bg-rose-500/20 text-rose-400 border-rose-500/30"
                            : /SENT|DONE|COMPLETED|RUNNING/i.test(entry.status)
                              ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                              : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        }`}
                      >
                        {entry.status}
                      </span>
                    ) : null}
                  </div>
                  {entry.detail ? <p className="text-xs text-muted-foreground leading-relaxed break-words">{entry.detail}</p> : null}
                  <CallRecordingPlayer metadata={entry.metadata} durationMins={entry.durationMins} notes={entry.detail} />
                  {entry.actorName ? (
                    <p className="text-[10px] text-primary font-semibold mt-1">
                      {entry.kind === "automation" ? "Triggered by" : "Logged by"} {entry.actorName}
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TimelineCard({
  title,
  loading,
  items,
  onAdd,
  onComplete,
  empty = "No timeline activities logged yet.",
  quickActions,
  onQuick,
  quickTypes = ["NOTE", "CALL", "EMAIL", "WHATSAPP", "TASK"],
}: {
  title: string;
  loading: boolean;
  items: LeadActivity[];
  onAdd: () => void;
  onComplete: (id: string) => void;
  empty?: string;
  quickActions?: boolean;
  onQuick?: (t: (typeof ACTIVITY_TYPES)[number]) => void;
  quickTypes?: (typeof ACTIVITY_TYPES)[number][];
}) {
  return (
    <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-6">
      <div className="flex items-center justify-between border-b border-white/10 pb-3 gap-3 flex-wrap">
        <h2 className="text-base font-bold text-white flex items-center gap-2">
          <Clock className="h-4 w-4 text-primary" /> {title}
        </h2>
        <div className="flex gap-2 flex-wrap">
          {quickActions && onQuick
            ? quickTypes.map((t) => (
                <Button key={t} size="sm" variant="outline" className="border-white/10 text-[10px] font-bold" onClick={() => onQuick(t)}>
                  {t}
                </Button>
              ))
            : null}
          <Button size="sm" onClick={onAdd} className="bg-primary text-white text-xs font-bold">
            <Plus className="h-3.5 w-3.5 mr-1" /> Add
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : !items.length ? (
        <p className="text-xs text-muted-foreground text-center py-8 font-semibold">{empty}</p>
      ) : (
        <div className="space-y-4">
          {items.map((act) => {
            const Icon = ACTIVITY_ICONS[act.activityType] ?? FileText;
            const openTask = act.activityType === "TASK" && !act.completedAt;
            return (
              <div key={act.id} className="flex gap-4 p-4 rounded-xl bg-secondary/30 border border-white/5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary border border-primary/30">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1 gap-2">
                    <span className="text-xs font-bold text-white">
                      {act.title || act.activityType.replace(/_/g, " ")}
                      {openTask ? " · open" : act.completedAt && act.activityType === "TASK" ? " · done" : ""}
                    </span>
                    <span className="text-[10px] font-medium text-muted-foreground">{formatDateTime(act.createdAt)}</span>
                  </div>
                  {act.notes ? <p className="text-xs text-muted-foreground leading-relaxed">{act.notes}</p> : null}
                  <CallRecordingPlayer metadata={act.metadata} durationMins={act.durationMins} notes={act.notes} />
                  {act.outcome ? <p className="text-[10px] text-emerald-400 mt-1">Outcome: {act.outcome}</p> : null}
                  {act.dueAt ? <p className="text-[10px] text-amber-400 mt-1">Due {formatDateTime(act.dueAt)}</p> : null}
                  {act.performer ? (
                    <p className="text-[10px] text-primary font-semibold mt-1">Logged by {act.performer.name}</p>
                  ) : null}
                  {openTask ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="mt-2 h-7 text-[10px] font-bold border-white/10"
                      onClick={() => onComplete(act.id)}
                    >
                      Mark complete
                    </Button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
