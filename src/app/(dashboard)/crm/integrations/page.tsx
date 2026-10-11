"use client";

import * as React from "react";
import {
  Link2, Globe, Database, FileSpreadsheet, Zap, DollarSign,
  Image as ImageIcon, Copy, Check, Plus, Trash2,
  ExternalLink, ShieldCheck, AlertCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GoogleAdsWebhookData {
  webhookUrl: string;
  keyConfigured: boolean;
  legacyKeyConfigured?: boolean;
}

interface WebhookKey {
  id: string;
  name: string;
  keyPreview: string;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  status: "active" | "expired" | "revoked";
  key?: string; // present only in the create response
}

const VALIDITY_OPTIONS = [
  { value: "1", label: "1 day" },
  { value: "3", label: "3 days" },
  { value: "7", label: "7 days" },
  { value: "15", label: "15 days" },
  { value: "30", label: "30 days" },
  { value: "45", label: "45 days" },
  { value: "60", label: "60 days" },
  { value: "never", label: "Never expires" },
] as const;

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

interface IntegrationStatus {
  status: "connected" | "configured_not_verified" | "not_configured" | "removed" | "error";
  provider?: string;
  note?: string;
  required?: string[];
  missing?: string[];
  webhookUrl?: string;
  assets?: number;
  bucket?: string;
}

// crm field from API: { leads: IntegrationStatus }
interface IntegrationsData {
  crm: { leads: IntegrationStatus };
  facebook: IntegrationStatus;
  googleAds: IntegrationStatus;
  media: IntegrationStatus;
  documents: IntegrationStatus;
  automation: IntegrationStatus;
  payments: IntegrationStatus;
  frappe: IntegrationStatus;
  summary: { connected: string[]; notConfigured: string[] };
}

// ─── Small utilities ──────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: IntegrationStatus["status"] }) {
  const map = {
    connected: { label: "Connected", cls: "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" },
    configured_not_verified: { label: "Configured, Not Verified", cls: "bg-amber-500/20 text-amber-400 border border-amber-500/30" },
    not_configured: { label: "Not Configured", cls: "bg-gray-500/20 text-gray-400 border border-gray-500/30" },
    removed: { label: "Removed", cls: "bg-gray-500/20 text-gray-400 border border-gray-500/30" },
    error: { label: "Error", cls: "bg-rose-500/20 text-rose-400 border border-rose-500/30" },
  } as const;
  const s = map[status] ?? map.not_configured;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold", s.cls)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", status === "connected" ? "bg-emerald-400" : status === "configured_not_verified" ? "bg-amber-400" : "bg-gray-500")} />
      {s.label}
    </span>
  );
}

function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button
      size="sm"
      variant="outline"
      onClick={copy}
      className="h-7 gap-1.5 border-white/10 text-xs font-semibold hover:bg-white/5 hover:text-white"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied!" : label}
    </Button>
  );
}

// ─── One-time key reveal modal ────────────────────────────────────────────────

