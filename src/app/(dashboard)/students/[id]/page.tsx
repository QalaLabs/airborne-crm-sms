"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Award,
  ArrowLeft,
  Mail,
  Phone,
  Calendar,
  User,
  BookOpen,
  Building2,
  GraduationCap,
  FileText,
  Landmark,
  ShieldCheck,
  Pencil,
  Save,
  X,
  Clock,
  Send,
  Workflow,
  MessageSquare,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/use-toast";
import { apiFetch } from "@/lib/api";
import { formatDate, getInitials } from "@/lib/utils";
import { roleCan } from "@/lib/utils/permissions";

interface CourseRef {
  id: string;
  title: string;
}

interface BatchRef {
  id: string;
  name: string;
}

interface Financial {
  feeAmount?: number | string | null;
  feeDiscount?: number | string | null;
  feeFinal?: number | string | null;
  feePaid?: number | string | null;
  feeBalance?: number | string | null;
}

interface AdmissionRef {
  id: string;
  applicationNo: string;
  stage: string;
  courseName?: string | null;
  batchName?: string | null;
  batchStartDate?: string | null;
  counselor?: { id: string; name: string } | null;
  course?: CourseRef | null;
  batch?: { id: string; name: string; capacity?: number | null } | null;
  campus?: { id: string; name: string } | null;
  _count?: { documents?: number };
  [key: string]: unknown;
}

interface LmsEnrollmentRef {
  id: string;
  status: string;
  enrolledAt?: string | null;
  course?: { id: string; title: string; slug?: string } | null;
  batch?: BatchRef | null;
}

interface BatchMembershipRef {
  id: string;
  batch?: { id: string; name: string; startDate?: string | null; endDate?: string | null; capacity?: number | null; type?: string } | null;
}

interface DocumentRef {
  id: string;
  name: string;
  documentType: string;
  status: string;
  fileUrl?: string | null;
  fileSizeBytes?: number | null;
  createdAt?: string;
  reviewedAt?: string | null;
}

interface PaymentRef {
  id: string;
  amount: number | string;
  refundedAmount?: number | string | null;
  currency?: string;
  method?: string;
  status?: string;
  feeType?: string | null;
  receiptNo?: string | null;
  paidAt?: string | null;
  createdAt?: string;
  admission?: { applicationNo?: string } | null;
}

interface Student {
  id: string;
  studentId: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  dateOfBirth?: string;
  gender?: string;
  nationality?: string;
  address?: unknown;
  campusId?: string | null;
  campus?: { id: string; name: string };
  course?: { id: string; title: string };
  enrolledAt?: string;
  avatarUrl?: string;
  admission?: { applicationNo: string; stage: string };
  guardianName?: string | null;
  guardianPhone?: string | null;
  guardianEmail?: string | null;
  medicalFitness?: boolean;
  class10Board?: string | null;
  class10Year?: number | null;
  class10Percent?: number | null;
  class12Board?: string | null;
  class12Year?: number | null;
  class12Percent?: number | null;
  class12Stream?: string | null;
  lead?: { id: string; name: string; email?: string | null; phone?: string } | null;
  admissions?: AdmissionRef[];
  lmsEnrollments?: LmsEnrollmentRef[];
  lmsBatchMemberships?: BatchMembershipRef[];
  documents?: DocumentRef[];
  payments?: PaymentRef[];
}

// Mirrors the server-side rule set (student.service.ts).
const STUDENT_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ["GRADUATED", "DROPPED", "SUSPENDED", "ON_HOLD"],
  ON_HOLD: ["ACTIVE", "DROPPED"],
  SUSPENDED: ["ACTIVE", "DROPPED"],
  GRADUATED: [],
  DROPPED: [],
};

function formatAddress(address: unknown): string | null {
  if (!address) return null;
  if (typeof address === "string") return address;
  if (typeof address === "object") {
    const a = address as Record<string, unknown>;
    const parts = [a.line1, a.line2, a.city, a.state, a.pincode].filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0,
    );
    return parts.length ? parts.join(", ") : null;
  }
  return null;
}

function asAddressObject(address: unknown): Record<string, string> {
  if (address && typeof address === "object") {
    const a = address as Record<string, unknown>;
    return {
      line1: typeof a.line1 === "string" ? a.line1 : "",
      line2: typeof a.line2 === "string" ? a.line2 : "",
      city: typeof a.city === "string" ? a.city : "",
      state: typeof a.state === "string" ? a.state : "",
      pincode: typeof a.pincode === "string" ? a.pincode : "",
    };
  }
  return { line1: "", line2: "", city: "", state: "", pincode: "" };
}

