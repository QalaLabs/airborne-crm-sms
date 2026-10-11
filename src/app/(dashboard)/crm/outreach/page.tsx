"use client";

import * as React from "react";
import { Mail, TrendingUp, MessageSquare, AlertCircle, Plus } from "lucide-react";
import {
  getOutreachData,
  toggleTemplate,
  createTemplate,
  type TemplateInput,
} from "@/lib/crm/outreach";
import type { OutreachData, OutreachLog } from "@/lib/crm/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CRMDataTable, CRMColumn } from "@/components/shared/crm-data-table";
import { toast } from "@/components/ui/use-toast";

const EVENTS = [
  "NEW_LEAD",
  "LEAD_ASSIGNED",
  "LEAD_STATUS_CHANGED",
  "ADMISSION_STAGE_CHANGED",
  "JOB_PUBLISHED",
  "TESTIMONIAL_SUBMITTED",
  "PAYMENT_RECEIVED",
  "PLACEMENT_ADDED",
  "ENQUIRY_RECEIVED",
  "USER_INVITED",
  "TASK_DUE",
  "WORKFLOW_TRIGGERED",
] as const;

const CHANNELS = ["EMAIL", "SMS", "WHATSAPP", "IN_APP"] as const;

const channelIcon: Record<string, React.ReactNode> = {
  EMAIL: <Mail className="h-3.5 w-3.5" />,
  SMS: <MessageSquare className="h-3.5 w-3.5" />,
  WHATSAPP: <MessageSquare className="h-3.5 w-3.5" />,
  IN_APP: <TrendingUp className="h-3.5 w-3.5" />,
};