function KeyRevealModal({ keyValue, onClose }: { keyValue: string; onClose: () => void }) {
  const [copied, setCopied] = React.useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(keyValue);
    setCopied(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-amber-500/30 bg-[#0f1117] shadow-2xl p-6 space-y-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10">
            <ShieldCheck className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <p className="font-bold text-white text-sm">New Webhook Key Generated</p>
            <p className="text-xs text-muted-foreground">Copy this key now — it will not be shown again.</p>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-secondary/30 p-3 font-mono text-xs text-white break-all select-all">
          {keyValue}
        </div>

        <div className="flex gap-2">
          <Button
            className="flex-1 gap-2 bg-primary font-bold"
            onClick={copy}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "Copied!" : "Copy Key"}
          </Button>
          <Button
            variant="outline"
            className="border-white/10 hover:bg-white/5"
            onClick={onClose}
          >
            Close
          </Button>
        </div>

        {!copied && (
          <p className="text-center text-[11px] text-amber-400/80 flex items-center justify-center gap-1">
            <AlertCircle className="h-3 w-3" />
            Paste this in the Google Ads &quot;Key&quot; field before closing
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Google Ads Card (main interactive card) ──────────────────────────────────

function GoogleAdsCard({ status, note }: { status: IntegrationStatus["status"]; note?: string }) {
  const qc = useQueryClient();
  const [revealKey, setRevealKey] = React.useState<string | null>(null);
  const [keyName, setKeyName] = React.useState("");
  const [validity, setValidity] = React.useState<string>("30");
  const [formError, setFormError] = React.useState<string | null>(null);

  const { data: webhookData, isLoading } = useQuery<GoogleAdsWebhookData>({
    queryKey: ["webhooks", "google-ads"],
    queryFn: () => apiFetch<GoogleAdsWebhookData>("/webhooks/google-ads"),
  });

  const { data: keys, isLoading: keysLoading } = useQuery<WebhookKey[]>({
    queryKey: ["webhooks", "google-ads", "keys"],
    queryFn: () => apiFetch<WebhookKey[]>("/webhooks/google-ads/keys"),
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["webhooks", "google-ads"] });
    void qc.invalidateQueries({ queryKey: ["crm-integrations"] });
  };

  const createKey = useMutation({
    mutationFn: () =>
      apiFetch<WebhookKey>("/webhooks/google-ads/keys", {
        method: "POST",
        body: JSON.stringify({ name: keyName.trim(), validity }),
      }),
    onSuccess: (data) => {
      if (data.key) setRevealKey(data.key);
      setKeyName("");
      setFormError(null);
      refresh();
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Could not create key"),
  });

  const revokeKey = useMutation({
    mutationFn: (id: string) => apiFetch<WebhookKey>(`/webhooks/google-ads/keys/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });

  const webhookUrl = webhookData?.webhookUrl ?? "";
  const keyConfigured = webhookData?.keyConfigured ?? false;

  const submitKey = () => {
    if (!keyName.trim()) {
      setFormError("Give the key a name, e.g. the Google Form it is used on.");
      return;
    }
    createKey.mutate();
  };

  return (
    <>
      {revealKey && (
        <KeyRevealModal
          keyValue={revealKey}
          onClose={() => setRevealKey(null)}
        />
      )}

      <Card className="bg-card border-white/10 shadow-lg col-span-full md:col-span-2">
        <CardHeader className="flex flex-row items-start justify-between pb-3">
          <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
            <Globe className="h-4 w-4 text-amber-400" />
            Google Ads Lead Forms
          </CardTitle>
          <StatusBadge status={keyConfigured ? "connected" : status} />
        </CardHeader>

        <CardContent className="space-y-5">
          <p className="text-xs text-muted-foreground">{note}</p>

          {/* Webhook URL */}
          <div className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Webhook URL
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-lg border border-white/10 bg-secondary/30 px-3 py-2 font-mono text-xs text-white truncate">
                {isLoading ? (
                  <span className="text-muted-foreground">Loading...</span>
                ) : (
                  webhookUrl
                )}
              </div>
              {webhookUrl && <CopyButton value={webhookUrl} />}
              {webhookUrl && (
                <a
                  href={webhookUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-white/10 text-muted-foreground hover:bg-white/5 hover:text-white transition-colors"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </div>

          {/* Webhook Keys — one per lead form */}
          <div className="space-y-3" data-testid="google-ads-keys">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
              Webhook Keys
            </p>

            <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto] items-end">
              <div className="space-y-1">
                <label htmlFor="gads-key-name" className="text-[10px] font-bold text-muted-foreground">Key name (form)</label>
                <input
                  id="gads-key-name"
                  data-testid="google-ads-key-name"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  maxLength={100}
                  placeholder="e.g. CPL Lead Form – Delhi"
                  className="flex h-8 w-full rounded-lg border border-white/10 bg-secondary/40 px-2 text-xs text-white"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="gads-key-validity" className="text-[10px] font-bold text-muted-foreground">Validity</label>
                <select
                  id="gads-key-validity"
                  data-testid="google-ads-key-validity"
                  value={validity}
                  onChange={(e) => setValidity(e.target.value)}
                  className="flex h-8 w-full rounded-lg border border-white/10 bg-secondary/60 px-2 text-xs font-bold"
                >
                  {VALIDITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
              <Button
                size="sm"
                onClick={submitKey}
                disabled={createKey.isPending}
                data-testid="google-ads-key-create"
                className="h-8 gap-1.5 text-xs font-bold bg-primary shadow-md shadow-primary/20"
              >
                <Plus className="h-3 w-3" />
                {createKey.isPending ? "Creating..." : "Create Key"}
              </Button>
            </div>
            {formError && <p className="text-[11px] text-rose-400">{formError}</p>}

            {keysLoading ? (
              <p className="text-xs text-muted-foreground">Loading keys...</p>
            ) : keys && keys.length > 0 ? (
              <div className="rounded-lg border border-white/10 overflow-x-auto">
                <table className="w-full text-[11px] min-w-[560px]">
                  <thead>
                    <tr className="border-b border-white/10 text-muted-foreground">
                      <th className="text-left font-bold px-3 py-2">Name</th>
                      <th className="text-left font-bold px-3 py-2">Key</th>
                      <th className="text-left font-bold px-3 py-2">Expires</th>
                      <th className="text-left font-bold px-3 py-2">Last used</th>
                      <th className="text-center font-bold px-3 py-2">Status</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {keys.map((k) => (
                      <tr key={k.id} data-testid={`google-ads-key-${k.id}`} className="border-b border-white/5">
                        <td className="px-3 py-2 font-semibold text-white">{k.name}</td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">{k.keyPreview}</td>
                        <td className="px-3 py-2 text-muted-foreground">{k.expiresAt ? formatDay(k.expiresAt) : "Never"}</td>
                        <td className="px-3 py-2 text-muted-foreground">{formatDay(k.lastUsedAt)}</td>
                        <td className="px-3 py-2 text-center">
                          <span
                            className={cn(
                              "inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold capitalize",
                              k.status === "active"
                                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                                : k.status === "expired"
                                  ? "border-amber-500/30 bg-amber-500/10 text-amber-400"
                                  : "border-white/10 bg-secondary/40 text-muted-foreground",
                            )}
                          >
                            {k.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          {k.status !== "revoked" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={revokeKey.isPending}
                              onClick={() => {
                                if (window.confirm(`Revoke key "${k.name}"? Leads from forms using it will be rejected.`)) {
                                  revokeKey.mutate(k.id);
                                }
                              }}
                              className="h-6 px-1.5 text-[10px] text-rose-400 hover:text-rose-300"
                            >
                              <Trash2 className="h-3 w-3 mr-1" /> Revoke
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-white/10 bg-secondary/20 px-3 py-2 text-xs text-muted-foreground">
                No form keys yet. Create one key per Google Ads lead form.
              </div>
            )}

            {webhookData?.legacyKeyConfigured && (
              <p className="text-[11px] text-muted-foreground/70">
                The previous single webhook key is still accepted, so forms already set up keep working.
              </p>
            )}
            {keyConfigured && (
              <p className="text-[11px] text-muted-foreground/60">
                Each key is shown once at creation. Expired or revoked keys are rejected by the webhook.
              </p>
            )}
          </div>

          {/* Quick Setup Guide */}
          <div className="rounded-xl border border-white/5 bg-secondary/20 p-4 space-y-2">
            <p className="text-[11px] font-bold text-white/60 uppercase tracking-wider">Quick Setup</p>
            <ol className="space-y-1.5 text-[11px] text-muted-foreground list-decimal list-inside">
              <li>Copy the <span className="text-white font-semibold">Webhook URL</span> above</li>
              <li>Create a <span className="text-white font-semibold">Webhook Key</span> for the form, pick its validity, and copy it</li>
              <li>In Google Ads → Lead Form → <em>Other data integrations</em> → paste both</li>
              <li>Repeat with a new key for every other lead form</li>
              <li>Click <em>Send test data</em> to verify the connection</li>
            </ol>
          </div>
        </CardContent>
      </Card>
    </>
  );
}

// ─── Generic read-only integration card ───────────────────────────────────────

function IntegrationCard({
  title,
  icon,
  status,
  body,
  required,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  status: IntegrationStatus["status"];
  body: string;
  required?: string[];
  children?: React.ReactNode;
}) {
  return (
    <Card className="bg-card border-white/10 shadow-lg">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-bold text-white flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <StatusBadge status={status} />
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{body}</p>
        {required && required.length > 0 && status === "not_configured" && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {required.map((r) => (
              <code
                key={r}
                className="rounded border border-white/10 bg-secondary/40 px-1.5 py-0.5 text-[10px] text-white"
              >
                {r}
              </code>
            ))}
          </div>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CRMIntegrationsPage() {
  const { data, isLoading, error } = useQuery<IntegrationsData>({
    queryKey: ["crm-integrations"],
    queryFn: () => apiFetch<IntegrationsData>("/crm/integrations"),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading integrations...
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64 text-red-400 text-sm font-bold">
        Error loading integrations. Please refresh.
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-white">Integrations</h1>
        <p className="text-sm text-muted-foreground">
          Manage all channels that feed data into the CRM. Generate webhook URLs and keys directly from here.
        </p>
      </div>

      {/* Summary chips */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-400">
          <Check className="h-3 w-3" />
          {data.summary.connected.length} Connected
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-gray-500/20 bg-gray-500/10 px-3 py-1 text-[11px] font-bold text-gray-400">
          <AlertCircle className="h-3 w-3" />
          {data.summary.notConfigured.length} Not Configured
        </div>
      </div>

      {/* Google Ads — full-width interactive card */}
      <div className="grid gap-4 md:grid-cols-2">
        <GoogleAdsCard
          status={data.googleAds.status}
          note={data.googleAds.note}
        />
      </div>

      {/* All other integrations */}
      <div className="grid gap-4 md:grid-cols-2">
        <IntegrationCard
          title="Built-in CRM"
          icon={<Database className="h-4 w-4 text-emerald-500" />}
          status={data.crm.leads?.status ?? "connected"}
          body={data.crm.leads?.note ?? "Leads and activities stored natively."}
        />

        <IntegrationCard
          title="Facebook Lead Ads"
          icon={<Link2 className="h-4 w-4 text-blue-500" />}
          status={data.facebook.status}
          body={data.facebook.note ?? ""}
          required={data.facebook.missing ?? data.facebook.required}
        >
          {data.facebook.webhookUrl && (
            <div className="pt-1 space-y-1.5" data-testid="facebook-setup">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground/70">
                Webhook URL
              </p>
              <div className="flex items-center gap-2">
                <div className="flex-1 rounded-lg border border-white/10 bg-secondary/30 px-3 py-2 font-mono text-xs text-white truncate">
                  {data.facebook.webhookUrl}
                </div>
                <CopyButton value={data.facebook.webhookUrl} />
              </div>
              <ol className="space-y-1 text-[10px] text-muted-foreground list-decimal list-inside">
                <li>Meta for Developers → your App → add the <em>Webhooks</em> product</li>
                <li>Object <em>Page</em> → Callback URL above, Verify token = FACEBOOK_WEBHOOK_VERIFY_TOKEN → subscribe to <em>leadgen</em></li>
                <li>Generate a long-lived Page access token with <em>leads_retrieval</em> → FACEBOOK_PAGE_ACCESS_TOKEN</li>
                <li>Set App ID / App Secret on the admin service, then use Meta&apos;s Lead Ads Testing Tool</li>
              </ol>
            </div>
          )}
        </IntegrationCard>

        <IntegrationCard
          title="Media Storage (Google Cloud Storage)"
          icon={<ImageIcon className="h-4 w-4 text-purple-500" />}
          status={data.media.status}
          body={`${data.media.note ?? ""} ${data.media.assets != null ? `Assets stored: ${data.media.assets}.` : ""}`}
        />

        <IntegrationCard
          title="Documents (Google Cloud Storage)"
          icon={<FileSpreadsheet className="h-4 w-4 text-indigo-500" />}
          status={data.documents.status}
          body={`Documents stored: ${data.documents.assets ?? 0}.`}
        />

        <IntegrationCard
          title="Automation Engine (PostgreSQL + Cron)"
          icon={<Zap className="h-4 w-4 text-primary" />}
          status={data.automation.status}
          body={data.automation.note ?? ""}
        />

        <IntegrationCard
          title="Payments"
          icon={<DollarSign className="h-4 w-4 text-emerald-500" />}
          status={data.payments.status}
          body={data.payments.note ?? ""}
          required={data.payments.required}
        />

        <IntegrationCard
          title="Frappe ERP"
          icon={<Database className="h-4 w-4 text-muted-foreground" />}
          status={data.frappe.status}
          body={data.frappe.note ?? ""}
        />
      </div>
    </div>
  );
}
