"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { Plus, Search, Filter, MoreHorizontal, Eye, CheckSquare, UserCheck, Sparkles, SlidersHorizontal, ChevronDown, AlertCircle, Trash2, Upload, Download, Radio } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { LeadImportDialog } from "@/components/crm/lead-import-dialog";
import { apiFetch } from "@/lib/api";
import { bulkAssignLeads } from "@/lib/crm/deals";
import { formatDate } from "@/lib/utils";
import { isActiveStatus, INITIAL_LEAD_STATUSES, statusLabel } from "@/lib/leads/lead-status";
import { LEAD_SOURCE_OPTIONS, leadSourceLabel } from "@/lib/leads/lead-source";
import { roleCan } from "@/lib/utils/permissions";
import type { LeadStatus } from "@prisma/client";
import { toast } from "@/components/ui/use-toast";
import { motion } from "framer-motion";

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  source: string;
  priority: "HIGH" | "MEDIUM" | "LOW";
  score: number;
  courseInterest?: string;
  pincode?: string;
  googleId?: string;
  manualAmount?: number | string | null;
  assignedTo?: { name: string };
  counselor?: { id: string; name: string };
  nextFollowUp?: string | null;
  admissions?: { id: string }[];
  createdAt: string;
  lastActivityAt?: string;
}

const createLeadSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().min(10, "Phone must be at least 10 characters"),
  source: z.string().min(1, "Source is required"),
  status: z.string().min(1, "Initial status is required"),
  courseInterest: z.string().optional(),
  pincode: z.string().max(10).optional(),
  manualAmount: z.coerce.number().nonnegative().optional(),
  notes: z.string().optional(),
});

type CreateLeadForm = z.infer<typeof createLeadSchema>;

const LEAD_STATUSES = [
  "active", "all", "NEW", "CONNECTED", "CALL_BACK", "INTERESTED", "PROSPECT", "WON",
  "NOT_CONNECTED", "RINGING", "NOT_REACHABLE", "SWITCHED_OFF", "VOICEMAIL",
  "LOST", "INCOMING_BARD", "OUT_OF_SERVICE", "NOT_AWARE", "NOT_CONTACTABLE",
  "LOCATION_OUT_OF_SCOPE", "LANGUAGE_BARRIER", "PRICE_HIGH", "JOINED_OTHERS",
  "NOT_ELIGIBLE", "INVALID_NUMBER", "TEST_LEAD", "NOT_INTERESTED", "REASON_NOT_SHARED", "JOB_SEEKER",
];