export default function CRMOutreachPage() {
  const [data, setData] = React.useState<OutreachData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [togglingId, setTogglingId] = React.useState<string | null>(null);
  const [showCreate, setShowCreate] = React.useState(false);
  const [creating, setCreating] = React.useState(false);

  const load = React.useCallback(() => {
    getOutreachData()
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  const handleToggle = (id: string, isActive: boolean) => {
    setTogglingId(id);
    toggleTemplate(id, isActive)
      .then(() => {
        toast({ title: isActive ? "Template enabled" : "Template paused" });
        load();
      })
      .catch((e: unknown) =>
        toast({ title: "Failed to update template", description: e instanceof Error ? e.message : String(e), variant: "destructive" }),
      )
      .finally(() => setTogglingId(null));
  };

  const handleCreate = async (input: TemplateInput) => {
    setCreating(true);
    try {
      await createTemplate(input);
      toast({ title: "Template created" });
      setShowCreate(false);
      load();
    } catch (e: unknown) {
      toast({ title: "Failed to create template", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight text-white">Outreach</h1>
            <p className="text-sm text-muted-foreground">Notification templates and delivery log</p>
          </div>
        </div>
        <div className="p-6 text-white text-xs">Loading outreach campaigns...</div>
      </div>
    );
  }

  if (error || !data) {
    return <div className="p-6 text-red-500 font-bold">Error loading outreach data: {error || "No data"}</div>;
  }

  const templates = data.templates;
  const logs = data.logs;
  const totalSent = data.delivery.sent;
  const totalFailed = data.delivery.failed;
  const totalPending = data.delivery.pending;
  // Honest metrics: "…" when the platform has no persisted measurement — the
  // server never fabricates zeros for email open/reply rates.
  const openRate = data.delivery.emailOpenRate == null ? "…" : `${Math.round(data.delivery.emailOpenRate * 100)}%`;
  const replyRate = data.delivery.replyRate == null ? "…" : `${Math.round(data.delivery.replyRate * 100)}%`;

  const templateColumns: CRMColumn<OutreachData["templates"][number]>[] = [
    {
      key: "name",
      header: "Template",
      render: (t) => (
        <div>
          <p className="font-semibold text-white">{t.name}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{t.body.slice(0, 90)}</p>
        </div>
      ),
    },
    {
      key: "event",
      header: "Event",
      render: (t) => <Badge variant="outline" className="border-white/10 text-[9px] font-bold">{t.event}</Badge>,
    },
    {
      key: "channel",
      header: "Channel",
      render: (t) => (
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-semibold">
          {channelIcon[t.channel] ?? null}
          {t.channel}
        </span>
      ),
    },
    {
      key: "isActive",
      header: "Status",
      render: (t) => (
        <Badge className={`${t.isActive ? "bg-emerald-500" : "bg-gray-500"} text-white border-none text-[9px] px-2 py-0.5 rounded-full`}>
          {t.isActive ? "Active" : "Paused"}
        </Badge>
      ),
    },
    {
      key: "toggle",
      header: "",
      render: (t) => (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px] border-white/10"
          disabled={togglingId === t.id}
          onClick={() => handleToggle(t.id, !t.isActive)}
        >
          {t.isActive ? "Pause" : "Activate"}
        </Button>
      ),
    },
  ];

  const logColumns: CRMColumn<OutreachLog>[] = [
    {
      key: "recipient",
      header: "Recipient",
      render: (l) => <span className="font-semibold text-white">{l.recipient}</span>,
    },
    { key: "channel", header: "Channel" },
    {
      key: "event",
      header: "Event",
      render: (l) => <span className="text-muted-foreground">{l.event ?? "—"}</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (l) => {
        const s = String(l.status).toUpperCase();
        const cls = s === "SENT" ? "bg-emerald-500" : s === "FAILED" ? "bg-red-500" : "bg-amber-500";
        return (
          <Badge className={`${cls} text-white border-none text-[9px] px-2 py-0.5 rounded-full`}>
            {s}
          </Badge>
        );
      },
    },
    {
      key: "createdAt",
      header: "At",
      render: (l) =>
        l.createdAt
          ? new Date(l.createdAt).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
          : "—",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-white">Outreach</h1>
          <p className="text-sm text-muted-foreground">Notification templates and delivery log from persisted records</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card border-white/10 shadow-lg">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-semibold">Messages Sent</p>
              <p className="text-2xl font-bold text-white mt-1">{totalSent}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/10">
              <Mail className="h-5 w-5 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-white/10 shadow-lg">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-semibold">Pending</p>
              <p className="text-2xl font-bold text-white mt-1">{totalPending}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
              <TrendingUp className="h-5 w-5 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-white/10 shadow-lg">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-semibold">Failed</p>
              <p className="text-2xl font-bold text-white mt-1">{totalFailed}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-500/10">
              <AlertCircle className="h-5 w-5 text-red-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-card border-white/10 shadow-lg">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-semibold">Email / Reply Rate</p>
              <p className="text-2xl font-bold text-white mt-1">{openRate}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">reply {replyRate}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
              <MessageSquare className="h-5 w-5 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {(["email", "sms", "whatsapp"] as const).map((key) => {
          const p = data.providers[key];
          const statusLabel =
            p.status === "connected"
              ? "Connected / verified"
              : p.status === "configured_not_verified"
                ? "Configured, not verified"
                : "Not configured";
          const live = p.status === "connected";
          return (
            <Card key={key} className="bg-card border-white/10 shadow-lg">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-muted-foreground font-semibold">{p.provider} ({key})</p>
                  <p className="text-sm font-bold text-white mt-1">{statusLabel}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{p.note}</p>
                </div>
                <Badge className={`${live ? "bg-emerald-500" : p.status === "configured_not_verified" ? "bg-amber-500" : "bg-gray-500"} text-white border-none text-[9px]`}>
                  {live ? "VERIFIED" : p.status === "configured_not_verified" ? "NOT_VERIFIED" : "NOT_CONFIGURED"}
                </Badge>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-card border-white/10 shadow-lg">
        <CardContent className="p-3 rounded-lg bg-secondary/20 border border-white/5 text-xs text-muted-foreground">
          <span className="font-bold text-white">Dispatch engine: </span>
          {data.dispatchEngine.note}
        </CardContent>
      </Card>

      <Card className="bg-card border-white/10 shadow-lg">
        <CardHeader className="border-b border-white/5 pb-3 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-semibold text-white">Templates</CardTitle>
          <Button size="sm" className="text-xs h-8" onClick={() => setShowCreate((s) => !s)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New Template
          </Button>
        </CardHeader>
        <CardContent className="pt-4">
          {showCreate && (
            <NewTemplateForm
              submitting={creating}
              onSubmit={handleCreate}
              onCancel={() => setShowCreate(false)}
            />
          )}
          {templates.length === 0 ? (
            <p className="text-xs text-muted-foreground">No notification templates exist yet in this workspace.</p>
          ) : (
            <CRMDataTable columns={templateColumns} data={templates} searchable={false} pageSize={10} />
          )}
        </CardContent>
      </Card>

      <Card className="bg-card border-white/10 shadow-lg">
        <CardHeader className="border-b border-white/5 pb-3">
          <CardTitle className="text-sm font-semibold text-white">Delivery Log</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {logs.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No delivery records yet. Logs are written when the notification worker processes queued events.
            </p>
          ) : (
            <CRMDataTable columns={logColumns} data={logs} searchable={false} pageSize={10} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function NewTemplateForm({
  onSubmit,
  onCancel,
  submitting,
}: {
  onSubmit: (input: TemplateInput) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [event, setEvent] = React.useState<TemplateInput["event"]>("NEW_LEAD");
  const [channel, setChannel] = React.useState<TemplateInput["channel"]>("EMAIL");
  const [name, setName] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [variables, setVariables] = React.useState("");

  const canSubmit = name.trim().length > 0 && body.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      event,
      channel,
      name: name.trim(),
      subject: subject.trim() || null,
      body: body.trim(),
      variables: variables
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mb-4 p-4 rounded-lg border border-white/10 bg-secondary/20">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Event</Label>
          <Select value={event} onValueChange={(v) => setEvent(v as TemplateInput["event"])}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EVENTS.map((ev) => (
                <SelectItem key={ev} value={ev} className="text-xs">{ev}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Channel</Label>
          <Select value={channel} onValueChange={(v) => setChannel(v as TemplateInput["channel"])}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CHANNELS.map((ch) => (
                <SelectItem key={ch} value={ch} className="text-xs">{ch}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Template name</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. New lead WhatsApp" className="h-9 text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Subject (email)</Label>
        <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Optional" className="h-9 text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Body</Label>
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Hi {{leadName}}, ..." rows={4} className="text-xs" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Variables (comma separated)</Label>
        <Input value={variables} onChange={(e) => setVariables(e.target.value)} placeholder="leadName, courseName" className="h-9 text-xs" />
        <p className="text-[10px] text-muted-foreground">
          Allowed: leadName, firstName, lastName, phone, email, courseName, counselorName, amount, dueDate, link
        </p>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" size="sm" variant="outline" className="h-8 text-xs border-white/10" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" className="h-8 text-xs" disabled={!canSubmit || submitting}>
          {submitting ? "Creating..." : "Create Template"}
        </Button>
      </div>
    </form>
  );
}
