"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { Search, MoreHorizontal, ExternalLink, Plus, Globe, Archive, Trash2, Pencil, AlertCircle, Upload } from "lucide-react";
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

interface Resource {
  id: string;
  title: string;
  slug: string;
  description?: string;
  type: string;
  status: string;
  fileUrl?: string;
  externalUrl?: string;
  thumbnailId?: string;
  category?: string;
  isGated?: boolean;
  tags?: string[];
  seoTitle?: string;
  seoDesc?: string;
  downloadCount?: number;
  publishedAt?: string;
  createdAt: string;
}

interface ResourcesResponse {
  data: Resource[];
  total: number;
}

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export const RESOURCE_TYPES = ["PDF", "VIDEO", "LINK", "IMAGE", "DOCUMENT", "AUDIO", "OTHER"];

export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  PDF: "PDF",
  VIDEO: "Video",
  LINK: "Link",
  IMAGE: "Image",
  DOCUMENT: "Document / Article",
  AUDIO: "Audio",
  OTHER: "Other",
};

interface ResourceManagerProps {
  title: string;
  description: string;
  emptyTitle?: string;
  emptyDescription?: string;
  /** Default type filter applied to the list. "all" shows every resource. */
  defaultType?: string;
  /** Hide the type column + type filter (used by the blog module). */
  hideType?: boolean;
}

