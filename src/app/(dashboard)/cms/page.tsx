"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { 
  Globe, FileText, ImageIcon, Megaphone,
  Search, Plus, Eye, Edit2, Loader2, AlertCircle,
  MoreHorizontal, Archive, CalendarClock, Clock, Menu
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/components/ui/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { NavMenuEditor } from "@/components/cms/nav-menu-editor";

const PAGE_TRANSITIONS: Record<string, PageModel["status"][]> = {
  DRAFT: ["PUBLISHED", "SCHEDULED", "ARCHIVED"],
  SCHEDULED: ["DRAFT", "PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

const TRANSITION_META: Record<PageModel["status"], { label: string; icon: typeof Globe }> = {
  PUBLISHED: { label: "Publish", icon: Globe },
  SCHEDULED: { label: "Schedule", icon: CalendarClock },
  DRAFT: { label: "Unpublish (to Draft)", icon: Clock },
  ARCHIVED: { label: "Archive", icon: Archive },
};

interface PageModel {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  status: "DRAFT" | "PUBLISHED" | "SCHEDULED" | "ARCHIVED";
  seoTitle: string | null;
  seoDesc: string | null;
  createdAt: string;
  updatedAt: string;
  creator?: { name: string };
  publisher?: { name: string };
  version: number;
}

export default function CMSPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [activeTab, setActiveTab] = React.useState("pages");
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [editItem, setEditItem] = React.useState<Partial<PageModel> | null>(null);

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  // Fetch CMS Pages from backend Page API
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["cms-pages", debouncedSearch],
    queryFn: async () => {
      const p = new URLSearchParams({
        page: "1",
        limit: "100",
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      // The API responds with { success, data: PageModel[], meta }. apiFetch() only
      // unwraps `.data` (dropping `.meta`), so this fetches directly for clarity.
      const raw = await fetch(`/api/v1/pages?${p}`, { credentials: "include" });
      if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
      const json = await raw.json() as { data: PageModel[]; meta?: { total: number } };
      return { data: json.data, total: json.meta?.total ?? json.data.length };
    },
    enabled: activeTab === "pages",
  });

  // Mutate: Create Page
  const createMutation = useMutation({
    mutationFn: (body: Partial<PageModel>) => 
      apiFetch<PageModel>("/pages", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({ title: "Page Created Successfully", description: "The new static page has been registered in the CMS." });
      setEditItem(null);
    },
    onError: (err) => {
      toast({ title: "Error Creating Page", description: err.message, variant: "destructive" });
    }
  });

  // Mutate: Update Page
  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<PageModel> }) => 
      apiFetch<PageModel>(`/pages/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({ title: "Page Saved Successfully", description: "CMS contents updated and static generation cache invalidated." });
      setEditItem(null);
    },
    onError: (err) => {
      toast({ title: "Error Saving Page", description: err.message, variant: "destructive" });
    }
  });

  // Mutate: Publish / status transition (explicit publish endpoint)
  const publishMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: PageModel["status"] }) =>
      apiFetch<PageModel>(`/pages/${id}/publish`, { method: "POST", body: JSON.stringify({ status }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cms-pages"] });
      toast({ title: "Status Updated", description: "Page publishing status transitioned successfully." });
      setEditItem(null);
    },
    onError: (err) => {
      toast({ title: "Status Change Failed", description: err.message, variant: "destructive" });
    }
  });

  const handleSaveContent = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const title = formData.get("title") as string;
    const slug = formData.get("slug") as string;
    const description = formData.get("description") as string;
    const seoTitle = formData.get("seoTitle") as string;
    const seoDesc = formData.get("seoDesc") as string;

    // NOTE: `status` is intentionally NOT part of the create/update payload.
    // createPageSchema / updatePageSchema have no `status` field, so zod strips it.
    // Status changes must go through POST /api/v1/pages/{id}/publish (handled by
    // the publishing controls in the dialog + row menu), which enforces transitions.
    const payload = {
      title,
      slug: slug || undefined,
      description: description || null,
      seoTitle: seoTitle || null,
      seoDesc: seoDesc || null,
    };

    if (editItem?.id) {
      updateMutation.mutate({ id: editItem.id, body: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const pagesList = data?.data ?? [];

  return (
    <div className="space-y-8 pb-12">
      <PageHeader 
        title="Website CMS Editor" 
        description="Global command over public landing pages, FAQs, fleet showcase, campus facilities, gallery, and news bulletins." 
        action={
          <div className="flex items-center gap-4">
            <Button onClick={() => setEditItem({ title: "", slug: "", description: "", seoTitle: "", seoDesc: "" })} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all hover:scale-105">
              <Plus className="h-4 w-4 mr-2" />
              Create New Entry
            </Button>
          </div>
        }
      />

      {/* Tabs Navigation */}
      <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-1">
        {[
          { id: "pages", label: "Core Web Pages", icon: Globe },
          { id: "nav", label: "Navigation Menus", icon: Menu },
          { id: "gallery", label: "Public Media Gallery", icon: ImageIcon },
          { id: "news", label: "News & Announcements", icon: Megaphone },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${
                isActive ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" : "text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-white" : "text-muted-foreground"}`} />
              {tab.label}
            </button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "pages" && (
          <motion.div key="pages" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-6">
            <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <Globe className="h-5 w-5 text-primary" /> Global Public Pages Directory
                </h3>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input 
                    placeholder="Search public landing pages..." 
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9 bg-secondary/40 border-white/10 text-xs font-semibold w-64" 
                  />
                </div>
              </div>

              {isLoading && (
                <div className="flex flex-col items-center justify-center py-20 space-y-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-xs text-muted-foreground font-semibold">Loading CMS Pages...</p>
                </div>
              )}

              {isError && (
                <div className="flex flex-col items-center justify-center py-16 text-center space-y-4 rounded-xl border border-rose-500/20 bg-rose-500/10">
                  <AlertCircle className="h-10 w-10 text-rose-400" />
                  <div>
                    <h4 className="text-sm font-bold text-white">Error Loading CMS Pages</h4>
                    <p className="text-xs text-muted-foreground mt-1 font-mono">{error?.message || "Internal Server Error"}</p>
                  </div>
                  <Button onClick={() => refetch()} variant="outline" size="sm" className="border-white/10 text-xs font-bold">
                    Retry Loading
                  </Button>
                </div>
              )}

              {!isLoading && !isError && pagesList.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 text-center space-y-2 border-2 border-dashed border-white/5 rounded-xl">
                  <p className="text-sm font-bold text-white">No CMS Pages Registered</p>
                  <p className="text-xs text-muted-foreground">Click &quot;Create New Entry&quot; to build your first landing page.</p>
                </div>
              )}

              {!isLoading && !isError && pagesList.length > 0 && (
                <div className="space-y-3 pt-2">
                  {pagesList.map((pg) => (
                    <div key={pg.id} className="flex items-center justify-between p-4 rounded-xl bg-secondary/30 border border-white/5 hover:border-white/10 transition-colors">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary border border-primary/30 font-bold text-sm">
                          <FileText className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-white truncate">{pg.title}</p>
                            <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${pg.status === "PUBLISHED" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : pg.status === "SCHEDULED" ? "bg-blue-500/20 text-blue-400 border-blue-500/30" : "bg-amber-500/20 text-amber-400 border-amber-500/30"}`}>
                              {pg.status}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">Route Slug: <span className="font-mono text-white font-medium">/{pg.slug}</span> • Version: v{pg.version} • Updated: {new Date(pg.updatedAt).toLocaleDateString()}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 shrink-0">
                        <Button size="sm" onClick={() => router.push(`/cms/pages/${pg.id}`)} className="bg-primary/20 hover:bg-primary/30 text-white border border-primary/30 text-xs font-bold py-1 px-3 h-8">
                          <Edit2 className="h-3 w-3 mr-1.5" /> Open Editor
                        </Button>
                        <Button size="sm" variant="ghost" className="h-8 w-8 border border-white/10" aria-label="Preview page" onClick={() => router.push(`/cms/pages/${pg.id}/preview`)}>
                          <Eye className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" className="h-8 w-8 border border-white/10" aria-label="Status actions">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {(PAGE_TRANSITIONS[pg.status] ?? []).map((next) => {
                              const meta = TRANSITION_META[next];
                              const Icon = meta.icon;
                              return (
                                <DropdownMenuItem
                                  key={next}
                                  onClick={() => publishMutation.mutate({ id: pg.id, status: next })}
                                  disabled={publishMutation.isPending}
                                  className="cursor-pointer"
                                >
                                  <Icon className="mr-2 h-4 w-4" /> {meta.label}
                                </DropdownMenuItem>
                              );
                            })}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Navigation Menus editor */}
        {activeTab === "nav" && (
          <motion.div key="nav" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }}>
            <NavMenuEditor />
          </motion.div>
        )}

        {/* Public Media Gallery redirection */}
        {activeTab === "gallery" && (
          <motion.div key="gallery" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-6">
            <div className="glass-card rounded-2xl p-6 border border-white/10 text-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/20 text-primary border border-primary/30 mx-auto shadow-xl">
                <ImageIcon className="h-8 w-8" />
              </div>
              <div className="space-y-1 max-w-md mx-auto mt-6">
                <h3 className="text-lg font-bold text-white tracking-tight">Media Gallery Cloud Synchronizer</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">The public gallery is linked to the Media Library microservice. You can upload high-resolution fleet and campus photos directly via the Media module.</p>
              </div>
              <Button asChild className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20 mt-6">
                <a href="/media">Open Media Library →</a>
              </Button>
            </div>
          </motion.div>
        )}

        {/* News tab redirection */}
        {activeTab === "news" && (
          <motion.div key="news" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-6">
            <div className="glass-card rounded-2xl p-6 border border-white/10 text-center py-16">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30 mx-auto shadow-xl">
                <Megaphone className="h-8 w-8" />
              </div>
              <div className="space-y-1 max-w-md mx-auto mt-6">
                <h3 className="text-lg font-bold text-white tracking-tight">News & Public Announcements Bulletin</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">Manage press releases, DGCA exam top ranker announcements, and cadet intake alerts via the unified Blog & Resources microservice.</p>
              </div>
              <Button asChild className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20 mt-6">
                <a href="/blog">Open Blog & Resources Module →</a>
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit/Create Content Modal */}
      <Dialog open={!!editItem} onOpenChange={(o) => !o && setEditItem(null)}>
        <DialogContent className="max-w-xl glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <Edit2 className="h-5 w-5 text-primary" />
              {editItem?.id ? "Edit CMS Static Page" : "Create New CMS Page"}
            </DialogTitle>
          </DialogHeader>
          {editItem && (
            <form onSubmit={handleSaveContent} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Content Display Title *</label>
                <Input name="title" defaultValue={editItem.title || ""} required className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Public URL Slug * (e.g. &quot;about-us&quot;)</label>
                <Input name="slug" defaultValue={editItem.slug || ""} required className="bg-secondary/40 border-white/10 text-xs font-mono text-primary font-bold" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Page Description</label>
                <Textarea name="description" defaultValue={editItem.description || ""} rows={3} className="bg-secondary/40 border-white/10 text-xs font-medium text-white leading-relaxed" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">SEO Meta Title tag</label>
                <Input name="seoTitle" defaultValue={editItem.seoTitle || ""} className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">SEO Meta Description tag</label>
                <Textarea name="seoDesc" defaultValue={editItem.seoDesc || ""} rows={2} className="bg-secondary/40 border-white/10 text-xs font-medium text-white leading-relaxed" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Publishing Status</label>
                {editItem.id ? (
                  <>
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-secondary/40 px-3 py-2">
                      <span className="text-xs font-bold text-white">Current: <span className="text-primary">{editItem.status}</span></span>
                    </div>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {(PAGE_TRANSITIONS[editItem.status as PageModel["status"]] ?? []).map((next) => {
                        const meta = TRANSITION_META[next];
                        const Icon = meta.icon;
                        return (
                          <button
                            key={next}
                            type="button"
                            disabled={publishMutation.isPending}
                            onClick={() => publishMutation.mutate({ id: editItem.id!, status: next })}
                            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-secondary/60 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary/20 hover:border-primary/40 disabled:opacity-50"
                          >
                            <Icon className="h-3.5 w-3.5" /> {meta.label}
                          </button>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Publishing is applied immediately via the publish endpoint and enforces valid transitions (e.g. ARCHIVED pages can only return to DRAFT).
                    </p>
                  </>
                ) : (
                  <div className="rounded-lg border border-white/10 bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
                    New pages are created as <span className="font-bold text-amber-400">DRAFT</span>. Use the status menu after creating to publish or archive.
                  </div>
                )}
              </div>
              <DialogFooter className="pt-4 border-t border-white/10">
                <Button type="button" variant="outline" onClick={() => setEditItem(null)} className="border-white/10 hover:bg-white/5 text-xs font-bold">Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
                  {createMutation.isPending || updateMutation.isPending ? "Saving..." : "Save Page"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
