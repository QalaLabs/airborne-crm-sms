"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, AlertCircle, ArrowLeft, Pencil } from "lucide-react";
import PublicPageRenderer from "@/components/cms/public-page-renderer";
import type { PageModel, PageStatus } from "@/types";

const STATUS_CHIP: Record<PageStatus, string> = {
  PUBLISHED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  SCHEDULED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  DRAFT: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  ARCHIVED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

export default function PagePreviewRoute() {
  const { id } = useParams<{ id: string }>();

  const { data: page, isLoading, isError, refetch } = useQuery({
    queryKey: ["cms-page-preview", id],
    queryFn: () => apiFetch<PageModel>(`/pages/${id}`),
    enabled: !!id,
  });

  if (isLoading || !page) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground font-semibold">Loading preview...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-24">
        <AlertCircle className="h-10 w-10 text-rose-400" />
        <p className="text-sm font-bold text-white">Failed to load preview.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="pb-16">
      <div className="sticky top-0 z-20 -mx-6 mb-6 border-b border-white/10 bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <a
              href={`/cms/pages/${page.id}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 hover:bg-white/5"
              aria-label="Back to editor"
            >
              <ArrowLeft className="h-4 w-4" />
            </a>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-white">{page.title}</h1>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${STATUS_CHIP[page.status]}`}>
                  {page.status}
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                /{page.slug} · v{page.version} · Published{" "}
                {page.publishedAt ? new Date(page.publishedAt).toLocaleString() : "never"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`/cms/pages/${page.id}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-3 text-xs font-bold transition-colors hover:bg-white/5 hover:text-white"
            >
              <Pencil className="h-3.5 w-3.5" /> Back to Editor
            </a>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white p-8 text-slate-900 shadow-xl">
        <PublicPageRenderer page={page} />
      </div>

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        This is the saved state of the page as rendered for public visitors. Published pages are
        served at /{page.slug} by the public pages API.
      </p>
    </div>
  );
}
