"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, History, RotateCcw, AlertCircle } from "lucide-react";
import type { PageVersionModel } from "@/types";

const STATUS_CHIP: Record<PageVersionModel["status"], string> = {
  PUBLISHED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  SCHEDULED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  DRAFT: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  ARCHIVED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export default function VersionHistory({
  pageId,
  open,
  onOpenChange,
  onRolledBack,
}: {
  pageId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRolledBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [pendingVersion, setPendingVersion] = React.useState<PageVersionModel | null>(null);

  const { data: versions, isLoading, isError, refetch } = useQuery({
    queryKey: ["cms-versions", pageId],
    queryFn: () => apiFetch<PageVersionModel[]>(`/pages/${pageId}/versions`),
    enabled: open,
  });

  const rollbackMutation = useMutation({
    mutationFn: (versionId: string) =>
      apiFetch(`/pages/${pageId}/versions/${versionId}/rollback`, { method: "POST" }),
    onSuccess: () => {
      toast({
        title: "Rollback Complete",
        description: `Page structure restored and set back to DRAFT (new version created).`,
      });
      setPendingVersion(null);
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageId] });
      queryClient.invalidateQueries({ queryKey: ["cms-versions", pageId] });
      onRolledBack();
    },
    onError: (err) => {
      toast({ title: "Rollback Failed", description: err.message, variant: "destructive" });
      setPendingVersion(null);
    },
  });

  return (
    <>
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="max-w-2xl border-white/10 bg-slate-900/95">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-white">
              <History className="h-5 w-5 text-primary" /> Version History
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    A snapshot is created on every publish and rollback.
                  </p>
                  <Button size="sm" variant="outline" className="h-7 border-white/10 text-xs font-bold" onClick={() => refetch()}>
                    Refresh
                  </Button>
                </div>

                {isLoading ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading versions...
                  </div>
                ) : isError ? (
                  <div className="flex items-center justify-center gap-2 py-12 text-xs text-rose-400">
                    <AlertCircle className="h-4 w-4" /> Failed to load versions.
                  </div>
                ) : (versions ?? []).length === 0 ? (
                  <p className="py-12 text-center text-xs text-muted-foreground">
                    No versions recorded yet. Publish this page to create the first snapshot.
                  </p>
                ) : (
                  <ScrollArea className="mt-2 h-[40vh]">
                    <div className="space-y-2 pr-3">
                      {(versions ?? []).map((v) => (
                        <div key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-secondary/30 px-3 py-2">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-white">v{v.version}</span>
                              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${STATUS_CHIP[v.status]}`}>
                                {v.status}
                              </span>
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {new Date(v.createdAt).toLocaleString()} · {v.creator?.name ?? "System"}
                              {v.notes ? ` · ${v.notes}` : ""}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 shrink-0 border-white/10 text-xs font-bold"
                            disabled={rollbackMutation.isPending}
                            onClick={() => setPendingVersion(v)}
                          >
                            <RotateCcw className="h-3 w-3" /> Restore
                          </Button>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-xs font-bold">Close</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!pendingVersion} onOpenChange={(o) => !o && setPendingVersion(null)}>
        <AlertDialogContent className="border-white/10 bg-slate-900/95">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Restore v{pendingVersion?.version}?</AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground">
              This replaces the current page structure with the saved snapshot and sets the page
              back to DRAFT. A new version will be created to record the rollback. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 text-xs font-bold">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white text-xs font-bold"
              disabled={rollbackMutation.isPending}
              onClick={() => pendingVersion && rollbackMutation.mutate(pendingVersion.id)}
            >
              {rollbackMutation.isPending ? "Restoring..." : "Restore Version"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