function money(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN")}` : "-";
}

function paymentStatusClass(status?: string) {
  if (status === "COMPLETED") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (status === "PENDING") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  if (status === "FAILED") return "bg-rose-500/20 text-rose-400 border-rose-500/30";
  if (status === "REFUNDED" || status === "PARTIALLY_REFUNDED") return "bg-sky-500/20 text-sky-400 border-sky-500/30";
  return "bg-slate-500/20 text-slate-400 border-slate-500/30";
}

const fmtSize = (bytes?: number | null) => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editing, setEditing] = React.useState(false);
  const { data: session } = useSession();
  const canViewCertificates = roleCan(session?.user?.role, "read", "lms_certificates");
  const canDelete = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      return apiFetch(`/students/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["student", id] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["admissions"] });
      setDeleteOpen(false);
      toast({
        title: "Student moved to Recycle Bin",
        description: "Student record and associated lead moved to Recycle Bin.",
      });
      router.push("/students");
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: student, isLoading } = useQuery({
    queryKey: ["student", id],
    queryFn: async () => {
      const res = await apiFetch<Record<string, unknown>>(`/students/${id}`);
      const firstName = (res.firstName as string) || "";
      const lastName = (res.lastName as string) || "";
      return {
        ...res,
        name: (res.name as string) || `${firstName} ${lastName}`.trim() || "Unknown Student",
        studentId: (res.studentId as string) || (res.studentCode as string) || "-",
      } as Student;
    },
    enabled: !!id,
  });

  const { data: certificates, isError: certificatesError } = useQuery({
    queryKey: ["student-certificates", id],
    queryFn: () =>
      apiFetch<{ id: string; certificateNo: string; title: string | null; status: string; issuedAt: string | null; course?: { title: string } | null }[]>(
        `/lms/certificates?studentId=${encodeURIComponent(id)}`,
      ),
    enabled: !!id && canViewCertificates,
  });

  const { data: campuses } = useQuery({
    queryKey: ["campuses"],
    queryFn: async () => {
      try {
        const res = await apiFetch<{ id: string; name: string; code?: string }[]>("/organizations/campuses?includeInactive=true");
        return Array.isArray(res) ? res : [];
      } catch {
        return [];
      }
    },
  });

  const { data: timelineItems = [], isLoading: timelineLoading } = useQuery({
    queryKey: ["student", id, "timeline"],
    queryFn: async () => {
      try {
        const res = await apiFetch<
          {
            id: string;
            kind: "activity" | "notification" | "automation";
            at: string;
            title: string;
            detail?: string | null;
            status?: string | null;
            channel?: string | null;
            actorName?: string | null;
            activityType?: string | null;
          }[]
        >(`/students/${id}/timeline`);
        return Array.isArray(res) ? res : [];
      } catch {
        return [];
      }
    },
    enabled: !!id,
  });

  const editable = React.useMemo(() => {
    if (!student) return null;
    const addr = asAddressObject(student.address);
    return {
      // Use the stored parts — re-splitting the display name mangles multi-word first names.
      firstName: (student as { firstName?: string }).firstName ?? student.name.split(" ")[0] ?? "",
      lastName: (student as { lastName?: string }).lastName ?? student.name.split(" ").slice(1).join(" ") ?? "",
      email: student.email,
      phone: student.phone,
      gender: student.gender ?? "",
      nationality: student.nationality ?? "",
      dateOfBirth: student.dateOfBirth ? (student.dateOfBirth as string).slice(0, 10) : "",
      address: addr,
      guardianName: student.guardianName ?? "",
      guardianPhone: student.guardianPhone ?? "",
      guardianEmail: student.guardianEmail ?? "",
      medicalFitness: student.medicalFitness ?? false,
      class10Board: student.class10Board ?? "",
      class10Year: student.class10Year != null ? String(student.class10Year) : "",
      class10Percent: student.class10Percent != null ? String(student.class10Percent) : "",
      class12Board: student.class12Board ?? "",
      class12Year: student.class12Year != null ? String(student.class12Year) : "",
      class12Percent: student.class12Percent != null ? String(student.class12Percent) : "",
      class12Stream: student.class12Stream ?? "",
      campusId: student.campusId ?? "",
      status: student.status,
    };
  }, [student]);

  const [form, setForm] = React.useState<Record<string, any> | null>(null);
  React.useEffect(() => {
    if (editable) setForm(() => JSON.parse(JSON.stringify(editable)));
    else setForm(null);
  }, [editable, editing]);

  const set = (key: string, value: unknown) =>
    setForm((f: Record<string, any> | null) => (f ? { ...f, [key]: value } : f));

  const onSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["student", id] });
    queryClient.invalidateQueries({ queryKey: ["students"] });
    setEditing(false);
    toast({ title: "Student updated" });
  };

  const updateMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/students/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess,
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const onSave = () => {
    if (!form) return;
    const body: Record<string, unknown> = {
      firstName: String(form.firstName ?? "").trim() || undefined,
      lastName: String(form.lastName ?? "").trim() || undefined,
      email: form.email,
      phone: String(form.phone ?? "").trim() || undefined,
      nationality: form.nationality || "Indian",
      address: {
        line1: form.address.line1 || undefined,
        line2: form.address.line2 || undefined,
        city: form.address.city || undefined,
        state: form.address.state || undefined,
        pincode: form.address.pincode || undefined,
        country: "IN",
      },
      guardianName: form.guardianName || undefined,
      guardianPhone: form.guardianPhone || undefined,
      guardianEmail: form.guardianEmail || undefined,
      medicalFitness: form.medicalFitness,
      class10Board: form.class10Board || undefined,
      class10Year: form.class10Year !== "" ? Number(form.class10Year) : undefined,
      class10Percent: form.class10Percent !== "" ? Number(form.class10Percent) : undefined,
      class12Board: form.class12Board || undefined,
      class12Year: form.class12Year !== "" ? Number(form.class12Year) : undefined,
      class12Percent: form.class12Percent !== "" ? Number(form.class12Percent) : undefined,
      class12Stream: form.class12Stream || undefined,
      campusId: form.campusId || null,
    };
    if (form.dateOfBirth) body.dateOfBirth = new Date(`${form.dateOfBirth}T00:00:00.000Z`).toISOString();
    if (form.gender) body.gender = form.gender;
    if (form.status && form.status !== student?.status) body.status = form.status;
    updateMutation.mutate(body);
  };

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="lg:col-span-2 h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!student) return null;

  const addressText = formatAddress(student.address);
  const latestAdmission = student.admissions?.[0];
  const currentCourse = latestAdmission?.course ?? student.course;
  const currentBatch = latestAdmission?.batch;
  const enrolledCount = (student.lmsEnrollments ?? []).length;
  const docStatusClass = (status: string) => {
    if (status === "APPROVED") return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (status === "REJECTED") return "bg-rose-500/20 text-rose-400 border-rose-500/30";
    if (status === "UNDER_REVIEW") return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (status === "UPLOADED") return "bg-slate-500/20 text-slate-400 border-slate-500/30";
    return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/students")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <Avatar className="h-12 w-12">
            {student.avatarUrl && <AvatarImage src={student.avatarUrl} />}
            <AvatarFallback>{getInitials(student.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">{student.name}</h1>
            <p className="text-sm text-muted-foreground">{student.studentId}</p>
          </div>
          <StatusBadge status={student.status} domain="student" />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant={editing ? "outline" : "default"}
            onClick={() => setEditing((v) => !v)}
            className="shrink-0"
          >
            {editing ? <X className="h-4 w-4 mr-1.5" /> : <Pencil className="h-4 w-4 mr-1.5" />}
            {editing ? "Cancel" : "Edit profile"}
          </Button>
          {canDelete && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeleteOpen(true)}
              className="border-rose-500/30 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Move to Bin
            </Button>
          )}
        </div>
      </div>

      {editing && form ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">First name</Label>
                <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Last name</Label>
                <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Email</Label>
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Phone</Label>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Gender</Label>
                <Select value={form.gender || "UNKNOWN"} onValueChange={(v) => set("gender", v === "UNKNOWN" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="UNKNOWN">—</SelectItem>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Nationality</Label>
                <Input value={form.nationality} onChange={(e) => set("nationality", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Date of birth</Label>
                <Input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Campus</Label>
                <Select value={form.campusId || "NONE"} onValueChange={(v) => set("campusId", v === "NONE" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Unassigned</SelectItem>
                    {(campuses ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input placeholder="Address line 1" value={form.address.line1} onChange={(e) => set("address", { ...form.address, line1: e.target.value })} className="h-8 text-xs" />
              <Input placeholder="Address line 2" value={form.address.line2} onChange={(e) => set("address", { ...form.address, line2: e.target.value })} className="h-8 text-xs" />
              <Input placeholder="City" value={form.address.city} onChange={(e) => set("address", { ...form.address, city: e.target.value })} className="h-8 text-xs" />
              <Input placeholder="State" value={form.address.state} onChange={(e) => set("address", { ...form.address, state: e.target.value })} className="h-8 text-xs" />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Guardian name</Label>
                <Input value={form.guardianName} onChange={(e) => set("guardianName", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Guardian phone</Label>
                <Input value={form.guardianPhone} onChange={(e) => set("guardianPhone", e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1 lg:col-span-2">
                <Label className="text-[10px] font-bold text-muted-foreground">Guardian email</Label>
                <Input type="email" value={form.guardianEmail} onChange={(e) => set("guardianEmail", e.target.value)} className="h-8 text-xs" />
              </div>
            </div>

            <div>
              <Label className="text-[10px] font-bold text-muted-foreground">Class 10</Label>
              <div className="grid grid-cols-3 gap-2">
                <Input placeholder="Board" value={form.class10Board} onChange={(e) => set("class10Board", e.target.value)} className="h-8 text-xs" />
                <Input placeholder="Year" type="number" min={1990} max={2030} step={1} value={form.class10Year} onChange={(e) => set("class10Year", e.target.value)} className="h-8 text-xs" />
                <Input placeholder="Percent" type="number" min={0} max={100} step="0.01" value={form.class10Percent} onChange={(e) => set("class10Percent", e.target.value)} className="h-8 text-xs" />
              </div>
            </div>

            <div>
              <Label className="text-[10px] font-bold text-muted-foreground">Class 12</Label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Input placeholder="Board" value={form.class12Board} onChange={(e) => set("class12Board", e.target.value)} className="h-8 text-xs" />
                <Input placeholder="Year" type="number" min={1990} max={2030} step={1} value={form.class12Year} onChange={(e) => set("class12Year", e.target.value)} className="h-8 text-xs" />
                <Input placeholder="Percent" type="number" min={0} max={100} step="0.01" value={form.class12Percent} onChange={(e) => set("class12Percent", e.target.value)} className="h-8 text-xs" />
                <Select value={form.class12Stream || "NONE"} onValueChange={(v) => set("class12Stream", v === "NONE" ? "" : v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Stream" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">—</SelectItem>
                    <SelectItem value="SCIENCE">Science</SelectItem>
                    <SelectItem value="COMMERCE">Commerce</SelectItem>
                    <SelectItem value="ARTS">Arts</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 items-end">
              <div className="space-y-1">
                <Label className="text-[10px] font-bold text-muted-foreground">Status</Label>
                <Select value={form.status || "ACTIVE"} onValueChange={(v) => set("status", v)}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(STUDENT_TRANSITIONS).map((s) => (
                      <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {student.status && (
                  <p className="text-[10px] text-muted-foreground">
                    Current: {student.status.replace(/_/g, " ")} · Allowed:{" "}
                    {(STUDENT_TRANSITIONS[student.status] ?? [])
                      .map((s) => s.replace(/_/g, " "))
                      .join(", ") || "none"}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between rounded-lg border border-white/10 p-2">
                <Label className="text-[10px] font-bold text-muted-foreground">Medical fitness</Label>
                <Switch checked={form.medicalFitness} onCheckedChange={(v) => set("medicalFitness", v)} />
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setForm(null); }}>
                Cancel
              </Button>
              <Button size="sm" disabled={updateMutation.isPending} onClick={onSave}>
                {updateMutation.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <User className="h-4 w-4" /> Personal Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Email</p>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        {student.email}
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Phone</p>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                        {student.phone}
                      </div>
                    </div>
                    {student.dateOfBirth && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Date of Birth</p>
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                          {formatDate(student.dateOfBirth)}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Enrolled</p>
                      <p className="text-sm font-medium">{formatDate(student.enrolledAt)}</p>
                    </div>
                    {student.gender && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Gender</p>
                        <p className="text-sm font-medium">{student.gender}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Nationality</p>
                      <p className="text-sm font-medium">{student.nationality ?? "-"}</p>
                    </div>
                    {addressText && (
                      <div className="col-span-2">
                        <p className="text-xs text-muted-foreground mb-1">Address</p>
                        <p className="text-sm font-medium">{addressText}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <BookOpen className="h-4 w-4" /> Academic Information
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Course</p>
                      <p className="text-sm font-medium">{currentCourse?.title ?? latestAdmission?.courseName ?? "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Campus</p>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                        {student.campus?.name ?? latestAdmission?.campus?.name ?? "-"}
                      </div>
                    </div>
                    {latestAdmission && (
                      <>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Application No</p>
                          <p className="text-sm font-medium">{latestAdmission.applicationNo}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Admission Stage</p>
                          <StatusBadge status={latestAdmission.stage} domain="admission" />
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Batch</p>
                          <p className="text-sm font-medium">
                            {currentBatch?.name ?? latestAdmission.batchName ?? "-"}
                            {currentBatch && currentBatch.capacity != null ? ` · cap ${currentBatch.capacity}` : ""}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Counselor</p>
                          <p className="text-sm font-medium">{latestAdmission.counselor?.name ?? "-"}</p>
                        </div>
                      </>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Lead ref</p>
                      <p className="text-sm font-medium">{student.lead ? `${student.lead.name} (${student.lead.phone})` : "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mb-1">Medical fitness</p>
                      <p className="text-sm font-medium">{student.medicalFitness ? "Fit" : "Not verified"}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <GraduationCap className="h-4 w-4" /> LMS Enrollment
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {enrolledCount === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No LMS enrollments yet — enroll the admission to create one.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {(student.lmsEnrollments ?? []).map((e) => (
                        <div key={e.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/50 px-3 py-2 text-xs">
                          <div>
                            <p className="font-bold text-white">{e.course?.title ?? "-"}</p>
                            <p className="text-muted-foreground">Batch: {e.batch?.name ?? "—"} · joined {formatDate(e.enrolledAt)}</p>
                          </div>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                              e.status === "ACTIVE"
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                : "bg-slate-500/20 text-slate-400 border-slate-500/30"
                            }`}
                          >
                            {e.status.replace(/_/g, " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {(student.lmsBatchMemberships ?? []).length > 0 && (
                    <div className="mt-3">
                      <p className="text-[10px] font-bold text-muted-foreground mb-1">Batch memberships</p>
                      <div className="flex flex-wrap gap-1.5">
                        {(student.lmsBatchMemberships ?? []).map((m) => (
                          <span key={m.id} className="rounded-md border border-white/10 bg-secondary/40 px-2 py-1 text-[10px] font-semibold text-muted-foreground">
                            {m.batch?.name ?? "-"}{m.batch?.startDate ? ` · ${formatDate(m.batch.startDate)}` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4" /> Documents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(student.documents ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No documents uploaded.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {(student.documents ?? []).map((d) => (
                        <div key={d.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/50 px-3 py-1.5 text-xs">
                          <div className="min-w-0">
                            <p className="font-bold text-white truncate">{d.name}</p>
                            <p className="text-muted-foreground">
                              {d.documentType.replace(/_/g, " ")}{d.fileSizeBytes ? ` · ${fmtSize(d.fileSizeBytes)}` : ""}
                            </p>
                          </div>
                          <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${docStatusClass(d.status)}`}>
                            {d.status.replace(/_/g, " ")}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {canViewCertificates && (
                <Card data-testid="student-certificates">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Award className="h-4 w-4" /> Certificates
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {certificatesError ? (
                      <p role="alert" className="text-xs text-rose-400">Could not load certificates.</p>
                    ) : (certificates ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">No certificates issued.</p>
                    ) : (
                      <div className="space-y-1.5">
                        {(certificates ?? []).map((cert) => (
                          <div key={cert.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/50 px-3 py-1.5 text-xs">
                            <div className="min-w-0">
                              <p className="font-bold text-white truncate">{cert.title ?? cert.course?.title ?? "Certificate"}</p>
                              <p className="text-muted-foreground font-mono">
                                {cert.certificateNo} · {cert.status}
                                {cert.issuedAt ? ` · ${formatDate(cert.issuedAt)}` : ""}
                              </p>
                            </div>
                            <a
                              href={`/certificates/${cert.id}`}
                              target="_blank"
                              rel="noreferrer"
                              data-testid="certificate-view-link"
                              className="rounded border border-white/10 px-2 py-0.5 text-[11px] font-bold hover:bg-white/5"
                            >
                              View
                            </a>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Landmark className="h-4 w-4" /> Payments
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(student.payments ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground">No payments recorded.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {(student.payments ?? []).map((p) => {
                        const net = Number(p.amount ?? 0) - Number(p.refundedAmount ?? 0);
                        return (
                          <div key={p.id} className="flex items-center justify-between rounded-lg border border-white/5 bg-slate-900/50 px-3 py-1.5 text-xs">
                            <div>
                              <p className="font-bold text-white">
                                {money(net)}
                                <span className="font-semibold text-muted-foreground"> · {p.method ?? "-"}</span>
                              </p>
                              <p className="text-muted-foreground">
                                {p.feeType ?? "fee"} · {p.receiptNo ?? "no receipt"}
                                {p.admission?.applicationNo ? ` · ${p.admission.applicationNo}` : ""}
                              </p>
                            </div>
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold ${paymentStatusClass(p.status)}`}>
                              {p.status ?? "-"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-3 border-b border-white/5">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <Clock className="h-4 w-4 text-primary" /> Unified Candidate Journey Timeline
                    </CardTitle>
                    <span className="text-[10px] font-semibold text-muted-foreground">
                      {timelineItems.length} events logged
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="pt-4">
                  {timelineLoading ? (
                    <div className="space-y-3 py-2">
                      {[...Array(3)].map((_, i) => (
                        <Skeleton key={i} className="h-12 w-full" />
                      ))}
                    </div>
                  ) : timelineItems.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">
                      No timeline history recorded yet.
                    </p>
                  ) : (
                    <div className="space-y-2.5 max-h-96 overflow-y-auto pr-1">
                      {timelineItems.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-start gap-3 p-3 rounded-xl border border-white/5 bg-slate-900/40 text-xs"
                        >
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary border border-primary/20 mt-0.5">
                            {item.kind === "notification" ? (
                              <Send className="h-3.5 w-3.5" />
                            ) : item.activityType === "STATUS_CHANGE" ? (
                              <ShieldCheck className="h-3.5 w-3.5 text-teal-400" />
                            ) : item.activityType === "PAYMENT" ? (
                              <Landmark className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <FileText className="h-3.5 w-3.5" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2 mb-0.5">
                              <span className="font-bold text-white truncate">{item.title}</span>
                              <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
                                {formatDate(item.at)}
                              </span>
                            </div>
                            {item.detail && (
                              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">
                                {item.detail}
                              </p>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              {item.channel && (
                                <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-violet-500/10 text-violet-300 border border-violet-500/20">
                                  {item.channel}
                                </span>
                              )}
                              {item.actorName && (
                                <span className="text-[9px] text-muted-foreground">
                                  by {item.actorName}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>

            <div>
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold">Quick Info</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {[
                    { label: "Student ID", value: student.studentId },
                    { label: "Status", value: <StatusBadge status={student.status} domain="student" /> },
                    { label: "Enrolled", value: formatDate(student.enrolledAt) },
                    { label: "Admissions", value: String(student.admissions?.length ?? 0) },
                    { label: "LMS enrollments", value: String(enrolledCount) },
                    { label: "Guardian", value: student.guardianName ?? "-" },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <div className="mt-0.5 text-sm font-medium">{value}</div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between rounded-lg border border-white/10 px-2 py-1.5">
                    <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <ShieldCheck className="h-3.5 w-3.5" /> Medical fitness
                    </span>
                    <span className={`text-xs font-bold ${student.medicalFitness ? "text-emerald-400" : "text-amber-400"}`}>
                      {student.medicalFitness ? "Fit" : "Not verified"}
                    </span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </>
      )}

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent className="glass-panel border-white/10 bg-slate-900/95 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-rose-400" />
              Move Student to Recycle Bin?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to move student{" "}
              <span className="font-semibold text-white">
                {student.name} ({student.studentId})
              </span>{" "}
              to the Recycle Bin? The linked candidate lead will also be archived. You can restore this record within 30 days from the Recycle Bin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-xs font-bold hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              className="bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/20"
            >
              {deleteMutation.isPending ? "Moving..." : "Move to Recycle Bin"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}