export function ResourceManager({
  title,
  description,
  emptyTitle = "No resources found",
  emptyDescription = "Create your first resource to get started.",
  defaultType = "all",
  hideType = false,
}: ResourceManagerProps) {
  const queryClient = useQueryClient();
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [typeFilter, setTypeFilter] = React.useState(defaultType);
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [editor, setEditor] = React.useState<{ open: boolean; item: Resource | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = React.useState<Resource | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const fileUrlRef = React.useRef<HTMLInputElement>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const uploadFile = async (file: File) => {
    // Cloud Run rejects request bodies above 32 MB, below the 50 MB storage limit.
    if (file.size > MAX_UPLOAD_BYTES) {
      toast({ title: "File too large", description: "Upload files up to 30 MB, or paste a link instead.", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("tags", "resource");
      const asset = await apiFetch<{ fileUrl: string }>("/media", { method: "POST", body: form });
      if (fileUrlRef.current) fileUrlRef.current.value = asset.fileUrl;
      toast({ title: "File uploaded", description: file.name });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["resources", pagination, sorting, debouncedSearch, statusFilter, typeFilter],
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
        ...(typeFilter && typeFilter !== "all" ? { type: typeFilter } : {}),
      });
      return apiFetch<ResourcesResponse>(`/resources?${p}`);
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["resources"] });

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<Resource> }) =>
      id
        ? apiFetch<Resource>(`/resources/${id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch<Resource>("/resources", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (_, variables) => {
      invalidate();
      toast({ title: variables.id ? "Resource updated" : "Resource created", description: "Your changes have been saved." });
      setEditor({ open: false, item: null });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const publishMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiFetch(`/resources/${id}/publish`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Status updated", description: "Resource status transitioned successfully." });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/resources/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Resource deleted", description: "The resource has been removed." });
      setDeleteTarget(null);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editor.open) return;
    const formData = new FormData(e.currentTarget);
    const item = editor.item;
    const tagsRaw = (formData.get("tags") as string) ?? "";
    const body: Partial<Resource> = {
      title: formData.get("title") as string,
      slug: ((formData.get("slug") as string) || undefined),
      type: formData.get("type") as string,
      description: (formData.get("description") as string) || undefined,
      fileUrl: (formData.get("fileUrl") as string) || undefined,
      externalUrl: (formData.get("externalUrl") as string) || undefined,
      category: (formData.get("category") as string) || undefined,
      isGated: formData.get("isGated") === "true",
      tags: tagsRaw.split(",").map((t) => t.trim()).filter(Boolean),
      seoTitle: (formData.get("seoTitle") as string) || undefined,
      seoDesc: (formData.get("seoDesc") as string) || undefined,
    };
    saveMutation.mutate({ id: item?.id, body });
  };

  const editorFormId = "resource-editor-form";

  const columns: ColumnDef<Resource>[] = [
    {
      accessorKey: "title",
      header: "Resource",
      cell: ({ row }) => (
        <div>
          <button onClick={() => setEditor({ open: true, item: row.original })} className="text-sm font-medium text-foreground hover:text-primary text-left transition-colors">
            {row.original.title}
          </button>
          <p className="text-xs text-muted-foreground font-mono">/{row.original.slug}</p>
        </div>
      ),
    },
    ...(!hideType
      ? [{
          accessorKey: "type",
          header: "Type",
          cell: ({ row }) => (
            <Badge variant="outline" className="text-xs">
              {RESOURCE_TYPE_LABELS[row.original.type] ?? row.original.type}
            </Badge>
          ),
        } satisfies ColumnDef<Resource>]
      : []),
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} domain="resource" />,
    },
    {
      accessorKey: "downloadCount",
      header: "Downloads",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.downloadCount ?? 0}</span>
      ),
    },
    {
      accessorKey: "publishedAt",
      header: "Published",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.original.publishedAt)}</span>
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
              <DropdownMenuItem onClick={() => setEditor({ open: true, item: r })} className="cursor-pointer">
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </DropdownMenuItem>
              {r.fileUrl && (
                <DropdownMenuItem asChild>
                  <a href={r.fileUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Resource
                  </a>
                </DropdownMenuItem>
              )}
              {r.status !== "PUBLISHED" && (
                <DropdownMenuItem onClick={() => publishMutation.mutate({ id: r.id, status: "PUBLISHED" })} className="cursor-pointer">
                  <Globe className="mr-2 h-4 w-4 text-emerald-400" /> Publish
                </DropdownMenuItem>
              )}
              {r.status === "PUBLISHED" && (
                <DropdownMenuItem onClick={() => publishMutation.mutate({ id: r.id, status: "DRAFT" })} className="cursor-pointer">
                  <Globe className="mr-2 h-4 w-4 text-amber-400" /> Unpublish
                </DropdownMenuItem>
              )}
              {r.status !== "ARCHIVED" && (
                <DropdownMenuItem onClick={() => publishMutation.mutate({ id: r.id, status: "ARCHIVED" })} className="cursor-pointer">
                  <Archive className="mr-2 h-4 w-4" /> Archive
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setDeleteTarget(r)} className="cursor-pointer text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
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
        title={title}
        description={`${data?.total ?? 0} ${description}`}
        action={
          <Button onClick={() => setEditor({ open: true, item: null })} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20">
            <Plus className="h-4 w-4 mr-2" />
            Create Resource
          </Button>
        }
      />

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {["all", "DRAFT", "PUBLISHED", "ARCHIVED"].map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!hideType && (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {RESOURCE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{RESOURCE_TYPE_LABELS[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {isError && (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl border border-rose-500/20 bg-rose-500/10 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-rose-400" />
          <div>
            <h3 className="text-base font-bold text-white">Failed to Load Resources</h3>
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
          emptyTitle={emptyTitle}
          emptyDescription={emptyDescription}
        />
      )}

      {/* Create / Edit dialog */}
      <Dialog open={editor.open} onOpenChange={(o) => !o && setEditor({ open: false, item: null })}>
        <DialogContent className="max-w-2xl glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">
              {editor.item ? "Edit Resource" : "Create Resource"}
            </DialogTitle>
          </DialogHeader>
          {editor.open && (
            <form id={editorFormId} onSubmit={handleSave} className="space-y-4 pt-2 max-h-[65vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Title *</Label>
                  <Input name="title" required defaultValue={editor.item?.title ?? ""} placeholder="e.g. DGCA Exam Guide 2025" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label>Type *</Label>
                  <select name="type" required defaultValue={editor.item?.type ?? "DOCUMENT"} className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none">
                    {RESOURCE_TYPES.map((t) => (
                      <option key={t} value={t} className="bg-slate-900">{RESOURCE_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>URL Slug (lowercase, hyphens)</Label>
                  <Input name="slug" defaultValue={editor.item?.slug ?? ""} placeholder="e.g. dgca-exam-guide-2025" className="bg-secondary/40 border-white/10 text-xs text-white font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Input name="category" defaultValue={editor.item?.category ?? ""} placeholder="e.g. blog, study-guide, brochure" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Description / Excerpt</Label>
                <Textarea name="description" defaultValue={editor.item?.description ?? ""} rows={4} placeholder="Summary shown on the public site..." className="bg-secondary/40 border-white/10 text-xs text-white leading-relaxed" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>File (upload or paste URL)</Label>
                  <div className="flex gap-2">
                    <Input ref={fileUrlRef} name="fileUrl" defaultValue={editor.item?.fileUrl ?? ""} placeholder="https://..." className="bg-secondary/40 border-white/10 text-xs text-white" />
                    <input
                      ref={fileInputRef}
                      type="file"
                      data-testid="resource-file-input"
                      accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*,video/mp4,audio/mpeg"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (file) uploadFile(file);
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                      className="border-white/10 text-xs font-semibold shrink-0"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      {uploading ? "Uploading..." : "Upload"}
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>External URL</Label>
                  <Input name="externalUrl" defaultValue={editor.item?.externalUrl ?? ""} placeholder="https://..." className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Featured Thumbnail (media library)</Label>
                  <MediaPicker
                    value={editor.item?.thumbnailId ?? null}
                    onChange={(id) => {
                      setEditor((prev) => ({
                        ...prev,
                        item: prev.item
                          ? { ...prev.item, thumbnailId: id ?? undefined }
                          : { id: "", title: "", slug: "", type: "DOCUMENT", status: "DRAFT", createdAt: "", thumbnailId: id ?? undefined },
                      }));
                    }}
                    label="thumbnail"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Access</Label>
                  <select name="isGated" defaultValue={editor.item?.isGated ? "true" : "false"} className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none">
                    <option value="false" className="bg-slate-900">Public (direct download)</option>
                    <option value="true" className="bg-slate-900">Gated (lead form required)</option>
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Tags (comma separated)</Label>
                <Input name="tags" defaultValue={editor.item?.tags?.join(", ") ?? ""} placeholder="exam, dgca, study-guide" className="bg-secondary/40 border-white/10 text-xs text-white" />
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
              {saveMutation.isPending ? "Saving..." : editor.item ? "Save Changes" : "Create Resource"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Resource"
        description={`"${deleteTarget?.title ?? ""}" will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
