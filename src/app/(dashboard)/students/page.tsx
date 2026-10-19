"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { Search, Eye, MoreHorizontal, AlertCircle, CheckCircle2, XCircle, Upload, UserPlus, GraduationCap, Phone, Trash2 } from "lucide-react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { roleCan } from "@/lib/utils/permissions";
import { StudentImportDialog } from "@/components/students/student-import-dialog";
import { DataTable } from "@/components/shared/data-table";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatDate, getInitials, cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { apiFetch } from "@/lib/api";
import Link from "next/link";

interface Student {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  studentCode: string;
  medicalFitness: boolean;
  avatarUrl?: string;
  createdAt: string;
  course?: { title: string };
  campus?: { name: string };
  admissions?: { feePaid?: string | number | null; feeBalance?: string | number | null }[];
}

const STUDENT_STATUSES = ["all", "DRAFT", "ACTIVE", "GRADUATED", "DROPPED", "SUSPENDED", "ON_HOLD"];

export default function StudentsPage() {
  const queryClient = useQueryClient();
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [importOpen, setImportOpen] = React.useState(false);
  const router = useRouter();
  const [admitOpen, setAdmitOpen] = React.useState(false);
  const [leadSearchTerm, setLeadSearchTerm] = React.useState("");
  const [selectedLead, setSelectedLead] = React.useState<{ id: string; name: string; phone: string; email?: string | null; courseInterest?: string | null; manualAmount?: number | null } | null>(null);
  const [admitCourse, setAdmitCourse] = React.useState("");
  const [admitFee, setAdmitFee] = React.useState("");
  const [submittingAdmit, setSubmittingAdmit] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<Student | null>(null);

  const { data: session } = useSession();
  const canImport = roleCan(session?.user?.role, "write", "students");
  const canAdmit = roleCan(session?.user?.role, "write", "admissions") || roleCan(session?.user?.role, "write", "students");
  const canDelete = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";

  const deleteMutation = useMutation({
    mutationFn: async (studentId: string) => {
      return apiFetch(`/students/${studentId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["students"] });
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["admissions"] });
      setDeleteTarget(null);
      refetch();
      toast({
        title: "Student moved to Recycle Bin",
        description: "Student record and associated lead moved to Recycle Bin.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: leadResults, isLoading: leadsSearching } = useQuery({
    queryKey: ["leads-search-admit", leadSearchTerm],
    queryFn: async () => {
      if (!leadSearchTerm.trim()) return [];
      const res = await apiFetch<{ id: string; name: string; phone: string; email?: string; courseInterest?: string; manualAmount?: number }[]>(
        `/leads?search=${encodeURIComponent(leadSearchTerm)}&limit=10`
      );
      return Array.isArray(res) ? res : [];
    },
    enabled: admitOpen && leadSearchTerm.trim().length >= 2,
  });

  const handleAdmitLead = async () => {
    if (!selectedLead) return;
    setSubmittingAdmit(true);
    try {
      const res = await apiFetch<{ admission: { id: string; applicationNo: string }; created: boolean }>(
        "/admissions/convert-lead",
        {
          method: "POST",
          body: JSON.stringify({
            leadId: selectedLead.id,
            courseName: admitCourse || selectedLead.courseInterest || undefined,
            feeAmount: admitFee ? Number(admitFee) : (selectedLead.manualAmount ? Number(selectedLead.manualAmount) : undefined),
            autoEnroll: true,
          }),
        }
      );
      toast({
        title: "Student Enrolled",
        description: `Admission ${res.admission.applicationNo} created and candidate enrolled.`,
      });
      setAdmitOpen(false);
      setSelectedLead(null);
      setLeadSearchTerm("");
      refetch();
      router.push(`/admissions?id=${res.admission.id}`);
    } catch (err) {
      toast({
        title: "Admission Failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSubmittingAdmit(false);
    }
  };

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["students", pagination, sorting, debouncedSearch, statusFilter],
    queryFn: async () => {
      const sortField = sorting[0]?.id ?? "createdAt";
      const sortDirection = sorting[0]?.desc ? "desc" : "asc";
      const mappedSortField = sortField === "name" ? "firstName" : sortField;

      const p = new URLSearchParams({
        page: String(pagination.pageIndex + 1),
        limit: String(pagination.pageSize),
        sortBy: mappedSortField,
        sortDir: sortDirection,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(statusFilter && statusFilter !== "all" ? { status: statusFilter } : {}),
      });
      // The API responds with { success, data: Student[], meta: {total,totalPages} }.
      // apiFetch() only unwraps `.data` (dropping `.meta`), so this fetches directly
      // to preserve real pagination totals rather than assuming a nested shape.
      const res = await fetch(`/api/v1/students?${p}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data: Student[]; meta?: { total: number; totalPages: number } };
      return {
        items: json.data,
        total: json.meta?.total ?? json.data.length,
        totalPages: json.meta?.totalPages ?? 1,
      };
    },
  });

  const columns: ColumnDef<Student>[] = [
    {
      accessorKey: "name",
      header: "Student",
      cell: ({ row }) => {
        const name = `${row.original.firstName} ${row.original.lastName}`;
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9 border border-primary/30 shadow-sm">
              {row.original.avatarUrl && <AvatarImage src={row.original.avatarUrl} />}
              <AvatarFallback className="text-xs bg-primary/20 text-primary font-bold">{getInitials(name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
                <Link href={`/students/${row.original.id}`} className="text-sm font-bold text-white hover:text-primary transition-colors truncate block text-left">
                  {name}
                </Link>
              <span className="text-[10px] font-mono font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">{row.original.studentCode}</span>
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "course",
      header: "Enrolled Course",
      cell: ({ row }) => <span className="text-xs font-semibold text-foreground">{row.original.course?.title ?? "-"}</span>,
    },
    {
      accessorKey: "campus",
      header: "Campus",
      cell: ({ row }) => <span className="text-xs font-semibold text-muted-foreground">{row.original.campus?.name ?? "-"}</span>,
    },
    {
      accessorKey: "feePaid",
      header: "Total Paid",
      cell: ({ row }) => {
        const paid = Number(row.original.admissions?.[0]?.feePaid ?? 0);
        return (
          <span className="text-xs font-bold text-emerald-400">
            ₹{paid.toLocaleString("en-IN")}
          </span>
        );
      },
    },
    {
      accessorKey: "feeBalance",
      header: "Remaining Balance",
      cell: ({ row }) => {
        const bal = Number(row.original.admissions?.[0]?.feeBalance ?? 0);
        return (
          <span className={bal > 0 ? "text-xs font-bold text-amber-400" : "text-xs font-bold text-emerald-400"}>
            ₹{bal.toLocaleString("en-IN")}
          </span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => (
        <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full border bg-blue-500/20 text-blue-400 border-blue-500/30">
          {row.original.status}
        </span>
      ),
    },
    {
      accessorKey: "medicalFitness",
      header: "Medical Fitness",
      cell: ({ row }) =>
        row.original.medicalFitness ? (
          <span className="text-xs font-bold text-emerald-400 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> Cleared</span>
        ) : (
          <span className="text-xs font-bold text-amber-400 flex items-center gap-1"><XCircle className="h-3.5 w-3.5" /> Pending</span>
        ),
    },
    {
      accessorKey: "createdAt",
      header: "Enrolled On",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDate(row.original.createdAt)}</span>,
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-secondary">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-panel border-white/10 w-48">
            <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5">
              <Link href={`/students/${row.original.id}`}>
                <Eye className="mr-2 h-4 w-4 text-primary" />
                View Details
              </Link>
            </DropdownMenuItem>
            {canDelete && (
              <>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem
                  onClick={() => setDeleteTarget(row.original)}
                  className="cursor-pointer text-rose-400 hover:bg-rose-500/10 focus:text-rose-400"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Move to Recycle Bin
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Student Database"
        description="Enrolled student records and status tracking."
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" className="border-white/10 text-xs font-semibold hover:bg-white/5">
              <Link href="/leads/trash">
                <Trash2 className="h-4 w-4 mr-1.5" /> Recycle Bin
              </Link>
            </Button>
            {canAdmit && (
              <Button
                onClick={() => setAdmitOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
              >
                <UserPlus className="h-4 w-4 mr-1.5" /> Admit Lead as Student
              </Button>
            )}
            {canImport && (
              <Button
                onClick={() => setImportOpen(true)}
                data-testid="student-import-open"
                className="bg-primary hover:bg-primary/90 text-white font-bold text-xs"
              >
                <Upload className="h-4 w-4 mr-1.5" /> Bulk Upload CSV
              </Button>
            )}
          </div>
        }
      />
      <StudentImportDialog open={importOpen} onOpenChange={setImportOpen} />

      {/* Admit Lead as Student Modal */}
      <Dialog open={admitOpen} onOpenChange={(o) => {
        if (!o) {
          setAdmitOpen(false);
          setSelectedLead(null);
          setLeadSearchTerm("");
        }
      }}>
        <DialogContent className="glass-panel border-white/10 bg-slate-900/95 max-w-lg text-white">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <GraduationCap className="h-5 w-5 text-emerald-400" />
              Admit Lead as Enrolled Student
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!selectedLead ? (
              <div className="space-y-3">
                <Label className="text-xs text-muted-foreground font-semibold">
                  Search Lead by Name, Phone, or Email
                </Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Type candidate name or phone..."
                    value={leadSearchTerm}
                    onChange={(e) => setLeadSearchTerm(e.target.value)}
                    className="pl-9 bg-secondary/40 border-white/10 text-xs font-semibold"
                    autoFocus
                  />
                </div>

                <div className="max-h-56 overflow-y-auto space-y-2 pt-1">
                  {leadsSearching && <p className="text-xs text-muted-foreground text-center py-4">Searching candidates...</p>}
                  {!leadsSearching && leadSearchTerm.trim().length >= 2 && (leadResults ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground text-center py-4">No matching leads found.</p>
                  )}
                  {(leadResults ?? []).map((lead) => (
                    <div
                      key={lead.id}
                      onClick={() => {
                        setSelectedLead(lead);
                        setAdmitCourse(lead.courseInterest || "");
                        setAdmitFee(lead.manualAmount ? String(lead.manualAmount) : "");
                      }}
                      className="p-3 rounded-xl border border-white/5 bg-white/5 hover:bg-emerald-500/10 hover:border-emerald-500/30 cursor-pointer transition-all flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-white truncate">{lead.name}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{lead.phone} {lead.email ? `· ${lead.email}` : ""}</p>
                        {lead.courseInterest && <p className="text-[10px] text-primary font-semibold mt-0.5">{lead.courseInterest}</p>}
                      </div>
                      <Button size="sm" variant="ghost" className="text-xs text-emerald-400 font-bold shrink-0">
                        Select
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-white">{selectedLead.name}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSelectedLead(null)}
                      className="h-6 text-[11px] text-muted-foreground hover:text-white"
                    >
                      Change
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{selectedLead.phone} {selectedLead.email ? `· ${selectedLead.email}` : ""}</p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-semibold">Course / Flight Program *</Label>
                  <Input
                    value={admitCourse}
                    onChange={(e) => setAdmitCourse(e.target.value)}
                    placeholder="e.g. Commercial Pilot License (CPL)"
                    className="bg-secondary/40 border-white/10 text-xs font-semibold"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground font-semibold">Agreed Course Fee (₹)</Label>
                  <Input
                    type="number"
                    value={admitFee}
                    onChange={(e) => setAdmitFee(e.target.value)}
                    placeholder="e.g. 4500000"
                    className="bg-secondary/40 border-white/10 text-xs font-semibold"
                  />
                </div>

                <p className="text-[11px] text-muted-foreground">
                  This action marks the lead as <span className="text-emerald-400 font-bold">WON</span>, provisions their official student record, and opens their Application Dossier.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAdmitOpen(false)} className="text-xs font-bold">
              Cancel
            </Button>
            {selectedLead && (
              <Button
                disabled={submittingAdmit}
                onClick={handleAdmitLead}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-lg shadow-emerald-600/20"
              >
                {submittingAdmit ? "Enrolling Student..." : "Confirm Admission & Enroll"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="glass-card rounded-2xl p-5 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3 flex-1 max-w-md">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search students by name, email, code..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-secondary/40 border-white/10 focus:border-primary text-sm font-medium"
            />
          </div>
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44 bg-secondary/40 border-white/10 text-xs font-semibold">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent className="glass-panel border-white/10 text-xs">
            {STUDENT_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl border border-rose-500/20 bg-rose-500/10 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-rose-400" />
          <div>
            <h3 className="text-base font-bold text-white">Failed to Load Students</h3>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{error?.message || "Internal server error"}</p>
          </div>
          <Button onClick={() => refetch()} variant="outline" className="border-white/10 text-xs font-bold hover:bg-white/5">
            Retry Loading
          </Button>
        </div>
      )}

      {!isError && (
        <div className="glass-card rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
          <DataTable
            columns={columns}
            data={data?.items ?? []}
            loading={isLoading}
            pageCount={data?.totalPages ?? 0}
            pagination={pagination}
            onPaginationChange={setPagination}
            sorting={sorting}
            onSortingChange={setSorting}
            emptyTitle="No students found"
            emptyDescription="Students will appear here once admissions are enrolled."
          />
        </div>
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="glass-panel border-white/10 bg-slate-900/95 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-base font-bold text-white flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-rose-400" />
              Move Student to Recycle Bin?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              Are you sure you want to move student{" "}
              <span className="font-semibold text-white">
                {deleteTarget ? `${deleteTarget.firstName} ${deleteTarget.lastName} (${deleteTarget.studentCode})` : ""}
              </span>{" "}
              to the Recycle Bin? The linked candidate lead will also be archived. You can restore this record within 30 days from the Recycle Bin.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-xs font-bold hover:bg-white/5">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
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
