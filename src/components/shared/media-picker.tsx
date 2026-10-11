"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ImageIcon, Search, X, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface MediaAsset {
  id: string;
  name: string;
  originalName?: string;
  mimeType: string;
  sizeBytes?: number;
  fileUrl: string;
  usageCount?: number;
}

interface MediaPickerProps {
  value?: string | null;
  onChange: (assetId: string | null) => void;
  label?: string;
}

/** Lightweight media-library picker used by CMS forms that reference a MediaAsset FK. */
export function MediaPicker({ value, onChange, label = "Media" }: MediaPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const { data: selected } = useQuery({
    queryKey: ["media-picker-selected", value],
    queryFn: () => apiFetch<MediaAsset>(`/media/${value}`),
    enabled: !!value,
  });

  const { data: assets, isLoading, isError, refetch } = useQuery({
    queryKey: ["media-picker", debouncedSearch],
    queryFn: () => {
      const p = new URLSearchParams({
        page: "1",
        limit: "40",
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
      });
      return apiFetch<MediaAsset[]>(`/media?${p}`);
    },
    enabled: open,
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {selected ? (
          <div className="flex flex-1 items-center gap-3 rounded-lg border border-white/10 bg-secondary/40 px-3 py-2">
            {selected.mimeType.startsWith("image/") ? (
              <img
                src={selected.fileUrl}
                alt={selected.name}
                className="h-9 w-9 shrink-0 rounded-md object-cover border border-white/10"
              />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/20 text-primary border border-primary/30">
                <ImageIcon className="h-4 w-4" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-white">{selected.name}</p>
              <p className="truncate text-[11px] text-muted-foreground">{selected.mimeType}</p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => onChange(null)}
              title="Clear selection"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-white/10 text-xs font-semibold"
            onClick={() => setOpen(true)}
          >
            <ImageIcon className="h-3.5 w-3.5 mr-1.5" />
            Select {label}
          </Button>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-base font-bold text-white">Select {label} from Media Library</DialogTitle>
          </DialogHeader>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search media..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-secondary/40 border-white/10 text-xs"
            />
          </div>

          <div className="max-h-[50vh] overflow-y-auto pt-2">
            {isLoading && (
              <div className="flex flex-col items-center justify-center py-12 space-y-2">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <p className="text-xs text-muted-foreground">Loading media...</p>
              </div>
            )}

            {isError && (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-3">
                <AlertCircle className="h-8 w-8 text-rose-400" />
                <p className="text-xs text-muted-foreground">Failed to load media library.</p>
                <Button variant="outline" size="sm" className="border-white/10 text-xs font-bold" onClick={() => refetch()}>
                  Retry
                </Button>
              </div>
            )}

            {!isLoading && !isError && (assets?.length ?? 0) === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center space-y-1">
                <p className="text-sm font-bold text-white">No media found</p>
                <p className="text-xs text-muted-foreground">Upload files in the Media Library first.</p>
              </div>
            )}

            {!isLoading && !isError && (assets?.length ?? 0) > 0 && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {assets?.map((asset) => {
                  const isSelected = asset.id === value;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      onClick={() => {
                        onChange(asset.id);
                        setOpen(false);
                      }}
                      className={cn(
                        "group relative overflow-hidden rounded-xl border text-left transition-all",
                        isSelected
                          ? "border-primary bg-primary/10 ring-1 ring-primary"
                          : "border-white/10 bg-secondary/30 hover:border-white/25",
                      )}
                    >
                      <div className="flex aspect-video w-full items-center justify-center bg-slate-950/60">
                        {asset.mimeType.startsWith("image/") ? (
                          <img
                            src={asset.fileUrl}
                            alt={asset.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-muted-foreground">
                            <ImageIcon className="h-6 w-6" />
                            <span className="text-[10px] font-semibold uppercase">{asset.mimeType.split("/")[1] ?? "file"}</span>
                          </div>
                        )}
                        {isSelected && (
                          <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-white">
                            <Check className="h-3 w-3" />
                          </span>
                        )}
                      </div>
                      <div className="p-2">
                        <p className="truncate text-[11px] font-semibold text-white">{asset.name}</p>
                        <Badge variant="outline" className="mt-0.5 text-[9px] text-muted-foreground">
                          {asset.usageCount ?? 0} use{(asset.usageCount ?? 0) === 1 ? "" : "s"}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
