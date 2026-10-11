"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Award, Plus, ExternalLink, Ban, Trash2 } from "lucide-react";
import { toast } from "@/components/ui/use-toast";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface CertRow {
  id: string;
  certificateNo: string;
  verificationCode?: string | null;
  title: string;
  status: "DRAFT" | "ISSUED" | "REVOKED";
  issuedAt?: string | null;
  student: { firstName: string; lastName: string; studentCode: string };
  course: { title: string; slug: string };
}

interface Student { id: string; firstName: string; lastName: string; studentCode: string; email: string }
interface LmsCourse { id: string; title: string; slug: string }

export default function LmsCertificatesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [studentSearch, setStudentSearch] = React.useState("");
  const [selectedStudentId, setSelectedStudentId] = React.useState("");
  const [selectedCourseId, setSelectedCourseId] = React.useState("");
  const [certTitle, setCertTitle] = React.useState("");
  const [verificationCode, setVerificationCode] = React.useState("");

  const { data: certs, isLoading } = useQuery({
    queryKey: ["lms-certs"],
    queryFn: () => apiFetch<CertRow[]>("/lms/certificates"),
  });

  const { data: students } = useQuery({
    queryKey: ["students-list"],
    queryFn: () => apiFetch<Student[]>("/students?limit=200"),
  });

  const { data: courses } = useQuery({
    queryKey: ["lms-courses"],
    queryFn: () => apiFetch<LmsCourse[]>("/lms/courses"),
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      apiFetch("/lms/certificates", {
        method: "POST",
        body: JSON.stringify({
          studentId: selectedStudentId,
          courseId: selectedCourseId,
          title: certTitle,
          verificationCode: verificationCode || undefined,
        }),
      }),
    onSuccess: () => {
      toast({ title: "Certificate issued" });
      setOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["lms-certs"] });
    },
    onError: (err: Error) => toast({ title: "Issue failed", description: err.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/certificates/${id}/revoke`, { method: "POST" }),
    onSuccess: () => {
      toast({ title: "Certificate revoked", description: "The certificate is no longer verifiable." });
      void queryClient.invalidateQueries({ queryKey: ["lms-certs"] });
    },
    onError: (err: Error) => toast({ title: "Revoke failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/lms/certificates/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Certificate deleted", description: "The certificate record was removed." });
      void queryClient.invalidateQueries({ queryKey: ["lms-certs"] });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  function handleRevoke(c: CertRow) {
    if (window.confirm(`Revoke certificate ${c.certificateNo} for ${c.student.firstName} ${c.student.lastName}?\nIt will no longer be verifiable.`)) {
      revokeMutation.mutate(c.id);
    }
  }

  function handleDelete(c: CertRow) {
    if (window.confirm(`Delete certificate ${c.certificateNo} for ${c.student.firstName} ${c.student.lastName}?\nThis permanently removes the record.`)) {
      deleteMutation.mutate(c.id);
    }
  }

  function openDialog() {
    setVerificationCode("");
    setSelectedStudentId("");
    setSelectedCourseId("");
    setCertTitle("");
    setStudentSearch("");
    setOpen(true);
  }

  const filteredStudents = (students ?? []).filter((s) => {
    const q = studentSearch.toLowerCase();
    return !q || s.firstName.toLowerCase().includes(q) || s.lastName.toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) || s.studentCode.toLowerCase().includes(q);
  });

  const STATUS_STYLE: Record<string, string> = {
    ISSUED: "bg-emerald-500/15 text-emerald-400",
    DRAFT: "bg-amber-500/15 text-amber-400",
    REVOKED: "bg-red-500/15 text-red-400",
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="LMS Certificates"
        description="Issue and manage course completion certificates."
        action={
          <Button onClick={openDialog}>
            <Plus className="mr-2 h-4 w-4" />
            Issue certificate
          </Button>
        }
      />

      {isLoading && (
        <div className="space-y-2">
          {[1,2,3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-card/40" />)}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-card/60 text-xs uppercase tracking-wide text-muted-foreground border-b border-border">
            <tr>
              <th className="px-4 py-3">Student</th>
              <th className="px-4 py-3">Course</th>
              <th className="px-4 py-3">Certificate No</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Issued</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(certs ?? []).map((c) => (
              <tr key={c.id} className="border-t border-border hover:bg-white/[0.02]">
                <td className="px-4 py-3">
                  <p className="font-medium">{c.student.firstName} {c.student.lastName}</p>
                  <p className="text-xs text-muted-foreground">{c.student.studentCode}</p>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{c.course.title}</td>
                <td className="px-4 py-3 font-mono text-xs">{c.certificateNo}</td>
                <td className="px-4 py-3">
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase", STATUS_STYLE[c.status] ?? "")}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground">
                  {c.issuedAt ? new Date(c.issuedAt).toLocaleDateString("en-IN") : "-"}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    <a
                      href={`/certificates/${c.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-white/5"
                    >
                      <ExternalLink className="h-3 w-3" /> View
                    </a>
                    <a
                      href={`/verify/${encodeURIComponent(c.verificationCode ?? c.certificateNo)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-white/5"
                    >
                      Verify
                    </a>
                    {c.status === "ISSUED" && (
                      <button
                        type="button"
                        onClick={() => handleRevoke(c)}
                        disabled={revokeMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-md border border-red-500/30 px-2 py-1 text-[11px] text-red-400 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        <Ban className="h-3 w-3" /> Revoke
                      </button>
                    )}
                    {c.status !== "ISSUED" && (
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        disabled={deleteMutation.isPending}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-white/5 disabled:opacity-50"
                      >
                        <Trash2 className="h-3 w-3" /> Delete
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!isLoading && (certs?.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center">
                  <Award className="mx-auto h-8 w-8 text-muted-foreground/30" />
                  <p className="mt-2 text-sm text-muted-foreground">No certificates issued yet.</p>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue certificate</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Student picker */}
            <div>
              <label className="text-xs text-muted-foreground">Student *</label>
              <Input
                className="mt-1"
                placeholder="Search student…"
                value={studentSearch}
                onChange={(e) => { setStudentSearch(e.target.value); setSelectedStudentId(""); }}
              />
              {studentSearch && !selectedStudentId && (
                <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-secondary/30">
                  {filteredStudents.slice(0, 8).map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => { setSelectedStudentId(s.id); setStudentSearch(`${s.firstName} ${s.lastName} (${s.studentCode})`); }}
                      className="flex w-full flex-col px-3 py-2 text-left text-sm hover:bg-white/10"
                    >
                      <span className="font-medium">{s.firstName} {s.lastName}</span>
                      <span className="text-xs text-muted-foreground">{s.email} · {s.studentCode}</span>
                    </button>
                  ))}
                  {filteredStudents.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">No students found.</p>}
                </div>
              )}
            </div>

            {/* Course picker */}
            <div>
              <label className="text-xs text-muted-foreground">Course *</label>
              <select
                className="mt-1 h-9 w-full rounded-lg border border-border bg-secondary/60 px-3 text-sm"
                value={selectedCourseId}
                onChange={(e) => {
                  setSelectedCourseId(e.target.value);
                  const course = (courses ?? []).find((c) => c.id === e.target.value);
                  if (course && !certTitle) setCertTitle(`${course.title} - Certificate of Completion`);
                }}
              >
                <option value="">Select course…</option>
                {(courses ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Certificate title *</label>
              <Input className="mt-1" placeholder="e.g. Navigation Fundamentals - Certificate of Completion" value={certTitle} onChange={(e) => setCertTitle(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-muted-foreground">Certificate number</label>
                <div className="mt-1 h-9 rounded-lg border border-dashed border-border bg-secondary/30 px-3 text-sm font-mono text-muted-foreground flex items-center">
                  Auto-generated on server
                </div>
                <p className="text-[11px] text-muted-foreground pt-1">Issued server-side to guarantee uniqueness. Collisions are retried automatically.</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Verification code</label>
                <Input className="mt-1" placeholder="Same as cert no. if blank" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!selectedStudentId || !selectedCourseId || !certTitle || issueMutation.isPending}
              onClick={() => issueMutation.mutate()}
            >
              {issueMutation.isPending ? "Issuing…" : "Issue certificate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
