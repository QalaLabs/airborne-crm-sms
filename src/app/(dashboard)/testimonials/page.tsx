"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type ColumnDef, type PaginationState, type SortingState } from "@tanstack/react-table";
import { Search, CheckCircle, XCircle, Star, AlertCircle, Plus, Trash2, Pencil, MoreHorizontal } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MediaPicker } from "@/components/shared/media-picker";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiFetch } from "@/lib/api";
import { usePendingTestimonialCount } from "@/lib/queries/testimonial-pending";
import { formatDate } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { websiteSyncMessage } from "@/lib/website/website-sync-message";

interface Testimonial {
  id: string;
  authorName: string;
  authorTitle?: string;
  authorEmail?: string;
  content: string;
  rating?: number;
  status: string;
  avatarId?: string;
  course?: { title: string };
  reviewNotes?: string;
  batchYear?: number;
  source?: string;
  isFeatured?: boolean;
  order?: number;
  createdAt: string;
}

interface TestimonialsResponse {
  data: Testimonial[];
  total: number;
}

const TESTIMONIAL_STATUSES = ["all", "PENDING", "APPROVED", "REJECTED"];

export default function TestimonialsPage() {
  const queryClient = useQueryClient();
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [sorting, setSorting] = React.useState<SortingState>([{ id: "createdAt", desc: true }]);
  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [reviewDialog, setReviewDialog] = React.useState<{ open: boolean; id: string; action: "APPROVED" | "REJECTED" } | null>(null);
  const [reviewNotes, setReviewNotes] = React.useState("");
  const [editor, setEditor] = React.useState<{ open: boolean; item: Testimonial | null }>({ open: false, item: null });
  const [deleteTarget, setDeleteTarget] = React.useState<Testimonial | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["testimonials", pagination, sorting, debouncedSearch, statusFilter],
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
      return apiFetch<TestimonialsResponse>(`/testimonials?${p}`);
    },
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["testimonials"] });

  const reviewMutation = useMutation({
    mutationFn: ({ id, status, notes }: { id: string; status: string; notes?: string }) =>
      apiFetch(`/testimonials/${id}/review`, { method: "POST", body: JSON.stringify({ status, reviewNotes: notes }) }),
    onSuccess: (res, variables) => {
      invalidate();
      toast({
        title: variables.status === "APPROVED" ? "Testimonial approved" : "Testimonial rejected",
        description: websiteSyncMessage(res),
        variant: variables.status === "APPROVED" ? ("success" as "default") : "destructive",
      });
      setReviewDialog(null);
      setReviewNotes("");
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveMutation = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Partial<Testimonial> }) =>
      id
        ? apiFetch<Testimonial>(`/testimonials/${id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch<Testimonial>("/testimonials", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (res, variables) => {
      invalidate();
      toast({
        title: variables.id ? "Testimonial updated" : "Testimonial created",
        description: [
          variables.id ? "Your changes have been saved." : "New testimonials start as PENDING until approved.",
          websiteSyncMessage(res),
        ]
          .filter(Boolean)
          .join(" "),
      });
      setEditor({ open: false, item: null });
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/testimonials/${id}`, { method: "DELETE" }),
    onSuccess: (res) => {
      invalidate();
      toast({
        title: "Testimonial deleted",
        description: ["The testimonial has been removed.", websiteSyncMessage(res)].filter(Boolean).join(" "),
      });
      setDeleteTarget(null);
    },
    onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleReview = (id: string, action: "APPROVED" | "REJECTED") => {
    setReviewDialog({ open: true, id, action });
    setReviewNotes("");
  };

  const confirmReview = () => {
    if (!reviewDialog) return;
    reviewMutation.mutate({ id: reviewDialog.id, status: reviewDialog.action, notes: reviewNotes || undefined });
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editor.open) return;
    const formData = new FormData(e.currentTarget);
    const item = editor.item;
    const ratingRaw = formData.get("rating") as string;
    const batchYearRaw = formData.get("batchYear") as string;
    const body: Partial<Testimonial> = {
      authorName: formData.get("authorName") as string,
      authorTitle: (formData.get("authorTitle") as string) || undefined,
      authorEmail: (formData.get("authorEmail") as string) || undefined,
      content: formData.get("content") as string,
      rating: ratingRaw ? Number(ratingRaw) : undefined,
      batchYear: batchYearRaw ? Number(batchYearRaw) : undefined,
      source: (formData.get("source") as string) || undefined,
    };
    if (item?.avatarId) body.avatarId = item.avatarId;
    if (item?.id) {
      body.isFeatured = formData.get("isFeatured") === "true";
      if (!item.avatarId) (body as { avatarId?: string | null }).avatarId = null;
      const orderRaw = formData.get("order") as string;
      if (orderRaw !== null && orderRaw !== "") body.order = Number(orderRaw);
    }
    saveMutation.mutate({ id: item?.id, body });
  };

  const editorFormId = "testimonial-editor-form";

  const columns: ColumnDef<Testimonial>[] = [
    {
      accessorKey: "authorName",
      header: "Author",
      cell: ({ row }) => (
        <div>
          <p className="text-sm font-medium text-foreground">{row.original.authorName}</p>
          {row.original.authorTitle && (
            <p className="text-xs text-muted-foreground">{row.original.authorTitle}</p>
          )}
          {row.original.authorEmail && (
            <p className="text-xs text-muted-foreground">{row.original.authorEmail}</p>
          )}
        </div>
      ),
    },
    {
      accessorKey: "content",
      header: "Testimonial",
      cell: ({ row }) => (
        <p className="text-sm text-muted-foreground max-w-xs truncate">{row.original.content}</p>
      ),
    },
    {
      accessorKey: "rating",
      header: "Rating",
      cell: ({ row }) =>
        row.original.rating != null ? (
          <div className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5 fill-warning text-warning" />
            <span className="text-sm font-medium">{row.original.rating}/5</span>
          </div>
        ) : (
          <span className="text-muted-foreground text-sm">-</span>
        ),
    },
    {
      accessorKey: "course",
      header: "Course",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.course?.title ?? "-"}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} domain="testimonial" />,
    },
    {
      accessorKey: "createdAt",
      header: "Submitted",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{formatDate(row.original.createdAt)}</span>
      ),
    },
    {
      id: "actions",
      size: 160,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Actions for ${t.authorName}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {t.status === "PENDING" && (
                <>
                  <DropdownMenuItem onClick={() => handleReview(t.id, "APPROVED")} className="cursor-pointer">
                    <CheckCircle className="mr-2 h-4 w-4 text-success" /> Approve
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleReview(t.id, "REJECTED")} className="cursor-pointer">
                    <XCircle className="mr-2 h-4 w-4 text-destructive" /> Reject
                  </DropdownMenuItem>
                </>
              )}
              {t.status === "APPROVED" && (
                <DropdownMenuItem onClick={() => handleReview(t.id, "REJECTED")} className="cursor-pointer">
                  <XCircle className="mr-2 h-4 w-4 text-destructive" /> Unpublish
                </DropdownMenuItem>
              )}
              {t.status === "REJECTED" && (
                <DropdownMenuItem onClick={() => handleReview(t.id, "APPROVED")} className="cursor-pointer">
                  <CheckCircle className="mr-2 h-4 w-4 text-success" /> Publish
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setEditor({ open: true, item: t })} className="cursor-pointer">
                <Pencil className="mr-2 h-4 w-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setDeleteTarget(t)} className="cursor-pointer text-destructive focus:text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
    },
  ];

  const { count: pendingCount } = usePendingTestimonialCount();

  return (
    <div className="space-y-5">
      <PageHeader
        title="Testimonials"
        description={`${data?.total ?? 0} total testimonials`}
        action={
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <Badge variant="warning" className="text-sm px-3 py-1" data-testid="testimonials-pending-count">
                {pendingCount} pending review
              </Badge>
            )}
            <Button onClick={() => setEditor({ open: true, item: null })} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20">
              <Plus className="h-4 w-4 mr-2" />
              Add Testimonial
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search testimonials..."
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
            {TESTIMONIAL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s === "all" ? "All Statuses" : s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isError && (
        <div className="flex flex-col items-center justify-center p-12 rounded-2xl border border-rose-500/20 bg-rose-500/10 text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-rose-400" />
          <div>
            <h3 className="text-base font-bold text-white">Failed to Load Testimonials</h3>
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
          emptyTitle="No testimonials found"
          emptyDescription="Testimonials submitted by students will appear here."
        />
      )}

      {/* Review Dialog */}
      <Dialog open={reviewDialog?.open ?? false} onOpenChange={(o) => !o && setReviewDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {reviewDialog?.action === "APPROVED" ? "Approve Testimonial" : "Reject Testimonial"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {reviewDialog?.action === "APPROVED"
                ? "This testimonial will be approved and may be displayed publicly."
                : "This testimonial will be rejected and hidden from public view."}
            </p>
            <div className="space-y-2">
              <Label>Review Notes (optional)</Label>
              <Textarea
                placeholder="Add notes about your decision..."
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviewDialog(null)}>Cancel</Button>
            <Button
              onClick={confirmReview}
              disabled={reviewMutation.isPending}
              className={
                reviewDialog?.action === "APPROVED"
                  ? "bg-success text-white hover:bg-success/90"
                  : "bg-destructive text-destructive-foreground hover:bg-destructive/90"
              }
            >
              {reviewMutation.isPending
                ? "Processing..."
                : reviewDialog?.action === "APPROVED"
                ? "Approve"
                : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create / Edit Dialog */}
      <Dialog open={editor.open} onOpenChange={(o) => !o && setEditor({ open: false, item: null })}>
        <DialogContent className="max-w-2xl glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">
              {editor.item ? "Edit Testimonial" : "Add Testimonial"}
            </DialogTitle>
          </DialogHeader>
          {editor.open && (
            <form id={editorFormId} onSubmit={handleSave} className="space-y-4 pt-2 max-h-[65vh] overflow-y-auto pr-1">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Author Name *</Label>
                  <Input name="authorName" required defaultValue={editor.item?.authorName ?? ""} placeholder="e.g. Rahul Sharma" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label>Author Title</Label>
                  <Input name="authorTitle" defaultValue={editor.item?.authorTitle ?? ""} placeholder="e.g. CPL Holder, 2025 Batch" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Author Email</Label>
                  <Input name="authorEmail" type="email" defaultValue={editor.item?.authorEmail ?? ""} placeholder="e.g. rahul@example.com" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label>Rating</Label>
                  <select name="rating" defaultValue={editor.item?.rating?.toString() ?? ""} className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none">
                    <option value="" className="bg-slate-900">No rating</option>
                    {[5, 4, 3, 2, 1].map((r) => (
                      <option key={r} value={r} className="bg-slate-900">{r} star{r > 1 ? "s" : ""}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Batch Year</Label>
                  <Input name="batchYear" type="number" min="2000" max="2100" defaultValue={editor.item?.batchYear?.toString() ?? ""} placeholder="e.g. 2025" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
                <div className="space-y-1.5">
                  <Label>Source</Label>
                  <Input name="source" defaultValue={editor.item?.source ?? ""} placeholder="e.g. website form, google" className="bg-secondary/40 border-white/10 text-xs text-white" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Testimonial Content *</Label>
                <Textarea name="content" required defaultValue={editor.item?.content ?? ""} rows={4} minLength={10} placeholder="Write the testimonial (min 10 characters)..." className="bg-secondary/40 border-white/10 text-xs text-white leading-relaxed" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Avatar (media library)</Label>
                  <MediaPicker
                    value={editor.item?.avatarId ?? null}
                    onChange={(id) =>
                      setEditor((prev) => ({
                        ...prev,
                        item: prev.item
                          ? { ...prev.item, avatarId: id ?? undefined }
                          : { id: "", authorName: "", content: "", status: "PENDING", createdAt: "", avatarId: id ?? undefined },
                      }))
                    }
                    label="avatar"
                  />
                </div>
                {editor.item?.id && (
                  <div className="space-y-1.5">
                    <Label>Featured</Label>
                    <select name="isFeatured" defaultValue={editor.item?.isFeatured ? "true" : "false"} className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none">
                      <option value="false" className="bg-slate-900">Not featured</option>
                      <option value="true" className="bg-slate-900">Featured (highlight)</option>
                    </select>
                  </div>
                )}
                {editor.item?.id && (
                  <div className="space-y-1.5">
                    <Label htmlFor="testimonial-order">Display order</Label>
                    <Input id="testimonial-order" name="order" type="number" min={0} defaultValue={editor.item?.order ?? 0} />
                  </div>
                )}
              </div>
            </form>
          )}
          <DialogFooter className="pt-4 border-t border-white/10">
            <Button type="button" variant="outline" onClick={() => setEditor({ open: false, item: null })} className="border-white/10 text-xs font-bold">Cancel</Button>
            <Button type="submit" form={editorFormId} disabled={saveMutation.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold">
              {saveMutation.isPending ? "Saving..." : editor.item ? "Save Changes" : "Add Testimonial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete Testimonial"
        description={`"${deleteTarget?.authorName ?? ""}" testimonial will be permanently deleted. This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