export default function LeadsPage() {
  const { data: session } = useSession();
  const canAssign =
    session?.user?.role === "ADMIN" ||
    session?.user?.role === "SUPER_ADMIN" ||
    session?.user?.role === "MARKETING_MANAGER";
  const canExport = roleCan(session?.user?.role, "export", "leads");
  // Mirrors PERMISSION_MATRIX: only ADMIN / SUPER_ADMIN hold `delete` on leads.
  const canDelete = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";
  const [deleteTargets, setDeleteTargets] = React.useState<{ id: string; name: string }[]>([]);
  const queryClient = useQueryClient();
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("active");
  const [priorityFilter, setPriorityFilter] = React.useState("all");
  const [counsellorFilter, setCounsellorFilter] = React.useState("all");
  const [overdueOnly, setOverdueOnly] = React.useState(false);
  const [sourceFilter, setSourceFilter] = React.useState("all");
  const [dateDraft, setDateDraft] = React.useState({ from: "", to: "" });
  const [dateRange, setDateRange] = React.useState({ from: "", to: "" });
  const [dateError, setDateError] = React.useState<string | null>(null);
  const [exporting, setExporting] = React.useState(false);
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [createOpen, setCreateOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [selectedLeadIds, setSelectedLeadIds] = React.useState<string[]>([]);

  const searchParams = useSearchParams();
  const filterParam = searchParams.get("filter");
  const statusParam = searchParams.get("status");
  const counselorParam = searchParams.get("assignedTo") || searchParams.get("counselor");

  React.useEffect(() => {
    if (filterParam === "today") {
      const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      setDateRange({ from: today, to: today });
      setDateDraft({ from: today, to: today });
    } else if (filterParam === "week") {
      const from = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      );
      const to = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      setDateRange({ from, to });
      setDateDraft({ from, to });
    } else if (filterParam === "month") {
      const from = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      );
      const to = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
      setDateRange({ from, to });
      setDateDraft({ from, to });
    } else if (filterParam === "followup") {
      setOverdueOnly(true);
    }

    if (statusParam) {
      setStatusFilter(statusParam);
    }
    if (counselorParam) {
      setCounsellorFilter(counselorParam);
    }
  }, [filterParam, statusParam, counselorParam]);

  React.useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: counselorsList = [] } = useQuery({
    queryKey: ["counselors-list"],
    queryFn: () => apiFetch<{ id: string; name: string }[]>("/users?role=ADMISSIONS_COUNSELOR&limit=100"),
  });

  // Filters shared by the paginated list and the CSV export so both hit the same server query.
  const filterParams = React.useMemo(
    () =>
      new URLSearchParams({
        ...(sorting.length > 0 && sorting[0] ? { sortBy: sorting[0].id, sortDir: sorting[0].desc ? "desc" : "asc" } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(statusFilter === "active" ? { isActive: "true" } : {}),
        ...(statusFilter && statusFilter !== "all" && statusFilter !== "active" ? { status: statusFilter } : {}),
        ...(priorityFilter && priorityFilter !== "all" ? { priority: priorityFilter } : {}),
        ...(counsellorFilter && counsellorFilter !== "all" ? { assignedTo: counsellorFilter } : {}),
        ...(sourceFilter && sourceFilter !== "all" ? { source: sourceFilter } : {}),
        ...(overdueOnly ? { followUpOverdue: "true" } : {}),
        ...(dateRange.from ? { dateFrom: dateRange.from } : {}),
        ...(dateRange.to ? { dateTo: dateRange.to } : {}),
      }),
    [sorting, debouncedSearch, statusFilter, priorityFilter, counsellorFilter, sourceFilter, overdueOnly, dateRange],
  );

  React.useEffect(() => {
    setPagination((p) => (p.pageIndex === 0 ? p : { ...p, pageIndex: 0 }));
  }, [debouncedSearch, statusFilter, priorityFilter, counsellorFilter, sourceFilter, overdueOnly, dateRange]);

  const applyDateRange = () => {
    if (dateDraft.from && dateDraft.to && dateDraft.from > dateDraft.to) {
      setDateError("Start date must be on or before the end date");
      return;
    }
    setDateError(null);
    setDateRange({ ...dateDraft });
  };

  const clearDateRange = () => {
    setDateError(null);
    setDateDraft({ from: "", to: "" });
    setDateRange({ from: "", to: "" });
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/v1/leads/export?${filterParams.toString()}`, { credentials: "include" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
      }
      const rows = res.headers.get("X-Total-Count");
      const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "leads.csv";
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: `${rows ?? "All"} matching lead(s) exported to ${filename}.` });
    } catch (err) {
      toast({ title: "Export failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["leads", pagination.pageIndex, pagination.pageSize, filterParams.toString()],
    queryFn: async () => {
      const params = new URLSearchParams(filterParams);
      params.set("page", String(pagination.pageIndex + 1));
      params.set("limit", String(pagination.pageSize));
      // Save filters for Previous/Next navigation in the lead detail view
      if (typeof window !== "undefined") {
        sessionStorage.setItem("lastLeadFilters", params.toString());
      }
      
      // The API responds with { success, data: Lead[], meta: {total,page,limit,totalPages} }.
      // apiFetch() only unwraps `.data` (dropping `.meta`), so pagination totals are
      // fetched directly here rather than assuming a nested { items, total } shape.
      const res = await fetch(`/api/v1/leads?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json() as { data: Lead[]; meta?: { total: number; totalPages: number } };

      // Priority is derived server-side from the lead's real `score` field.
      const items = json.data.map((item) => ({
        ...item,
        priority: item.priority || (item.score >= 80 ? "HIGH" : item.score >= 50 ? "MEDIUM" : "LOW"),
        assignedTo: item.counselor
          ? { name: item.counselor.name }
          : item.assignedTo || { name: "Unassigned" },
      }));

      return {
        items,
        total: json.meta?.total ?? items.length,
        totalPages: json.meta?.totalPages ?? 1,
      };
    },
  });

  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<CreateLeadForm>({
    resolver: zodResolver(createLeadSchema),
    defaultValues: { source: "GOOGLE_ADS", status: "NEW" },
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateLeadForm) =>
      apiFetch<Lead>("/leads", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          email: body.email?.trim() ? body.email.trim() : undefined,
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Lead created", description: "New lead has been successfully added to CRM queue." });
      setCreateOpen(false);
      reset();
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (targets: { id: string; name: string }[]) => {
      const results = await Promise.allSettled(
        targets.map((t) => apiFetch(`/leads/${t.id}`, { method: "DELETE" })),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { deleted: targets.length - failed, failed };
    },
    onSuccess: ({ deleted, failed }) => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      setSelectedLeadIds([]);
      setDeleteTargets([]);
      if (failed > 0) {
        toast({ title: "Some leads not deleted", description: `${deleted} deleted, ${failed} failed.`, variant: "destructive" });
      } else {
        toast({ title: deleted === 1 ? "Lead moved to Recycle Bin" : `${deleted} leads moved to Recycle Bin` });
      }
    },
    onError: (err) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const handleBulkAssign = async (counselorId: string, counselorName: string) => {
    try {
      await bulkAssignLeads(selectedLeadIds, counselorId, `Bulk assigned ${selectedLeadIds.length} leads to ${counselorName}`);
      toast({ title: "Bulk Assignment Successful", description: `${selectedLeadIds.length} leads assigned to ${counselorName}.` });
      setSelectedLeadIds([]);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
    } catch (err: unknown) {
      toast({ title: "Assignment Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  };

  const columns: ColumnDef<Lead>[] = [
    {
      id: "select",
      header: ({ table }) => (
        <input
          type="checkbox"
          checked={table.getIsAllPageRowsSelected()}
          onChange={table.getToggleAllPageRowsSelectedHandler()}
          className="rounded border-border bg-card text-primary h-4 w-4 focus:ring-0 cursor-pointer"
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          checked={row.getIsSelected()}
          onChange={(e) => {
            row.toggleSelected(e.target.checked);
            if (e.target.checked) {
              setSelectedLeadIds(prev => [...prev, row.original.id]);
            } else {
              setSelectedLeadIds(prev => prev.filter(id => id !== row.original.id));
            }
          }}
          className="rounded border-border bg-card text-primary h-4 w-4 focus:ring-0 cursor-pointer"
        />
      ),
      size: 40,
    },
    {
      accessorKey: "name",
      header: "Lead Contact",
      cell: ({ row }) => (
        <div>
          <Link href={row.original.status === "WON" && row.original.admissions?.[0]?.id ? `/admissions?id=${row.original.admissions[0].id}` : `/leads/${row.original.id}`} className="font-semibold text-white hover:text-primary transition-colors flex items-center gap-2">
            {row.original.name}
            {row.original.score > 80 && (
              <span className="text-[9px] font-extrabold bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1 py-0.5 rounded flex items-center gap-0.5">
                <Sparkles className="h-2.5 w-2.5" /> HOT
              </span>
            )}
          </Link>
          <p className="text-xs text-muted-foreground">{row.original.email}</p>
        </div>
      ),
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <span className="text-xs font-mono text-muted-foreground">{row.original.phone}</span>,
    },
    {
      accessorKey: "priority",
      header: "Priority",
      enableSorting: false,
      cell: ({ row }) => (
        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${
          row.original.priority === "HIGH" ? "bg-rose-500/20 text-rose-400 border-rose-500/30" :
          row.original.priority === "MEDIUM" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" :
          "bg-blue-500/20 text-blue-400 border-blue-500/30"
        }`}>
          {row.original.priority}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Lead Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} domain="lead" />,
    },
    {
      accessorKey: "source",
      header: "Source Channel",
      cell: ({ row }) => (
        <span className="text-xs font-medium text-muted-foreground bg-secondary/60 px-2 py-1 rounded-md border border-white/5">
          {leadSourceLabel(row.original.source)}
        </span>
      ),
    },
    {
      accessorKey: "courseInterest",
      header: "Course Interest",
      cell: ({ row }) => (
        <span className="text-xs font-semibold text-foreground">{row.original.courseInterest ?? "-"}</span>
      ),
    },
    {
      accessorKey: "manualAmount",
      header: "Manual Amount",
      cell: ({ row }) => {
        const amount = row.original.manualAmount;
        const numeric = typeof amount === "string" ? parseFloat(amount) : amount;
        return numeric && numeric > 0 ? (
          <span className="text-xs font-bold text-foreground">₹{numeric.toLocaleString("en-IN")}</span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        );
      },
    },
    {
      accessorKey: "assignedTo",
      header: "Assigned Counselor",
      enableSorting: false,
      cell: ({ row }) => (
        <span className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
          <UserCheck className="h-3.5 w-3.5 text-emerald-400" />
          {row.original.assignedTo?.name ?? "Unassigned"}
        </span>
      ),
    },
    {
      accessorKey: "nextFollowUp",
      header: "Follow-up",
      cell: ({ row }) => {
        const due = row.original.nextFollowUp;
        if (!due) return <span className="text-xs text-muted-foreground">-</span>;
        const overdue = new Date(due) < new Date() && isActiveStatus(row.original.status as LeadStatus);
        return (
          <span className={`text-xs font-semibold ${overdue ? "text-rose-400" : "text-muted-foreground"}`}>
            {overdue ? "Overdue · " : ""}
            {formatDate(due)}
          </span>
        );
      },
    },
    {
      accessorKey: "createdAt",
      header: "Intake Date",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDate(row.original.createdAt)}</span>,
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0 text-muted-foreground hover:text-white">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="glass-panel border-white/10 w-44">
            <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5">
              <Link href={row.original.status === "WON" && row.original.admissions?.[0]?.id ? `/admissions?id=${row.original.admissions[0].id}` : `/leads/${row.original.id}`}>
                <Eye className="mr-2 h-4 w-4 text-primary" />
                {row.original.status === "WON" && row.original.admissions?.[0]?.id ? "View Admission" : "View Full Profile"}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="cursor-pointer hover:bg-white/5">
              <Link href={`/leads/${row.original.id}?tab=tasks`}>
                <CheckSquare className="mr-2 h-4 w-4 text-emerald-400" />
                Schedule Task
              </Link>
            </DropdownMenuItem>
            {canDelete && (
              <>
                <DropdownMenuSeparator className="bg-white/10" />
                <DropdownMenuItem
                  onClick={() => setDeleteTargets([{ id: row.original.id, name: row.original.name }])}
                  className="cursor-pointer text-rose-400 hover:bg-rose-500/10 focus:text-rose-400"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Lead
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
        title="All Leads"
        description="Comprehensive omnichannel lead intake, routing, and priority queue management."
        action={
          <div className="flex items-center gap-2">
            {canExport && (
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
                className="border-white/10 text-sm font-semibold"
                title="Download every lead matching the current filters as CSV"
              >
                <Download className="h-4 w-4 mr-2" />
                {exporting ? "Exporting..." : "Export CSV"}
              </Button>
            )}
            {canDelete && (
              <Button asChild variant="outline" className="border-white/10 text-sm font-semibold">
                <Link href="/leads/trash">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Recycle Bin
                </Link>
              </Button>
            )}
            {canAssign && (
              <Button variant="outline" onClick={() => setImportOpen(true)} className="border-white/10 text-sm font-semibold">
                <Upload className="h-4 w-4 mr-2" />
                Import Leads
              </Button>
            )}
            <Button onClick={() => setCreateOpen(true)} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all hover:scale-105">
              <Plus className="h-4 w-4 mr-2" />
              Add New Lead
            </Button>
          </div>
        }
      />

      {/* Advanced Filters & Bulk Actions */}
      <div className="glass-card rounded-2xl p-5 border border-white/10 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 max-w-lg">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search leads by name, email, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-secondary/40 border-white/10 focus:border-primary text-sm font-medium"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 bg-secondary/40 border-white/10 text-xs font-semibold">
                <Filter className="mr-2 h-3.5 w-3.5 text-primary" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent className="glass-panel border-white/10 text-xs">
                {LEAD_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s === "all" ? "All Statuses" : s === "active" ? "Active Leads" : s.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-36 bg-secondary/40 border-white/10 text-xs font-semibold">
                <SlidersHorizontal className="mr-2 h-3.5 w-3.5 text-amber-400" />
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent className="glass-panel border-white/10 text-xs">
                <SelectItem value="all">All Priorities</SelectItem>
                <SelectItem value="HIGH">High Priority</SelectItem>
                <SelectItem value="MEDIUM">Medium Priority</SelectItem>
                <SelectItem value="LOW">Low Priority</SelectItem>
              </SelectContent>
            </Select>

            <Select value={counsellorFilter} onValueChange={setCounsellorFilter}>
              <SelectTrigger className="w-40 bg-secondary/40 border-white/10 text-xs font-semibold">
                <UserCheck className="mr-2 h-3.5 w-3.5 text-emerald-400" />
                <SelectValue placeholder="Counselor" />
              </SelectTrigger>
              <SelectContent className="glass-panel border-white/10 text-xs">
                <SelectItem value="all">All Counselors</SelectItem>
                {counselorsList.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger aria-label="Source filter" className="w-40 bg-secondary/40 border-white/10 text-xs font-semibold">
                <Radio className="mr-2 h-3.5 w-3.5 text-sky-400" />
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent className="glass-panel border-white/10 text-xs">
                <SelectItem value="all">All Sources</SelectItem>
                {LEAD_SOURCE_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              type="button"
              size="sm"
              variant={overdueOnly ? "default" : "outline"}
              className={`text-xs font-bold h-9 ${overdueOnly ? "bg-rose-600 hover:bg-rose-500" : "border-white/10"}`}
              onClick={() => setOverdueOnly((v) => !v)}
            >
              <AlertCircle className="h-3.5 w-3.5 mr-1.5" />
              Overdue follow-ups
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3" aria-label="Created date filter">
          <div className="space-y-1">
            <Label htmlFor="lead-date-from" className="text-[11px] font-bold text-muted-foreground">Created from (IST)</Label>
            <Input
              id="lead-date-from"
              type="date"
              value={dateDraft.from}
              max={dateDraft.to || undefined}
              onChange={(e) => setDateDraft((d) => ({ ...d, from: e.target.value }))}
              className="h-9 w-40 bg-secondary/40 border-white/10 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="lead-date-to" className="text-[11px] font-bold text-muted-foreground">Created to (IST)</Label>
            <Input
              id="lead-date-to"
              type="date"
              value={dateDraft.to}
              min={dateDraft.from || undefined}
              onChange={(e) => setDateDraft((d) => ({ ...d, to: e.target.value }))}
              className="h-9 w-40 bg-secondary/40 border-white/10 text-xs"
            />
          </div>
          <Button type="button" size="sm" className="h-9 text-xs font-bold" onClick={applyDateRange}>
            Apply dates
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 text-xs font-bold border-white/10"
            onClick={clearDateRange}
            disabled={!dateDraft.from && !dateDraft.to && !dateRange.from && !dateRange.to}
          >
            Clear dates
          </Button>
          {(dateRange.from || dateRange.to) && !dateError && (
            <span className="text-[11px] text-muted-foreground" data-testid="active-date-range">
              Showing leads created {dateRange.from ? `from ${dateRange.from}` : ""}{dateRange.from && dateRange.to ? " " : ""}
              {dateRange.to ? `to ${dateRange.to}` : ""} (IST)
            </span>
          )}
          {dateError && <span role="alert" className="text-[11px] font-semibold text-destructive">{dateError}</span>}
        </div>

        {/* Bulk Actions Toolbar */}
        {selectedLeadIds.length > 0 && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-between bg-primary/20 border border-primary/30 p-3 rounded-xl">
            <span className="text-xs font-bold text-white flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-primary" />
              {selectedLeadIds.length} lead(s) selected
            </span>
            <div className="flex items-center gap-2">
              {canAssign && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="text-xs font-bold border-white/10 py-1 px-3 h-8">
                    Assign Counselor <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="glass-panel border-white/10 text-xs">
                  <DropdownMenuLabel className="text-xs font-bold text-muted-foreground">Select Counselor</DropdownMenuLabel>
                  <DropdownMenuSeparator className="bg-white/10" />
                  {counselorsList.map((c) => (
                    <DropdownMenuItem key={c.id} onClick={() => handleBulkAssign(c.id, c.name)} className="cursor-pointer text-xs hover:bg-white/5">
                      {c.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              )}
              {canDelete && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-xs font-bold border-rose-500/30 text-rose-400 hover:bg-rose-500/10 py-1 px-3 h-8"
                  onClick={() => {
                    const names = new Map((data?.items ?? []).map((l) => [l.id, l.name]));
                    setDeleteTargets(selectedLeadIds.map((id) => ({ id, name: names.get(id) ?? "Lead" })));
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </div>

      {/* Main CRM Data Table */}
      {isError && (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl border border-rose-500/20 bg-rose-500/10 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-rose-400" />
          <div>
            <h3 className="text-base font-bold text-white">Failed to Load Leads</h3>
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
            emptyTitle="No leads found in CRM queue"
            emptyDescription="Try clearing your filters or add a new lead to get started."
          />
        </div>
      )}

      {/* Create Lead Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Plus className="h-5 w-5 text-primary" />
              Add New Lead to CRM
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="name" className="text-xs font-bold text-muted-foreground">Full Name *</Label>
                <Input id="name" placeholder="Captain Arjun Kapoor" className="bg-secondary/40 border-white/10 text-sm font-semibold" {...register("name")} />
                {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-bold text-muted-foreground">Email Address (Optional)</Label>
                <Input id="email" type="email" placeholder="arjun.k@aviation.club" className="bg-secondary/40 border-white/10 text-sm" {...register("email")} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs font-bold text-muted-foreground">Phone Number *</Label>
                <Input id="phone" placeholder="+91 98123 45001" className="bg-secondary/40 border-white/10 text-sm font-mono" {...register("phone")} />
                {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source" className="text-xs font-bold text-muted-foreground">Source Channel *</Label>
                <select
                  id="source"
                  className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/40 px-3 py-1 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  {...register("source")}
                >
                  {LEAD_SOURCE_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value} className="bg-slate-900">{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="status" className="text-xs font-bold text-muted-foreground">Initial Status *</Label>
                <select
                  id="status"
                  className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/40 px-3 py-1 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
                  {...register("status")}
                >
                  {INITIAL_LEAD_STATUSES.map((s) => (
                    <option key={s} value={s} className="bg-slate-900">{statusLabel(s)}</option>
                  ))}
                </select>
                {errors.status && <p className="text-xs text-destructive">{errors.status.message}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="courseInterest" className="text-xs font-bold text-muted-foreground">Course Interest</Label>
                <Input id="courseInterest" placeholder="e.g. DGCA CPL Ground School" className="bg-secondary/40 border-white/10 text-sm font-semibold" {...register("courseInterest")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pincode" className="text-xs font-bold text-muted-foreground">Location Pincode</Label>
                <Input id="pincode" placeholder="e.g. 110075" maxLength={10} className="bg-secondary/40 border-white/10 text-sm font-mono" {...register("pincode")} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="manualAmount" className="text-xs font-bold text-muted-foreground">Manual Amount (₹)</Label>
                <Input id="manualAmount" type="number" min={0} step="0.01" placeholder="Custom financial entry" className="bg-secondary/40 border-white/10 text-sm font-mono" {...register("manualAmount")} />
              </div>
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="notes" className="text-xs font-bold text-muted-foreground">Internal Notes & Context</Label>
                <Textarea id="notes" placeholder="Candidate requested callback regarding medical eligibility..." rows={3} className="bg-secondary/40 border-white/10 text-sm" {...register("notes")} />
              </div>
            </div>
            <DialogFooter className="pt-4 border-t border-white/10">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} className="border-white/10 hover:bg-white/5 text-xs font-bold">Cancel</Button>
              <Button type="submit" disabled={isSubmitting || createMutation.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
                {createMutation.isPending ? "Routing Lead..." : "Save & Route Lead"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <LeadImportDialog open={importOpen} onOpenChange={setImportOpen} />

      <AlertDialog open={deleteTargets.length > 0} onOpenChange={(o) => !o && !deleteMutation.isPending && setDeleteTargets([])}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTargets.length === 1 ? "Delete this lead?" : `Delete ${deleteTargets.length} leads?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTargets.length === 1
                ? `${deleteTargets[0]?.name} will be moved to the Recycle Bin.`
                : "The selected leads will be moved to the Recycle Bin."}{" "}
              You can restore them from there within 30 days, after which they are permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                deleteMutation.mutate(deleteTargets);
              }}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
