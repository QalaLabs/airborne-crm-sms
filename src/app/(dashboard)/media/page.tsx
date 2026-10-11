"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search, FolderOpen, Image as ImageIcon, FileText, Film, File, Music,
  ChevronRight, Home, Grid3X3, List, Copy, ExternalLink,
  Upload, FolderPlus, Pencil, RefreshCw
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetch, isStorageUnavailable } from "@/lib/api";
import { formatDate, cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";

interface MediaAsset {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  fileUrl: string;
  folderId?: string;
  folder?: { name: string };
  width?: number;
  height?: number;
  createdAt: string;
}

interface MediaFolder {
  id: string;
  name: string;
  slug: string;
  path: string;
  parentId?: string;
  assetCount?: number;
}

function getFileIcon(mimeType: string) {
  if (mimeType.startsWith("image/")) return ImageIcon;
  if (mimeType.startsWith("video/")) return Film;
  if (mimeType.startsWith("audio/")) return Music;
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text")) return FileText;
  return File;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function MediaPage() {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [selectedFolder, setSelectedFolder] = React.useState<string | null>(null);
  const [folderPath, setFolderPath] = React.useState<{ id: string; name: string }[]>([]);
  const [viewMode, setViewMode] = React.useState<"grid" | "list">("grid");
  const [selectedAsset, setSelectedAsset] = React.useState<MediaAsset | null>(null);
  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  const [newFolderName, setNewFolderName] = React.useState("");
  const [editDialogOpen, setEditDialogOpen] = React.useState(false);
  const [editName, setEditName] = React.useState("");
  const [editFolderId, setEditFolderId] = React.useState<string>("");
  const replaceInputRef = React.useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(t);
  }, [search]);

  const { data: folders } = useQuery({
    queryKey: ["media-folders", selectedFolder],
    queryFn: () => apiFetch<MediaFolder[]>(`/media/folders${selectedFolder ? `?parentId=${selectedFolder}` : ""}`),
  });

  const { data: allFolders } = useQuery({
    queryKey: ["media-folders-all"],
    queryFn: () => apiFetch<MediaFolder[]>("/media/folders"),
  });

  const { data: assets, isLoading: assetsLoading, refetch } = useQuery({
    queryKey: ["media", selectedFolder, debouncedSearch],
    queryFn: async () => {
      const p = new URLSearchParams({
        page: "1",
        limit: "60",
        ...(selectedFolder ? { folderId: selectedFolder } : {}),
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      // The API responds with { success, data: MediaAsset[], meta }. apiFetch()
      // only unwraps `.data` (dropping `.meta`), so this fetches directly.
      const raw = await fetch(`/api/v1/media?${p}`, { credentials: "include" });
      if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
      const json = await raw.json() as { data: MediaAsset[]; meta?: { total: number } };
      return { items: json.data, total: json.meta?.total ?? json.data.length };
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/media/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast({ title: "Asset Deleted", description: "Media record successfully deleted from library." });
      refetch();
      setSelectedAsset(null);
    },
    onError: (err: unknown) => {
      toast({ title: "Delete Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      apiFetch<MediaFolder>("/media/folders", {
        method: "POST",
        body: JSON.stringify({ name, ...(selectedFolder ? { parentId: selectedFolder } : {}) }),
      }),
    onSuccess: () => {
      toast({ title: "Folder Created", description: "New media folder created successfully." });
      setFolderDialogOpen(false);
      setNewFolderName("");
      void queryClient.invalidateQueries({ queryKey: ["media-folders"] });
      void queryClient.invalidateQueries({ queryKey: ["media-folders-all"] });
    },
    onError: (err: unknown) => {
      toast({ title: "Create Folder Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const updateAssetMutation = useMutation({
    mutationFn: ({ id, name, folderId }: { id: string; name: string; folderId?: string | null }) =>
      apiFetch<MediaAsset>(`/media/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, ...(folderId !== undefined ? { folderId } : {}) }),
      }),
    onSuccess: (updated) => {
      toast({ title: "Asset Updated", description: `"${updated.name}" updated successfully.` });
      setEditDialogOpen(false);
      setSelectedAsset(updated);
      refetch();
    },
    onError: (err: unknown) => {
      toast({ title: "Update Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const replaceMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { fileKey: string; fileUrl: string; mimeType: string; sizeBytes: number } }) =>
      apiFetch<MediaAsset>(`/media/${id}/replace`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (updated) => {
      toast({ title: "File Replaced", description: `"${updated.name}" replaced with the new version.` });
      setSelectedAsset(updated);
      refetch();
    },
    onError: (err: unknown) => {
      toast({ title: "Replace Failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    },
  });

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      toast({ title: "Uploading File", description: `Sending "${file.name}" (${(file.size / 1024 / 1024).toFixed(1)}MB)...` });

      const form = new FormData();
      form.append("file", file);
      form.append("name", file.name);
      if (selectedFolder) form.append("folderId", selectedFolder);

      const asset = await apiFetch<MediaAsset>("/media", { method: "POST", body: form });

      toast({ title: "Upload Successful", description: `File "${asset.name}" has been successfully added.` });
      refetch();
    } catch (err: unknown) {
      const description = isStorageUnavailable(err)
        ? "Media storage is not configured"
        : err instanceof Error
          ? err.message
          : String(err);
      toast({ title: "Upload Failed", description, variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  };

  const navigateToFolder = (folder: MediaFolder) => {
    setFolderPath((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSelectedFolder(folder.id);
  };

  const navigateUp = (index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    setSelectedFolder(newPath.length > 0 ? (newPath[newPath.length - 1]?.id ?? null) : null);
  };

  const navigateToRoot = () => {
    setFolderPath([]);
    setSelectedFolder(null);
  };

  const handleCopyUrl = (url: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(url);
    toast({ title: "URL Copied", description: "Public media URL copied to clipboard." });
  };

  const openEditDialog = (asset: MediaAsset) => {
    setEditName(asset.name);
    setEditFolderId(asset.folderId ?? "");
    setSelectedAsset(asset);
    setEditDialogOpen(true);
  };

  const onReplaceFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedAsset) return;

    try {
      toast({ title: "Uploading Replacement", description: `Sending "${file.name}" to storage...` });

      const { uploadUrl, fileKey, fileUrl } = await apiFetch<{ uploadUrl: string; fileKey: string; fileUrl: string }>("/media/presign", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type }),
      });

      const uploadRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!uploadRes.ok) throw new Error("Storage upload failed");

      replaceMutation.mutate({
        id: selectedAsset.id,
        input: { fileKey, fileUrl, mimeType: file.type, sizeBytes: file.size },
      });
    } catch (err: unknown) {
      const description = isStorageUnavailable(err)
        ? "Media storage is not configured"
        : err instanceof Error
          ? err.message
          : String(err);
      toast({ title: "Replace Failed", description, variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  };

  const currentFolders = folders ?? [];
  const mediaAssets = assets?.items ?? [];

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Media Library & CDN Storage"
        description="Unified digital asset grid of high-res academy photography and cinematic video footage with lightning-fast CDN URL sharing."
        action={
          <div className="flex items-center gap-3">
            <Button
              onClick={handleUploadClick}
              className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all hover:scale-105 text-xs font-bold"
            >
              <Upload className="h-4 w-4 mr-1.5" />
              Upload High-Res Media
            </Button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={onFileChange}
              style={{ display: "none" }}
            />
          </div>
        }
      />

      {/* Control Bar: Search & View Mode */}
      <div className="glass-card rounded-2xl p-5 border border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-xs font-bold bg-secondary/40 px-3 py-2 rounded-xl border border-white/5">
          <button
            onClick={navigateToRoot}
            className={cn(
              "flex items-center gap-1 text-muted-foreground hover:text-white transition-colors",
              folderPath.length === 0 && "text-primary font-bold",
            )}
          >
            <Home className="h-3.5 w-3.5" />
            Media Root
          </button>
          {folderPath.map((item, i) => (
            <React.Fragment key={item.id}>
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
              <button
                onClick={() => navigateUp(i)}
                className={cn(
                  "text-muted-foreground hover:text-white transition-colors",
                  i === folderPath.length - 1 && "text-primary font-bold",
                )}
              >
                {item.name}
              </button>
            </React.Fragment>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setNewFolderName(""); setFolderDialogOpen(true); }}
            className="border-white/10 text-xs font-bold text-white hover:bg-white/5"
          >
            <FolderPlus className="h-3.5 w-3.5 mr-1.5" />
            New Folder
          </Button>
          <div className="relative w-64">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search assets by filename..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-secondary/40 border-white/10 focus:border-primary text-xs font-semibold text-white"
            />
          </div>
          <div className="flex items-center border border-white/10 rounded-xl p-1 bg-secondary/20">
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 rounded-lg", viewMode === "grid" && "bg-primary text-white shadow-md")}
              onClick={() => setViewMode("grid")}
            >
              <Grid3X3 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8 rounded-lg", viewMode === "list" && "bg-primary text-white shadow-md")}
              onClick={() => setViewMode("list")}
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Folders */}
      {currentFolders.length > 0 && (
        <div>
          <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 px-1">Directory Folders</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            {currentFolders.map((folder) => (
              <button
                key={folder.id}
                onClick={() => navigateToFolder(folder as unknown as MediaFolder)}
                className="flex items-center justify-between rounded-2xl border border-white/10 bg-secondary/20 p-5 hover:bg-secondary/40 hover:border-white/20 transition-all group shadow-xl"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 group-hover:scale-110 transition-transform">
                    <FolderOpen className="h-6 w-6" />
                  </div>
                  <div className="min-w-0 text-left">
                    <p className="text-sm font-bold text-white truncate group-hover:text-primary transition-colors">{folder.name}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">/{folder.slug}</p>
                  </div>
                </div>
                {folder.assetCount != null && (
                  <span className="text-xs font-extrabold bg-white/10 text-white px-2.5 py-1 rounded-full shrink-0">
                    {folder.assetCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Assets Grid */}
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3 px-1">Digital Media Assets</p>

        {assetsLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="aspect-video rounded-2xl" />
            ))}
          </div>
        ) : mediaAssets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center glass-card rounded-2xl border border-white/10">
            <File className="h-12 w-12 text-muted-foreground/40 mb-3" />
            <p className="text-sm font-bold text-white">No media files found in this directory</p>
            <p className="text-xs text-muted-foreground mt-1">Upload high-res photos or videos to start managing CDN assets.</p>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {mediaAssets.map((asset) => {
              const Icon = getFileIcon(asset.mimeType);
              const isVideo = asset.mimeType.startsWith("video/");
              return (
                <div
                  key={asset.id}
                  onClick={() => setSelectedAsset(asset)}
                  className="group relative rounded-2xl border border-white/10 bg-slate-900 overflow-hidden cursor-pointer hover:border-white/20 transition-all shadow-2xl flex flex-col"
                >
                  <div className="aspect-video w-full flex items-center justify-center bg-slate-950 relative overflow-hidden">
                    {asset.mimeType.startsWith("image/") ? (
                      <img
                        src={asset.fileUrl}
                        alt={asset.name}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <Icon className="h-10 w-10 text-muted-foreground/60" />
                    )}
                    {isVideo && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/40 group-hover:bg-black/20 transition-colors">
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30">
                          <Film className="h-5 w-5 ml-0.5" />
                        </div>
                      </div>
                    )}
                    <span className="absolute top-3 left-3 text-[10px] font-extrabold bg-slate-900/80 backdrop-blur-md text-white border border-white/10 px-2.5 py-1 rounded-full">
                      {asset.mimeType.split("/")[1]?.toUpperCase()}
                    </span>
                    <button
                      onClick={(e) => handleCopyUrl(asset.fileUrl, e)}
                      className="absolute top-3 right-3 flex h-8 w-8 items-center justify-center rounded-full bg-slate-900/80 backdrop-blur-md text-white border border-white/10 hover:bg-primary hover:text-white transition-colors shadow-lg opacity-0 group-hover:opacity-100"
                      title="Copy CDN URL"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="p-4 border-t border-white/10 bg-slate-900/90 flex flex-col justify-between flex-1">
                    <p className="text-xs font-bold text-white truncate group-hover:text-primary transition-colors">{asset.name}</p>
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground mt-2 pt-2 border-t border-white/5 font-medium">
                      <span>{formatFileSize(asset.sizeBytes)}</span>
                      <span>{formatDate(asset.createdAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-2xl border border-white/10 overflow-hidden glass-panel shadow-2xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 bg-slate-900/80">
                  <th className="text-left px-6 py-4 text-xs font-bold text-white uppercase tracking-wider">Asset Name</th>
                  <th className="text-left px-6 py-4 text-xs font-bold text-white uppercase tracking-wider">MIME Type</th>
                  <th className="text-left px-6 py-4 text-xs font-bold text-white uppercase tracking-wider">Storage Size</th>
                  <th className="text-left px-6 py-4 text-xs font-bold text-white uppercase tracking-wider">Upload Timestamp</th>
                  <th className="w-24 px-6 py-4 text-right text-xs font-bold text-white uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 bg-secondary/20">
                {mediaAssets.map((asset) => {
                  const Icon = getFileIcon(asset.mimeType);
                  return (
                    <tr key={asset.id} onClick={() => setSelectedAsset(asset)} className="hover:bg-white/5 transition-colors cursor-pointer group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-800 border border-white/10 text-primary shrink-0">
                            <Icon className="h-5 w-5" />
                          </div>
                          <span className="font-bold text-white group-hover:text-primary transition-colors text-xs">{asset.name}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-xs text-muted-foreground font-mono">{asset.mimeType}</td>
                      <td className="px-6 py-4 text-xs text-muted-foreground font-semibold">{formatFileSize(asset.sizeBytes)}</td>
                      <td className="px-6 py-4 text-xs text-muted-foreground">{formatDate(asset.createdAt)}</td>
                      <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" onClick={(e) => handleCopyUrl(asset.fileUrl, e)} className="text-xs font-bold text-primary hover:bg-white/10">
                          <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy URL
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Asset Preview Dialog */}
      <Dialog open={!!selectedAsset} onOpenChange={(o) => !o && setSelectedAsset(null)}>
        <DialogContent className="max-w-4xl glass-panel border-white/10 bg-slate-900/95 p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b border-white/10 bg-slate-900/80">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-xl font-bold text-white truncate">{selectedAsset?.name}</DialogTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  MIME: <span className="font-mono text-primary font-bold">{selectedAsset?.mimeType}</span> • File Size: <span className="text-white font-semibold">{selectedAsset ? formatFileSize(selectedAsset.sizeBytes) : "0 B"}</span>
                </p>
              </div>
              <Button size="sm" onClick={(e) => selectedAsset && handleCopyUrl(selectedAsset.fileUrl, e)} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold">
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy CDN URL
              </Button>
            </div>
          </DialogHeader>

          {selectedAsset && (
            <div className="p-6 flex flex-col items-center justify-center bg-slate-950 min-h-[360px]">
              {selectedAsset.mimeType.startsWith("image/") ? (
                <img src={selectedAsset.fileUrl} alt={selectedAsset.name} className="w-full rounded-xl object-contain max-h-[500px] border border-white/10 shadow-2xl" />
              ) : selectedAsset.mimeType.startsWith("video/") ? (
                <video src={selectedAsset.fileUrl} controls className="w-full rounded-xl max-h-[500px] border border-white/10 shadow-2xl" />
              ) : (
                <div className="text-center py-16">
                  <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                  <p className="text-sm font-bold text-white">No rich preview available for this document type</p>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="p-6 border-t border-white/10 bg-slate-900/80">
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (selectedAsset && confirm("Are you sure you want to delete this media asset?")) {
                  deleteMutation.mutate(selectedAsset.id);
                }
              }}
              className="text-xs font-bold mr-auto bg-rose-600 hover:bg-rose-700 text-white"
            >
              Delete Asset
            </Button>
            <input
              type="file"
              ref={replaceInputRef}
              onChange={onReplaceFile}
              style={{ display: "none" }}
            />
            <Button
              variant="outline"
              disabled={replaceMutation.isPending}
              onClick={() => replaceInputRef.current?.click()}
              className="border-white/10 hover:bg-white/5 text-xs font-bold"
              title="Replace the underlying file with a new version"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${replaceMutation.isPending ? "animate-spin" : ""}`} />
              {replaceMutation.isPending ? "Replacing…" : "Replace File"}
            </Button>
            <Button
              variant="outline"
              onClick={() => selectedAsset && openEditDialog(selectedAsset)}
              className="border-white/10 hover:bg-white/5 text-xs font-bold"
              title="Rename or move this asset"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit Details
            </Button>
            <Button variant="outline" onClick={() => setSelectedAsset(null)} className="border-white/10 hover:bg-white/5 text-xs font-bold">
              Close Preview
            </Button>
            <Button asChild className="bg-secondary text-white hover:bg-secondary/80 text-xs font-bold">
              <a href={selectedAsset?.fileUrl} target="_blank" rel="noreferrer">
                Open Original Asset <ExternalLink className="h-3.5 w-3.5 ml-1.5" />
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Folder Dialog */}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="max-w-md glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Create New Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold text-muted-foreground mb-2">Folder Name</p>
              <Input
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g. Academy Photos 2025"
                className="bg-secondary/40 border-white/10 focus:border-primary text-xs font-semibold text-white"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newFolderName.trim() && !createFolderMutation.isPending) {
                    createFolderMutation.mutate(newFolderName.trim());
                  }
                }}
              />
              {selectedFolder && (
                <p className="text-[11px] text-muted-foreground mt-2">
                  Will be created inside: <span className="text-primary font-semibold">{folderPath[folderPath.length - 1]?.name ?? "Current Folder"}</span>
                </p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderDialogOpen(false)} className="border-white/10 hover:bg-white/5 text-xs font-bold">
              Cancel
            </Button>
            <Button
              disabled={!newFolderName.trim() || createFolderMutation.isPending}
              onClick={() => createFolderMutation.mutate(newFolderName.trim())}
              className="bg-primary hover:bg-primary/90 text-white text-xs font-bold"
            >
              {createFolderMutation.isPending ? "Creating…" : "Create Folder"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Asset Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-md glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Edit Media Asset</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-bold text-muted-foreground mb-2">Asset Name</p>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Asset name"
                className="bg-secondary/40 border-white/10 focus:border-primary text-xs font-semibold text-white"
              />
            </div>
            <div>
              <p className="text-xs font-bold text-muted-foreground mb-2">Move To Folder</p>
              <select
                value={editFolderId}
                onChange={(e) => setEditFolderId(e.target.value)}
                className="h-9 w-full rounded-md border border-border bg-secondary/40 px-3 text-xs font-semibold text-white focus:outline-none"
              >
                <option value="">Media Root</option>
                {(allFolders ?? [])
                  .filter((f) => f.id !== selectedAsset?.id)
                  .map((folder) => (
                    <option key={folder.id} value={folder.id}>/{folder.path}</option>
                  ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-2">Choose a new location or leave at Media Root.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)} className="border-white/10 hover:bg-white/5 text-xs font-bold">
              Cancel
            </Button>
            <Button
              disabled={!editName.trim() || updateAssetMutation.isPending}
              onClick={() => updateAssetMutation.mutate({ id: selectedAsset!.id, name: editName.trim(), folderId: editFolderId || null })}
              className="bg-primary hover:bg-primary/90 text-white text-xs font-bold"
            >
              {updateAssetMutation.isPending ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
