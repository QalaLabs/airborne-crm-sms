"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { type ColumnDef, type PaginationState } from "@tanstack/react-table";
import { ArrowLeft, RotateCcw, Search, Trash2, ShieldAlert, Clock } from "lucide-react";
import { DataTable } from "@/components/shared/data-table";
import { StatusBadge } from "@/components/shared/status-badge";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { apiFetch } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/utils";
import { trashDaysLeft } from "@/lib/leads/lead-trash";
import { toast } from "@/components/ui/use-toast";

interface TrashedLead {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  status: string;
  courseInterest: string | null;
  createdAt: string;
  deletedAt: string;
  purgeAt: string;
  hasAdmission: boolean;
  counselor: { id: string; name: string } | null;
}

interface TrashPage {
  items: TrashedLead[];
  total: number;
  totalPages: number;
  retentionDays: number;
}

export default function LeadRecycleBinPage() {
  const { data: session } = useSession();
  const canManage = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";
  const queryClient = useQueryClient();
  const [pagination, setPagination] = React.useState<PaginationState>({ pageIndex: 0, pageSize: 20 });
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [purgeTarget, setPurgeTarget] = React.useState<TrashedLead | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => {
      setDebouncedSearch(search);
      setPagination((p) => ({ ...p, pageIndex: 0 }));
    }, 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["leads-trash", pagination.pageIndex, pagination.pageSize, debouncedSearch],
    queryFn: () => {
      const params = new URLSearchParams({
        page: String(pagination.pageIndex + 1),
        limit: String(pagination.pageSize),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      return apiFetch<TrashPage>(`/leads/trash?${params}`);
    },
    enabled: canManage,
    placeholderData: keepPreviousData,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["leads-trash"] });
    queryClient.invalidateQueries({ queryKey: ["leads"] });
  };

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/leads/${id}/restore`, { method: "POST" }),
    onSuccess: () => {
      invalidate();
      toast({ title: "Lead restored", description: "The lead is back in All Leads." });
    },
    onError: (err) => toast({ title: "Restore failed", description: err.message, variant: "destructive" }),
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/leads/${id}/permanent`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      setPurgeTarget(null);
      toast({ title: "Lead permanently deleted" });
    },
    onError: (err) => {
      setPurgeTarget(null);
      toast({ title: "Could not delete permanently", description: err.message, variant: "destructive" });
    },
  });

  const retentionDays = data?.retentionDays ?? 30;

  const columns: ColumnDef<TrashedLead>[] = [
    {
      accessorKey: "name",
      header: "Lead",
      cell: ({ row }) => (
        <div>
          <p className="font-semibold text-white">{row.original.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.email ?? "-"}</p>
        </div>
      ),
    },
    {
      accessorKey: "phone",
      header: "Phone",
      cell: ({ row }) => <span className="text-xs font-mono text-muted-foreground">{row.original.phone}</span>,
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => <StatusBadge status={row.original.status} domain="lead" />,
    },
    {
      accessorKey: "courseInterest",
      header: "Course",
      cell: ({ row }) => <span className="text-xs">{row.original.courseInterest ?? "-"}</span>,
    },
    {
      accessorKey: "deletedAt",
      header: "Deleted",
      cell: ({ row }) => <span className="text-xs text-muted-foreground">{formatDateTime(row.original.deletedAt)}</span>,
    },
    {
      id: "purge",
      header: "Auto-delete",
      cell: ({ row }) => {
        if (row.original.hasAdmission) {
          return (
            <span className="text-[11px] font-semibold text-amber-400 flex items-center gap-1" title="Linked to an admission — never auto-deleted">
              <ShieldAlert className="h-3.5 w-3.5" /> Kept (admission)
            </span>
          );
        }
        const days = trashDaysLeft(row.original.deletedAt, retentionDays);
        return (
          <span className={`text-[11px] font-semibold flex items-center gap-1 ${days <= 3 ? "text-rose-400" : "text-muted-foreground"}`} title={formatDate(row.original.purgeAt)}>
            <Clock className="h-3.5 w-3.5" />
            {days === 0 ? "Today" : `in ${days} day${days === 1 ? "" : "s"}`}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={restoreMutation.isPending}
            onClick={() => restoreMutation.mutate(row.original.id)}
            className="h-8 text-xs font-bold border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restore
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={row.original.hasAdmission}
            title={row.original.hasAdmission ? "Linked to an admission — restore instead" : undefined}
            onClick={() => setPurgeTarget(row.original)}
            className="h-8 text-xs font-bold border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
          >
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete forever
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Lead Recycle Bin"
        description={`Deleted leads stay here for ${retentionDays} days, then are permanently deleted automatically.`}
        action={
          <Button asChild variant="outline" className="border-white/10 text-sm font-semibold">
            <Link href="/leads">
              <ArrowLeft className="h-4 w-4 mr-2" /> Back to Leads
            </Link>
          </Button>
        }
      />

      {!canManage ? (
        <div className="rounded-2xl border border-white/10 p-10 text-center text-sm text-muted-foreground">
          Only Admin and Super Admin can view the Recycle Bin.
        </div>
      ) : (
        <>
          <div className="glass-card rounded-2xl p-5 border border-white/10">
            <div className="relative max-w-lg">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search deleted leads by name, email, phone..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-secondary/40 border-white/10 text-sm"
              />
            </div>
          </div>

          {isError ? (
            <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-8 text-center text-sm text-rose-300">
              {error?.message ?? "Failed to load the Recycle Bin"}
            </div>
          ) : (
            <div className="glass-card rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
              <DataTable
                columns={columns}
                data={data?.items ?? []}
                loading={isLoading}
                pageCount={data?.totalPages ?? 0}
                pagination={pagination}
                onPaginationChange={setPagination}
                emptyTitle="Recycle Bin is empty"
                emptyDescription="Deleted leads will appear here."
              />
            </div>
          )}
        </>
      )}

      <AlertDialog open={!!purgeTarget} onOpenChange={(o) => !o && !purgeMutation.isPending && setPurgeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              {purgeTarget?.name} and their timeline, score history and Lead Pipeline entry will be erased. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={purgeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={purgeMutation.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (purgeTarget) purgeMutation.mutate(purgeTarget.id);
              }}
              className="bg-rose-600 hover:bg-rose-700"
            >
              {purgeMutation.isPending ? "Deleting..." : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
