"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PlugZap, CheckCircle2, XCircle, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";

interface WhatsAppSettings {
  provider: string;
  providerConfigured: boolean;
  providerName: string;
  envProvider: string | null;
  connected: boolean;
  configurationStatus: string;
  credentialsMasked: { apiKey: string | null } | null;
  whatsappNotifications: boolean;
  webhookUrl: string;
  webhookConfigured: boolean;
  webhookAuth: string;
}

interface HealthResult {
  ok: boolean;
  live: boolean;
  provider: string;
  status?: number;
  error?: string;
}

/**
 * Automation controls for the Interakt integration (lead -> Interakt templates,
 * inbound webhook). Day-to-day messaging happens inside Interakt itself.
 */
export function WhatsAppAutomationCard() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["whatsapp", "settings"],
    queryFn: () => apiFetch<WhatsAppSettings>("/whatsapp/settings"),
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      apiFetch("/whatsapp/settings", {
        method: "PATCH",
        body: JSON.stringify({ whatsappNotifications: enabled }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp", "settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: () => apiFetch<HealthResult>("/whatsapp/settings", { method: "POST" }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp", "settings"] });
      toast({
        title: result.live ? "Interakt connected" : result.ok ? "Provider reachable (not live)" : "Connection failed",
        description: result.live
          ? "A real Get Users request against api.interakt.ai succeeded."
          : result.error ?? `HTTP ${result.status ?? "n/a"}`,
        variant: result.live ? "default" : "destructive",
      });
    },
    onError: (err: Error) => toast({ title: "Test failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !data) return <Skeleton className="h-40 w-full max-w-3xl" />;

  return (
    <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-6 max-w-3xl" data-testid="whatsapp-automation-card">
      <div className="border-b border-white/10 pb-4">
        <h3 className="text-base font-bold text-white flex items-center gap-2">
          <PlugZap className="h-5 w-5 text-primary" /> WhatsApp Automation (Interakt)
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Lead-to-Interakt templates and the inbound webhook keep running from here. Conversations, campaigns and
          templates are managed in Interakt via the sidebar link.
        </p>
      </div>

      <div className="flex items-center gap-3 p-4 rounded-xl bg-secondary/30 border border-white/5">
        {data.connected ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
        ) : (
          <XCircle className="h-5 w-5 text-amber-400 shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-white">
            {data.connected
              ? `Connected via "${data.providerName}"`
              : data.providerConfigured
                ? `Configured via "${data.providerName}" — not live`
                : "No provider configured"}
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Provider <span className="font-mono">{data.provider}</span> · status{" "}
            <span className="font-mono">{data.configurationStatus}</span>
            {data.credentialsMasked?.apiKey && (
              <>
                {" "}· API key <span className="font-mono">{data.credentialsMasked.apiKey}</span>
              </>
            )}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="text-xs font-bold shrink-0"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
        >
          <Activity className="h-3.5 w-3.5" />
          {testMutation.isPending ? "Testing…" : "Test connection"}
        </Button>
      </div>

      <div className="p-4 rounded-xl bg-secondary/30 border border-white/5 space-y-2">
        <p className="text-xs font-bold text-white">
          Inbound webhook: {data.webhookConfigured ? "Configured" : "Not configured"} · auth{" "}
          <span className="font-mono">{data.webhookAuth}</span>
        </p>
        <p className="text-[11px] text-muted-foreground break-all font-mono">{data.webhookUrl}</p>
      </div>

      <div className="flex items-center justify-between gap-4 p-4 rounded-xl bg-secondary/30 border border-white/5">
        <div>
          <p className="text-xs font-bold text-white">WhatsApp notifications</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Master switch for automated templated WhatsApp sends across the platform
          </p>
        </div>
        <Switch
          aria-label="WhatsApp notifications"
          checked={data.whatsappNotifications}
          onCheckedChange={(checked) => toggleMutation.mutate(checked)}
          disabled={toggleMutation.isPending}
        />
      </div>
    </div>
  );
}
