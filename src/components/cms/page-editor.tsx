"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiClientError } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import { websiteSyncMessage } from "@/lib/website/website-sync-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import SectionEditor from "@/components/cms/section-editor";
import VersionHistory from "@/components/cms/version-history";
import PublicPageRenderer from "@/components/cms/public-page-renderer";
import {
  Globe,
  Clock,
  Archive,
  CalendarClock,
  Loader2,
  AlertCircle,
  Save,
  Eye,
  EyeOff,
  History,
  Plus,
  Settings2,
  ChevronDown,
  ChevronUp,
  Undo2,
  ArrowLeft,
} from "lucide-react";
import type {
  BlockTypeModel,
  PageMetaPatch,
  PageModel,
  PageSectionModel,
  PageStatus,
} from "@/types";

const PAGE_TRANSITIONS: Record<PageStatus, PageStatus[]> = {
  DRAFT: ["PUBLISHED", "SCHEDULED", "ARCHIVED"],
  SCHEDULED: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

const TRANSITION_META: Record<PageStatus, { label: string; icon: typeof Globe }> = {
  PUBLISHED: { label: "Publish", icon: Globe },
  SCHEDULED: { label: "Schedule", icon: CalendarClock },
  DRAFT: { label: "Unpublish (to Draft)", icon: Clock },
  ARCHIVED: { label: "Archive", icon: Archive },
};

const STATUS_CHIP: Record<PageStatus, string> = {
  PUBLISHED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  SCHEDULED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  DRAFT: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  ARCHIVED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
};

type Op =
  | { kind: "updatePage"; payload: PageMetaPatch }
  | { kind: "addSection"; tempId: string; payload: { name?: string; order?: number; isVisible?: boolean } }
  | { kind: "updateSection"; sectionId: string; payload: { name?: string | null; isVisible?: boolean } }
  | { kind: "deleteSection"; sectionId: string }
  | { kind: "addBlock"; sectionId: string; tempId: string; payload: { blockTypeId: string; props: Record<string, unknown>; isVisible?: boolean } }
  | { kind: "updateBlock"; sectionId: string; blockId: string; payload: { props?: Record<string, unknown>; isVisible?: boolean } }
  | { kind: "deleteBlock"; sectionId: string; blockId: string };

async function apiDelete(path: string) {
  const res = await fetch(`/api/v1${path}`, { method: "DELETE", credentials: "include" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
    throw new ApiClientError(err?.error?.message ?? `HTTP ${res.status}`, err?.error?.code, res.status);
  }
}

function isTemp(id: string, createdTemps: Set<string>) {
  return createdTemps.has(id);
}

export default function PageEditor({ pageId }: { pageId: string }) {
  const queryClient = useQueryClient();

  // ─── Server data ────────────────────────────────────────────────────────────
  const { data: loadedPage, isLoading, isError, refetch } = useQuery({
    queryKey: ["cms-page", pageId],
    queryFn: () => apiFetch<PageModel>(`/pages/${pageId}`),
  });

  const { data: blockTypes = [] } = useQuery({
    queryKey: ["cms-block-registry"],
    queryFn: async () => {
      const raw = await fetch("/api/v1/blocks?page=1&limit=50", { credentials: "include" });
      if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
      const json = (await raw.json()) as { data: BlockTypeModel[] };
      return json.data;
    },
  });

  // ─── Local draft + pending ops ──────────────────────────────────────────────
  const [draft, setDraft] = React.useState<PageModel | null>(null);
  const [ops, setOps] = React.useState<Op[]>([]);
  const [saving, setSaving] = React.useState(false);
  const [showPreview, setShowPreview] = React.useState(false);
  const [showSettings, setShowSettings] = React.useState(false);
  const [versionsOpen, setVersionsOpen] = React.useState(false);
  const [scheduleOpen, setScheduleOpen] = React.useState(false);
  const [scheduleAt, setScheduleAt] = React.useState("");

  const createdTempsRef = React.useRef(new Set<string>());
  const dirtyRef = React.useRef(false);

  React.useEffect(() => {
    if (loadedPage && !draft) {
      setDraft(structuredClone(loadedPage));
    }
  }, [loadedPage]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = ops.length > 0;
  React.useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ─── Publish mutation ───────────────────────────────────────────────────────
  const publishMutation = useMutation({
    mutationFn: ({ status, scheduledAt }: { status: PageStatus; scheduledAt?: string }) =>
      apiFetch<{ page: PageModel; version: unknown }>(`/pages/${pageId}/publish`, {
        method: "POST",
        body: JSON.stringify({ status, ...(scheduledAt ? { scheduledAt } : {}) }),
      }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      queryClient.invalidateQueries({ queryKey: ["cms-page", pageId] });
      queryClient.invalidateQueries({ queryKey: ["cms-versions", pageId] });
      toast({
        title: "Status Updated",
        description: ["Page publishing status transitioned.", websiteSyncMessage(res)].filter(Boolean).join(" "),
      });
    },
    onError: (err) => {
      toast({ title: "Status Change Failed", description: err.message, variant: "destructive" });
    },
  });

  // ─── Draft mutation helpers ─────────────────────────────────────────────────
  const commitOps = (nextOps: Op[]) => setOps(nextOps);

  const patchMeta = (patch: PageMetaPatch) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    const merged: PageMetaPatch = {
      title: patch.title ?? draft.title,
      slug: patch.slug ?? draft.slug,
      description: patch.description !== undefined ? patch.description : draft.description,
      seoTitle: patch.seoTitle !== undefined ? patch.seoTitle : draft.seoTitle,
      seoDesc: patch.seoDesc !== undefined ? patch.seoDesc : draft.seoDesc,
      seoKeywords: patch.seoKeywords ?? draft.seoKeywords,
      ogImage: patch.ogImage !== undefined ? patch.ogImage : draft.ogImage,
    };
    commitOps([...ops.filter((o) => o.kind !== "updatePage"), { kind: "updatePage", payload: merged }]);
  };

  const addSection = () => {
    if (!draft) return;
    const tempId = crypto.randomUUID();
    const order = draft.sections.reduce((max, s) => Math.max(max, s.order), -1) + 1;
    const section: PageSectionModel = {
      id: tempId,
      name: "New Section",
      order,
      isVisible: true,
      settings: {},
      blocks: [],
    };
    createdTempsRef.current.add(tempId);
    setDraft({ ...draft, sections: [...draft.sections, section] });
    commitOps([...ops, { kind: "addSection", tempId, payload: { name: "New Section", order, isVisible: true } }]);
  };

  const updateSectionLocal = (sectionId: string, patch: { name?: string | null; isVisible?: boolean }) => {
    if (!draft) return;
    setDraft({
      ...draft,
      sections: draft.sections.map((s) => (s.id === sectionId ? { ...s, ...patch } : s)),
    });
    commitOps([
      ...ops.filter((o) => !(o.kind === "updateSection" && o.sectionId === sectionId)),
      { kind: "updateSection", sectionId, payload: patch },
    ]);
  };

  const deleteSection = (sectionId: string) => {
    if (!draft) return;
    const wasTemp = isTemp(sectionId, createdTempsRef.current);
    const remaining = ops.filter(
      (o) =>
        !(
          (o.kind === "addSection" && o.tempId === sectionId) ||
          (o.kind === "updateSection" && o.sectionId === sectionId) ||
          (o.kind === "addBlock" && o.sectionId === sectionId) ||
          (o.kind === "updateBlock" && o.sectionId === sectionId) ||
          (o.kind === "deleteBlock" && o.sectionId === sectionId)
        ),
    );
    createdTempsRef.current.delete(sectionId);
    setDraft({ ...draft, sections: draft.sections.filter((s) => s.id !== sectionId) });
    if (wasTemp) {
      commitOps(remaining);
    } else {
      commitOps([...remaining, { kind: "deleteSection", sectionId }]);
    }
  };

  const moveSection = (sectionId: string, dir: -1 | 1) => {
    if (!draft) return;
    const sorted = [...draft.sections].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((s) => s.id === sectionId);
    const target = index + dir;
    if (index < 0 || target < 0 || target >= sorted.length) return;
    const [item] = sorted.splice(index, 1);
    if (!item) return;
    sorted.splice(target, 0, item);
    sorted.forEach((s, i) => (s.order = i));
    setDraft({ ...draft, sections: sorted });
  };

  const addBlock = (sectionId: string, blockType: BlockTypeModel) => {
    if (!draft) return;
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section) return;
    const tempId = crypto.randomUUID();
    const order = section.blocks.reduce((max, b) => Math.max(max, b.order), -1) + 1;
    createdTempsRef.current.add(tempId);
    const block = {
      id: tempId,
      sectionId,
      blockTypeId: blockType.id,
      order,
      props: { ...blockType.defaultProps },
      isVisible: true,
      blockType,
    };
    setDraft({
      ...draft,
      sections: draft.sections.map((s) =>
        s.id === sectionId ? { ...s, blocks: [...s.blocks, block] } : s,
      ),
    });
    commitOps([
      ...ops,
      {
        kind: "addBlock",
        sectionId,
        tempId,
        payload: { blockTypeId: blockType.id, props: { ...blockType.defaultProps }, isVisible: true },
      },
    ]);
  };

  const updateBlockLocal = (
    sectionId: string,
    blockId: string,
    patch: { props?: Record<string, unknown>; isVisible?: boolean },
  ) => {
    if (!draft) return;
    setDraft({
      ...draft,
      sections: draft.sections.map((s) =>
        s.id === sectionId
          ? { ...s, blocks: s.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b)) }
          : s,
      ),
    });
    commitOps([
      ...ops.filter((o) => !(o.kind === "updateBlock" && o.blockId === blockId)),
      { kind: "updateBlock", sectionId, blockId, payload: patch },
    ]);
  };

  const deleteBlock = (sectionId: string, blockId: string) => {
    if (!draft) return;
    const wasTemp = isTemp(blockId, createdTempsRef.current);
    const remaining = ops.filter(
      (o) => !((o.kind === "addBlock" && o.tempId === blockId) || (o.kind === "updateBlock" && o.blockId === blockId)),
    );
    createdTempsRef.current.delete(blockId);
    setDraft({
      ...draft,
      sections: draft.sections.map((s) =>
        s.id === sectionId ? { ...s, blocks: s.blocks.filter((b) => b.id !== blockId) } : s,
      ),
    });
    if (wasTemp) {
      commitOps(remaining);
    } else {
      commitOps([...remaining, { kind: "deleteBlock", sectionId, blockId }]);
    }
  };

  const moveBlock = (sectionId: string, blockId: string, dir: -1 | 1) => {
    if (!draft) return;
    setDraft({
      ...draft,
      sections: draft.sections.map((s) => {
        if (s.id !== sectionId) return s;
        const sorted = [...s.blocks].sort((a, b) => a.order - b.order);
        const index = sorted.findIndex((b) => b.id === blockId);
        const target = index + dir;
        if (index < 0 || target < 0 || target >= sorted.length) return s;
        const [item] = sorted.splice(index, 1);
        if (!item) return s;
        sorted.splice(target, 0, item);
        sorted.forEach((b, i) => (b.order = i));
        return { ...s, blocks: sorted };
      }),
    });
  };

  const toggleSectionVisibility = (sectionId: string) => {
    if (!draft) return;
    const section = draft.sections.find((s) => s.id === sectionId);
    if (!section) return;
    updateSectionLocal(sectionId, { isVisible: !section.isVisible });
  };

  const toggleBlockVisibility = (sectionId: string, blockId: string) => {
    if (!draft) return;
    const section = draft.sections.find((s) => s.id === sectionId);
    const block = section?.blocks.find((b) => b.id === blockId);
    if (!section || !block) return;
    updateBlockLocal(sectionId, blockId, { isVisible: !block.isVisible });
  };

  // ─── Save executor ──────────────────────────────────────────────────────────
  const save = async () => {
    if (!draft || ops.length === 0 || saving) return;
    setSaving(true);
    const idMap = new Map<string, string>();
    const resolve = (id: string) => idMap.get(id) ?? id;
    const failures: string[] = [];

    try {
      for (const op of ops) {
        try {
          switch (op.kind) {
            case "updatePage":
              await apiFetch(`/pages/${pageId}`, { method: "PATCH", body: JSON.stringify(op.payload) });
              break;
            case "addSection": {
              const section = await apiFetch<{ id: string }>(`/pages/${pageId}/sections`, {
                method: "POST",
                body: JSON.stringify(op.payload),
              });
              idMap.set(op.tempId, section.id);
              break;
            }
            case "updateSection":
              await apiFetch(`/pages/${pageId}/sections/${resolve(op.sectionId)}`, {
                method: "PATCH",
                body: JSON.stringify(op.payload),
              });
              break;
            case "deleteSection":
              await apiDelete(`/pages/${pageId}/sections/${resolve(op.sectionId)}`);
              break;
            case "addBlock": {
              const block = await apiFetch<{ id: string }>(
                `/pages/${pageId}/sections/${resolve(op.sectionId)}/blocks`,
                { method: "POST", body: JSON.stringify(op.payload) },
              );
              idMap.set(op.tempId, block.id);
              break;
            }
            case "updateBlock":
              await apiFetch(
                `/pages/${pageId}/sections/${resolve(op.sectionId)}/blocks/${resolve(op.blockId)}`,
                { method: "PATCH", body: JSON.stringify(op.payload) },
              );
              break;
            case "deleteBlock":
              await apiDelete(`/pages/${pageId}/sections/${resolve(op.sectionId)}/blocks/${resolve(op.blockId)}`);
              break;
          }
        } catch (err) {
          failures.push(err instanceof Error ? err.message : "Unknown error");
          break;
        }
      }

      if (failures.length === 0) {
        const sections = [...draft.sections]
          .sort((a, b) => a.order - b.order)
          .map((s) => ({ id: resolve(s.id), order: s.order }));
        const blocks: Record<string, { id: string; order: number }[]> = {};
        for (const s of draft.sections) {
          const sorted = [...s.blocks].sort((a, b) => a.order - b.order);
          if (sorted.length > 0) {
            blocks[resolve(s.id)] = sorted.map((b) => ({ id: resolve(b.id), order: b.order }));
          }
        }
        await apiFetch(`/pages/${pageId}/layout`, {
          method: "PUT",
          body: JSON.stringify({ sections, blocks }),
        });
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSaving(false);
    }

    if (failures.length === 0) {
      createdTempsRef.current.clear();
      commitOps([]);
      await refetch();
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({
        title: "Page Saved",
        description: "All changes persisted. Publish the page to create a public snapshot.",
      });
    } else {
      // Resync from server; buffered edits are discarded to avoid duplicate entities on retry.
      await refetch();
      commitOps([]);
      createdTempsRef.current.clear();
      toast({
        title: "Save Failed",
        description: `${failures[0]} — Review the page state and try again.`,
        variant: "destructive",
      });
    }
  };

  const discardChanges = async () => {
    commitOps([]);
    createdTempsRef.current.clear();
    setDraft(null);
    await refetch();
    toast({ title: "Changes Discarded", description: "Reverted to the last saved state." });
  };

  const handlePublish = (status: PageStatus, scheduledAt?: string) => {
    if (dirty) {
      toast({
        title: "Unsaved Changes",
        description: "Save the page before changing its publishing status.",
        variant: "destructive",
      });
      return;
    }
    publishMutation.mutate({ status, scheduledAt });
  };

  // ─── Loading / error ────────────────────────────────────────────────────────
  if (isLoading || !draft) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-xs text-muted-foreground font-semibold">Loading page editor...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4 rounded-xl border border-rose-500/20 bg-rose-500/10">
        <AlertCircle className="h-10 w-10 text-rose-400" />
        <p className="text-sm font-bold text-white">Failed to load this page.</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  const transitions = PAGE_TRANSITIONS[draft.status] ?? [];

  return (
    <div className="space-y-6 pb-16">
      {/* Toolbar */}
      <div className="sticky top-0 z-20 -mx-6 border-b border-white/10 bg-background/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="/cms"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 hover:bg-white/5"
              aria-label="Back to CMS list"
            >
              <ArrowLeft className="h-4 w-4" />
            </a>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-bold text-white">{draft.title || "Untitled page"}</h1>
                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-extrabold ${STATUS_CHIP[draft.status]}`}>
                  {draft.status}
                </span>
              </div>
              <p className="truncate text-[11px] text-muted-foreground">
                /{draft.slug} · v{draft.version} · Updated {new Date(draft.updatedAt).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {dirty ? (
              <span className="rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[10px] font-extrabold text-amber-400">
                {ops.length} unsaved change{ops.length === 1 ? "" : "s"}
              </span>
            ) : null}

            <Button type="button" variant="outline" size="sm" className="border-white/10 text-xs font-bold" onClick={() => setVersionsOpen(true)}>
              <History className="h-3.5 w-3.5" /> Versions
            </Button>

            <Button
              type="button"
              variant={showPreview ? "secondary" : "outline"}
              size="sm"
              className="border-white/10 text-xs font-bold"
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showPreview ? "Exit Preview" : "Live Preview"}
            </Button>

            <a
              href={`/cms/pages/${pageId}/preview`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-3 text-xs font-bold text-muted-foreground transition-colors hover:bg-white/5 hover:text-white"
            >
              <Eye className="h-3.5 w-3.5" /> Open Preview
            </a>

            {dirty ? (
              <Button type="button" variant="ghost" size="sm" className="border-white/10 text-xs font-bold" onClick={discardChanges}>
                <Undo2 className="h-3.5 w-3.5" /> Discard
              </Button>
            ) : null}

            <Button type="button" size="sm" className="bg-primary text-xs font-bold text-white shadow-lg shadow-primary/20" disabled={!dirty || saving} onClick={save}>
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </div>

      {/* Publish row */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-secondary/20 p-4">
        <div>
          <p className="text-xs font-bold text-white">Publishing workflow</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Publishing creates a permanent version snapshot. Changes are saved as DRAFT until you publish.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {transitions.map((next) => {
            const meta = TRANSITION_META[next];
            const Icon = meta.icon;
            return (
              <Button
                key={next}
                type="button"
                size="sm"
                variant={next === "PUBLISHED" ? "default" : "outline"}
                className={next === "PUBLISHED" ? "bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500" : "border-white/10 text-xs font-bold"}
                disabled={publishMutation.isPending}
                onClick={() => (next === "SCHEDULED" ? setScheduleOpen(true) : handlePublish(next))}
              >
                <Icon className="h-3.5 w-3.5" /> {meta.label}
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {/* Editor column */}
        <div className="min-w-0 space-y-4">
          {/* Settings & SEO */}
          <div className="rounded-2xl border border-white/10 bg-secondary/20">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3"
            >
              <span className="flex items-center gap-2 text-xs font-bold text-white">
                <Settings2 className="h-4 w-4 text-primary" /> Page Settings & SEO
              </span>
              {showSettings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
            {showSettings ? (
              <div className="space-y-3 border-t border-white/10 p-4">
                <div className="space-y-1.5">
                  <label htmlFor="meta-title" className="text-xs font-bold text-muted-foreground">Title *</label>
                  <Input id="meta-title" value={draft.title} onChange={(e) => patchMeta({ title: e.target.value })} className="bg-slate-950/40 border-white/10 text-xs font-semibold text-white" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="meta-slug" className="text-xs font-bold text-muted-foreground">Slug *</label>
                  <Input id="meta-slug" value={draft.slug} onChange={(e) => patchMeta({ slug: e.target.value })} className="bg-slate-950/40 border-white/10 text-xs font-mono text-primary font-bold" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="meta-description" className="text-xs font-bold text-muted-foreground">Description</label>
                  <Textarea id="meta-description" rows={2} value={draft.description ?? ""} onChange={(e) => patchMeta({ description: e.target.value || null })} className="bg-slate-950/40 border-white/10 text-xs font-medium text-white" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="meta-seo-title" className="text-xs font-bold text-muted-foreground">SEO Meta Title</label>
                  <Input id="meta-seo-title" value={draft.seoTitle ?? ""} onChange={(e) => patchMeta({ seoTitle: e.target.value || null })} className="bg-slate-950/40 border-white/10 text-xs font-semibold text-white" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="meta-seo-desc" className="text-xs font-bold text-muted-foreground">SEO Meta Description</label>
                  <Textarea id="meta-seo-desc" rows={2} value={draft.seoDesc ?? ""} onChange={(e) => patchMeta({ seoDesc: e.target.value || null })} className="bg-slate-950/40 border-white/10 text-xs font-medium text-white" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="meta-seo-keywords" className="text-xs font-bold text-muted-foreground">SEO Keywords (comma separated)</label>
                  <Input
                    id="meta-seo-keywords"
                    value={draft.seoKeywords.join(", ")}
                    onChange={(e) =>
                      patchMeta({
                        seoKeywords: e.target.value.split(",").map((k) => k.trim()).filter(Boolean),
                      })
                    }
                    className="bg-slate-950/40 border-white/10 text-xs font-semibold text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="meta-og-image" className="text-xs font-bold text-muted-foreground">Open Graph Image URL</label>
                  <Input id="meta-og-image" value={draft.ogImage ?? ""} onChange={(e) => patchMeta({ ogImage: e.target.value || null })} className="bg-slate-950/40 border-white/10 text-xs font-semibold text-white" />
                </div>
              </div>
            ) : null}
          </div>

          {/* Sections */}
          <div className="space-y-4">
            {[...draft.sections]
              .sort((a, b) => a.order - b.order)
              .map((section, index) => (
                <SectionEditor
                  key={section.id}
                  section={section}
                  blockTypes={blockTypes}
                  canMoveUp={index > 0}
                  canMoveDown={index < draft.sections.length - 1}
                  onRename={(name) => updateSectionLocal(section.id, { name })}
                  onVisibilityToggle={() => toggleSectionVisibility(section.id)}
                  onMoveUp={() => moveSection(section.id, -1)}
                  onMoveDown={() => moveSection(section.id, 1)}
                  onDelete={() => deleteSection(section.id)}
                  onAddBlock={(bt) => addBlock(section.id, bt)}
                  onBlockPropsChange={(bid, props) => updateBlockLocal(section.id, bid, { props })}
                  onBlockVisibilityToggle={(bid) => toggleBlockVisibility(section.id, bid)}
                  onBlockMoveUp={(bid) => moveBlock(section.id, bid, -1)}
                  onBlockMoveDown={(bid) => moveBlock(section.id, bid, 1)}
                  onBlockDelete={(bid) => deleteBlock(section.id, bid)}
                />
              ))}

            {draft.sections.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-white/10 py-12 text-center">
                <p className="text-sm font-bold text-white">No sections yet</p>
                <p className="mt-1 text-xs text-muted-foreground">Add a section to start building the page.</p>
              </div>
            ) : null}

            <Button type="button" variant="outline" className="w-full border-white/10 text-xs font-bold" onClick={addSection}>
              <Plus className="h-3.5 w-3.5" /> Add Section
            </Button>
          </div>
        </div>

        {/* Preview column */}
        <div className="rounded-2xl border border-white/10 bg-secondary/20 p-4 lg:sticky lg:top-20 lg:self-start">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-bold text-white">Public Render</p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-muted-foreground">Draft changes reflected live</span>
              <Switch checked={showPreview} onCheckedChange={setShowPreview} aria-label="Toggle preview" />
            </div>
          </div>
          {showPreview ? (
            <div className="rounded-xl border border-white/10 bg-white p-6 text-slate-900">
              <PublicPageRenderer page={draft} />
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-white/10 py-10 text-center text-xs text-muted-foreground">
              Toggle the switch to preview the current draft.
            </p>
          )}
        </div>
      </div>

      {/* Schedule dialog */}
      <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
        <DialogContent className="border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-white">Schedule Publish</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-muted-foreground">Publish at (local time)</label>
            <Input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" className="border-white/10 text-xs font-bold" onClick={() => setScheduleOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-primary text-xs font-bold text-white"
              disabled={!scheduleAt || publishMutation.isPending}
              onClick={() => {
                handlePublish("SCHEDULED", new Date(scheduleAt).toISOString());
                setScheduleOpen(false);
              }}
            >
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Separator />

      <p className="text-[11px] text-muted-foreground">
        Edits are staged locally and only persisted when you click{" "}
        <span className="font-bold text-white">Save Changes</span>. Unpublished changes are never
        served to the public site.
      </p>

      <VersionHistory
        pageId={pageId}
        open={versionsOpen}
        onOpenChange={setVersionsOpen}
        onRolledBack={() => {
          commitOps([]);
          createdTempsRef.current.clear();
          setDraft(null);
          refetch();
        }}
      />
    </div>
  );
}
