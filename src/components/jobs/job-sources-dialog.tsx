"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, KeyRound, RefreshCw, Trash2, Copy, Info } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import { formatInIST } from "@/lib/time/ist";

interface SourcesResponse {
  providers: { id: string; name: string; description: string }[];
  liveProviderConfigured: boolean;
  message: string;
  pushEndpoint: string;
}

interface IngestReport {
  source: string;
  received: number;
  created: { id: string; slug: string; title: string; externalId: string }[];
  duplicates: { index: number; externalId: string; reason: string }[];
  invalid: { index: number; externalId?: string; message: string }[];
}

interface FeedKey {
  id: string;
  name: string;
  keyPreview: string;
  status: "active" | "expired" | "revoked";
  expiresAt: string | null;
  lastUsedAt: string | null;
  key?: string;
}

const VALIDITY = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "60", label: "60 days" },
  { value: "never", label: "Never expires" },
];

const PUSH_EXAMPLE = `{
  "source": "my-scraper",
  "jobs": [
    {
      "externalId": "abc-123",
      "title": "First Officer A320",
      "company": "IndiGo",
      "location": "Delhi",
      "employmentType": "full_time",
      "applyUrl": "https://example.com/apply/abc-123",
      "closesAt": "2026-12-31"
    }
  ]
}`;

export function JobSourcesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [lastRun, setLastRun] = React.useState<IngestReport | null>(null);
  const [keyName, setKeyName] = React.useState("");
  const [validity, setValidity] = React.useState("30");
  const [newKey, setNewKey] = React.useState<string | null>(null);

  const sources = useQuery({
    queryKey: ["job-sources"],
    queryFn: () => apiFetch<SourcesResponse>("/jobs/sources"),
    enabled: open,
  });
  const keys = useQuery({
    queryKey: ["job-feed-keys"],
    queryFn: () => apiFetch<FeedKey[]>("/jobs/feed-keys"),
    enabled: open,
  });

  const sync = useMutation({
    mutationFn: (providerId: string) =>
      apiFetch<IngestReport>("/jobs/sources/sync", { method: "POST", body: JSON.stringify({ providerId }) }),
    onSuccess: (report) => {
      setLastRun(report);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast({ title: "Sync finished", description: `${report.created.length} new draft jobs, ${report.duplicates.length} already present.` });
    },
    onError: (err) => toast({ title: "Sync failed", description: err.message, variant: "destructive" }),
  });

  const createKey = useMutation({
    mutationFn: () => apiFetch<FeedKey>("/jobs/feed-keys", { method: "POST", body: JSON.stringify({ name: keyName, validity }) }),
    onSuccess: (key) => {
      setNewKey(key.key ?? null);
      setKeyName("");
      queryClient.invalidateQueries({ queryKey: ["job-feed-keys"] });
    },
    onError: (err) => toast({ title: "Could not create key", description: err.message, variant: "destructive" }),
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => apiFetch(`/jobs/feed-keys/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["job-feed-keys"] }),
    onError: (err) => toast({ title: "Could not revoke key", description: err.message, variant: "destructive" }),
  });

  const endpoint = typeof window !== "undefined" && sources.data ? `${window.location.origin}${sources.data.pushEndpoint}` : "";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setLastRun(null);
          setNewKey(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto glass-panel border-white/10 bg-slate-900/95">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
            <CloudDownload className="h-5 w-5 text-primary" /> External Job Sources
          </DialogTitle>
          <DialogDescription className="text-xs">
            Jobs from feeds and scrapers are validated with the same rules as Create Job, de-duplicated by their external id,
            and created as Drafts for review. Nothing is published automatically.
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2" data-testid="job-sources-providers">
          <h3 className="text-sm font-bold text-white">Pull providers</h3>
          {!sources.data?.liveProviderConfigured && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <Info className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-200" data-testid="job-sources-config-required">{sources.data?.message ?? "Loading…"}</p>
            </div>
          )}
          {sources.data?.providers.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-secondary/30 p-3">
              <div>
                <p className="text-xs font-bold text-white">{p.name}</p>
                <p className="text-[11px] text-muted-foreground">{p.description}</p>
              </div>
              <Button size="sm" onClick={() => sync.mutate(p.id)} disabled={sync.isPending} className="text-xs font-bold shrink-0">
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${sync.isPending ? "animate-spin" : ""}`} /> Sync now
              </Button>
            </div>
          ))}
          {lastRun && (
            <div className="rounded-lg border border-white/10 p-3 text-[11px] text-muted-foreground space-y-1" data-testid="job-sources-report">
              <p className="text-xs font-bold text-white">
                Last run ({lastRun.source}): {lastRun.received} received · {lastRun.created.length} created · {lastRun.duplicates.length} duplicates · {lastRun.invalid.length} invalid
              </p>
              {lastRun.invalid.map((i) => (
                <p key={`inv-${i.index}`} className="font-mono text-rose-300">#{i.index + 1}{i.externalId ? ` (${i.externalId})` : ""}: {i.message}</p>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2 pt-2">
          <h3 className="text-sm font-bold text-white flex items-center gap-2"><KeyRound className="h-4 w-4 text-primary" /> Push API for scrapers</h3>
          <p className="text-[11px] text-muted-foreground">
            Your scraper sends <span className="font-mono">POST {endpoint || "/api/webhooks/jobs-ingest"}</span> with header{" "}
            <span className="font-mono">Authorization: Bearer &lt;key&gt;</span>. Up to 200 jobs per request; re-sending the same{" "}
            <span className="font-mono">externalId</span> is ignored.
          </p>
          <pre className="text-[10px] font-mono bg-secondary/40 border border-white/5 rounded-lg p-2 overflow-x-auto text-muted-foreground">{PUSH_EXAMPLE}</pre>

          <div className="flex flex-wrap items-end gap-2">
            <Input value={keyName} onChange={(e) => setKeyName(e.target.value)} placeholder="Key name (e.g. Naukri scraper)" className="h-9 max-w-xs text-xs" aria-label="Feed key name" />
            <select value={validity} onChange={(e) => setValidity(e.target.value)} className="h-9 rounded-md border border-white/10 bg-secondary/40 px-2 text-xs text-white" aria-label="Key validity">
              {VALIDITY.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            <Button size="sm" onClick={() => createKey.mutate()} disabled={!keyName.trim() || createKey.isPending} className="text-xs font-bold">
              Generate key
            </Button>
          </div>
          {newKey && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 space-y-1">
              <p className="text-xs font-bold text-emerald-300">Copy this key now — it will not be shown again.</p>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono text-white break-all" data-testid="job-feed-new-key">{newKey}</code>
                <Button size="sm" variant="outline" className="h-7 border-white/10" onClick={() => void navigator.clipboard?.writeText(newKey)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
          <ul className="space-y-1">
            {keys.data?.map((k) => (
              <li key={k.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/5 bg-secondary/20 px-3 py-2 text-[11px]">
                <span className="text-white font-semibold">{k.name}</span>
                <span className="font-mono text-muted-foreground">{k.keyPreview}</span>
                <span className={k.status === "active" ? "text-emerald-400" : "text-muted-foreground"}>{k.status}</span>
                <span className="text-muted-foreground">{k.lastUsedAt ? `used ${formatInIST(k.lastUsedAt)}` : "never used"}</span>
                {k.status === "active" && (
                  <Button size="sm" variant="ghost" className="h-7 text-rose-400" onClick={() => revokeKey.mutate(k.id)} aria-label={`Revoke ${k.name}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </DialogContent>
    </Dialog>
  );
}
