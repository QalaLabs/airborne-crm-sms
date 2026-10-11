"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { Search, MoreHorizontal, Plus, Globe, Archive, Trash2, Pencil, AlertCircle, Eye, Lock, Briefcase, Upload, CloudDownload } from "lucide-react";
import { JobImportDialog } from "@/components/jobs/job-import-dialog";
import { JobSourcesDialog } from "@/components/jobs/job-sources-dialog";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MediaPicker } from "@/components/shared/media-picker";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";

interface Job {
  id: string;
  title: string;
  slug: string;
  status: string;
  jobType?: string;
  location?: string;
  isRemote?: boolean;
  description?: string;
  requirements?: string;
  salaryMin?: number;
  salaryMax?: number;
  currency?: string;
  experienceYears?: number;
  tags?: string[];
  closesAt?: string;
  seoTitle?: string;
  seoDesc?: string;
  metadata?: Record<string, unknown>;
  hiringPartner?: { name: string };
  applicationCount: number;
  publishedAt?: string | null;
  createdAt: string;
}

interface JobsResponse {
  data: Job[];
  total: number;
}

const JOB_STATUSES = ["all", "DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"];
const JOB_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["CLOSED", "DRAFT", "ARCHIVED"],
  CLOSED: ["PUBLISHED", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

const TRANSITION_META: Record<string, { label: string; icon: typeof Globe }> = {
  PUBLISHED: { label: "Publish", icon: Globe },
  DRAFT: { label: "Unpublish (to Draft)", icon: Globe },
  CLOSED: { label: "Close Applications", icon: Lock },
  ARCHIVED: { label: "Archive", icon: Archive },
};

export default function JobsPage() {
  const queryClient = useQueryClient();
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [editor, setEditor] = React.useState<{ open: boolean; item: Job | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = React.useState<Job | null>(null);
  const [imageId, setImageId] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);
  const [sourcesOpen, setSourcesOpen] = React.useState(false);

  const openEditor = (item: Job | null) => {
    const current = item?.metadata?.imageId;
    setImageId(typeof current === "string" ? current : null);
    setEditor({ open: true, item });
  };

  const router = useRouter();
  const searchParams = useSearchParams();
  const wantsNew = searchParams.get("new") === "1";
  React.useEffect(() => {
    if (!wantsNew) return;
    openEditor(null);
    router.replace("/jobs", { scroll: false });
  }, [wantsNew, router]);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["jobs", pagination, sorting, debouncedSearch, statusFilter],
    queryFn: () => {
      const sortField = sorting[0]?.id ?? "createdAt";
      const sortDirection = sorting[0]?.desc ? "desc" : "asc";

      const p = new URLSearchParams({
        page: String(pagination.pageIndex + 1),
        limit: String(pagination.pageSize),
        sortBy: sortField,
        sortDir: sortDirection,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
        ...(statusFilter && statusFilter !== "all" ? { status: statusFilter } : {}),
      });
      return apiFetch<JobsResponse>(`/jobs?${p}`);
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["jobs"] });

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<Job> }) =>
      id
        ? apiFetch<Job>(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch<Job>("/jobs", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_, variables) => {
      invalidate();
      toast({ title: variables.id ? "Job updated" : "Job created", description: "Your changes have been saved." });
      setEditor({ open: false, item: null });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/jobs/${id}/publish`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Status updated", description: "Job status transitioned successfully." });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/jobs/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Job archived", description: "The job listing was archived and removed from public listings." });
      setDeleteTarget(null);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editor.open) return;
    const formData = new FormData(e.currentTarget);
    const item = editor.item;
    const closesAtRaw = (formData.get("closesAt") as string) || undefined;
    const tagsRaw = (formData.get("tags") as string) ?? "";
    // PATCH replaces metadata wholesale, so keep keys this form doesn't edit (applyUrl, airline, ...).
    const metadata: Record<string, unknown> = { ...(item?.metadata ?? {}) };
    if (imageId) metadata.imageId = imageId;
    else delete metadata.imageId;
    const body: Partial<Job> = {
      title: formData.get("title") as string,
      slug: ((formData.get("slug") as string) || undefined),
      jobType: formData.get("jobType") as Job["jobType"],
      location: (formData.get("location") as string) || undefined,
      isRemote: formData.get("isRemote") === "true",
      description: (formData.get("description") as string) || undefined,
      requirements: (formData.get("requirements") as string) || undefined,
      salaryMin: formData.get("salaryMin") ? Number(formData.get("salaryMin")) : undefined,
      salaryMax: formData.get("salaryMax") ? Number(formData.get("salaryMax")) : undefined,
      currency: (formData.get("currency") as string) || undefined,
      experienceYears: formData.get("experienceYears") ? Number(formData.get("experienceYears")) : undefined,
      closesAt: closesAtRaw ? new Date(closesAtRaw).toISOString() : undefined,
      tags: tagsRaw.split(",").map((t) => t.trim()).filter(Boolean),
      seoTitle: (formData.get("seoTitle") as string) || undefined,
      seoDesc: (formData.get("seoDesc") as string) || undefined,
      metadata,
    };
    saveMutation.mutate({ id: item?.id, body });
  };

  const editorFormId = "job-editor-form";

  const columns: ColumnDef<Job>[] = [
    {
      accessorKey: "title",
      header: "Job Title",
      cell: ({ row }) => (
        <div>
          <button onClick={() => openEditor(row.original)} className="text-sm font-medium text-foreground hover:text-primary text-left transition-colors">
            {row.original.title}
          </button>
          <p className="text-xs text-muted-foreground font-mono">/{row.original.slug}</p>
        </div>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} domain="job" />,
    },
    {
      accessorKey: "jobType",
      header: "Type",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.jobType?.replace(/_/g, " ") ?? "-"}</span>
      ),
    },
    {
      accessorKey: "location",
      header: "Location",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">
          {row.original.isRemote ? "Remote" : (row.original.location ?? "-")}
        </span>
      ),
    },
    {
      accessorKey: "applicationCount",
      header: "Applications",
      cell: ({ row }) => (
        <Badge variant="secondary" className="text-xs">
          {row.original.applicationCount ?? 0}
        </Badge>
      ),
    },
    {
      accessorKey: "closesAt",
      header: "Expires",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.original.closesAt)}</span>
      ),
    },
    {
      id: "actions",
      size: 50,
      cell: ({ row }) => {
        const r = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/jobs/${r.id}`}>
                  <Eye className="mr-2 h-4 w-4" /> View Details
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openEditor(r)} className="cursor-pointer">
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </DropdownMenuItem>
              {(JOB_TRANSITIONS[r.status] ?? []).map((next) => {
                const meta = TRANSITION_META[next];
                if (!meta) return null;
                const Icon = meta.icon;
                return (
                  <DropdownMenuItem key={next} onClick={() => publishMutation.mutate({ id: r.id, status: next })} className="cursor-pointer">
                    <Icon className="mr-2 h-4 w-4" /> {meta.label}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuItem onClick={() => setDeleteTarget(r)} className="cursor-pointer text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Archive
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Jobs"
        description={`${data?.total ?? 0} total job listings`}
        action={
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setSourcesOpen(true)} className="border-white/10">
              <CloudDownload className="h-4 w-4 mr-2" />
              External Sources
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)} className="border-white/10">
              <Upload className="h-4 w-4 mr-2" />
              Bulk Upload CSV
            </Button>
            <Button onClick={() => openEditor(null)} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20">
              <Plus className="h-4 w-4 mr-2" />
              Create Job
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search jobs..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {JOB_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl border border-rose-500/20 bg-rose-500/10 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-rose-400" />
          <div>
            <h3 className="text-base font-bold text-white">Failed to Load Jobs</h3>
            <p className="text-xs text-muted-foreground mt-1 font-mono">{error?.message || "Internal server error"}</p>
          </div>
          <Button onClick={() => refetch()} variant="outline" className="border-white/10 text-xs font-bold hover:bg-white/5">
            Retry Loading
          </Button>
        </div>
      )}

      {!isError && (
        <DataTable
          columns={columns}
          data={data?.data ?? []}
          loading={isLoading}
          pageCount={data?.total ? Math.ceil(data.total / pagination.pageSize) : 0}
          pagination={pagination}
          onPaginationChange={setPagination}
          sorting={sorting}
          onSortingChange={setSorting}
          emptyTitle="No jobs found"
          emptyDescription="Post your first job to get started."
        />
      )}

      {/* Create / Edit dialog */}
      <Dialog open={editor.open} onOpenChange={(o) => !o && setEditor({ open: false, item: null })}>
        <DialogContent className="max-w-2xl glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">
              {editor.item ? "Edit Job" : "Create Job"}
            </DialogTitle>
          </DialogHeader>
          {editor.open && (
            <form id={editorFormId} onSubmit={handleSave} className="space-y-4 pt-2 max-h-[65vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Job Title *</Label>
                  <Input name="title" required defaultValue={editor.item?.title ?? ""} placeholder="e.g. Flight Instructor (CPL)" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label>URL Slug (lowercase, hyphens)</Label>
                  <Input name="slug" defaultValue={editor.item?.slug ?? ""} placeholder="e.g. flight-instructor-cpl" className="bg-secondary/40 border-white/10 text-xs text-white font-mono" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Job Type *</Label>
                  <select name="jobType" required defaultValue={editor.item?.jobType ?? "full_time"} className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none">
                    {["full_time", "part_time", "contract", "internship"].map((t) => (
                      <option key={t} value={t} className="bg-slate-900">{t.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Location</Label>
                  <Input name="location" defaultValue={editor.item?.location ?? ""} placeholder="e.g. Nagpur, Maharashtra" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Work Mode</Label>
                  <select name="isRemote" defaultValue={editor.item?.isRemote ? "true" : "false"} className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none">
                    <option value="false" className="bg-slate-900">On-site / In-office</option>
                    <option value="true" className="bg-slate-900">Remote</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label>Experience (years)</Label>
                  <Input name="experienceYears" type="number" min="0" defaultValue={editor.item?.experienceYears?.toString() ?? ""} placeholder="e.g. 2" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Job Image (shown on the public job portal)</Label>
                <MediaPicker value={imageId} onChange={setImageId} label="Image" />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea name="description" defaultValue={editor.item?.description ?? ""} rows={4} placeholder="Role summary, responsibilities..." className="bg-secondary/40 border-white/10 text-xs text-white leading-relaxed" />
              </div>
              <div className="space-y-1.5">
                <Label>Requirements</Label>
                <Textarea name="requirements" defaultValue={editor.item?.requirements ?? ""} rows={4} placeholder="Qualifications, licenses, skills..." className="bg-secondary/40 border-white/10 text-xs text-white leading-relaxed" />
              </div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Salary Min</Label>
                  <Input name="salaryMin" type="number" min="0" defaultValue={editor.item?.salaryMin?.toString() ?? ""} placeholder="e.g. 25000" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label>Salary Max</Label>
                  <Input name="salaryMax" type="number" min="0" defaultValue={editor.item?.salaryMax?.toString() ?? ""} placeholder="e.g. 60000" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label>Currency</Label>
                  <Input name="currency" maxLength={3} defaultValue={editor.item?.currency ?? "INR"} className="bg-secondary/40 border-white/10 text-xs text-white font-mono uppercase" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Applications Close</Label>
                  <Input name="closesAt" type="datetime-local" defaultValue={editor.item?.closesAt?.slice(0, 16) ?? ""} className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label>Tags (comma separated)</Label>
                  <Input name="tags" defaultValue={editor.item?.tags?.join(", ") ?? ""} placeholder="pilot, instructor, dgca" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>SEO Meta Title</Label>
                <Input name="seoTitle" defaultValue={editor.item?.seoTitle ?? ""} className="bg-secondary/40 border-white/10 text-xs text-white" />
              </div>
              <div className="space-y-1.5">
                <Label>SEO Meta Description</Label>
                <Textarea name="seoDesc" defaultValue={editor.item?.seoDesc ?? ""} rows={2} className="bg-secondary/40 border-white/10 text-xs text-white" />
              </div>
            </form>
          )}
          <DialogFooter className="pt-4 border-t border-white/10">
            <Button type="button" variant="outline" onClick={() => setEditor({ open: false, item: null })} className="border-white/10 text-xs font-bold">Cancel</Button>
            <Button type="submit" form={editorFormId} disabled={saveMutation.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold">
              {saveMutation.isPending ? "Saving..." : editor.item ? "Save Changes" : "Create Job"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Archive Job"
        description={`"${deleteTarget?.title ?? ""}" will be archived and removed from public listings. You can restore it to Draft later.`}
        confirmLabel="Archive"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />

      <JobImportDialog open={importOpen} onOpenChange={setImportOpen} />
      <JobSourcesDialog open={sourcesOpen} onOpenChange={setSourcesOpen} />
    </div>
  );
}
