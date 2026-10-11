"use client";

import { PageHeader } from "@/components/shared/page-header";
import { Bot, AlertTriangle } from "lucide-react";

export default function VapiPage() {
  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="Voice AI Call Logs"
        description="AI-handled candidate calls and transcripts."
      />
      <div className="glass-card rounded-2xl p-10 border border-white/10 flex flex-col items-center justify-center text-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-400">
          <AlertTriangle className="h-6 w-6" />
        </div>
        <h3 className="text-base font-bold text-white">Not Connected</h3>
        <p className="text-xs text-muted-foreground max-w-md">
          This module requires a Vapi Voice AI integration, which has not been configured yet.
          No call logs, recordings, or transcripts are available until that integration is wired up.
        </p>
        <Bot className="h-4 w-4 text-muted-foreground mt-2" />
      </div>
    </div>
  );
}
