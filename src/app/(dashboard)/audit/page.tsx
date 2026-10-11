"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { 
  History, Download, Search, Filter, ShieldCheck,
  Clock, Globe, Database
} from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/components/ui/use-toast";

interface AuditLog {
  id: string;
  actionType: string;
  user: string;
  email: string;
  timestamp: string;
  ipAddress: string;
  description: string;
  integrityHash: string;
  module: string;
}

export default function AuditPage() {
  const [search, setSearch] = React.useState("");
  const [actionFilter, setActionFilter] = React.useState("ALL");
  const [selectedAudit, setSelectedAudit] = React.useState<AuditLog | null>(null);

  const { data: auditResult } = useQuery({
    queryKey: ["audit-trail", search, actionFilter],
    queryFn: async () => {
      const p = new URLSearchParams({
        page: "1",
        limit: "100",
        ...(search ? { search } : {}),
        ...(actionFilter && actionFilter !== "ALL" ? { module: actionFilter } : {}),
      });
      // apiFetch drops meta; fetch raw so we can use meta.total for the KPI.
      const raw = await fetch(`/api/v1/audit?${p}`, { credentials: "include" });
      if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
      const json = await raw.json() as { data: AuditLog[]; meta?: { total: number } };
      return {
        items: json.data ?? [],
        total: json.meta?.total ?? (json.data?.length ?? 0),
      };
    },
  });

  const filteredAudits = auditResult?.items ?? [];
  const totalEntries = auditResult?.total ?? filteredAudits.length;

  const handleCsvExport = () => {
    // Generate CSV string
    const headers = ["ID,Action Type,User,Email,Timestamp,IP Address,Description,Integrity Hash,Module"];
    const rows = filteredAudits.map(a => `"${a.id}","${a.actionType}","${a.user}","${a.email}","${a.timestamp}","${a.ipAddress}","${a.description}","${a.integrityHash}","${a.module}"`);
    const csvContent = "data:text/csv;charset=utf-8," + [headers, ...rows].join("\n");
    
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Airborne_Audit_Trail_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({ title: "CSV Export Generated", description: "Audit trail downloaded successfully." });
  };

  return (
    <div className="space-y-8 pb-12">
      <PageHeader 
        title="Immutable Audit Trail & Activity Ledger" 
        description="Review unmodifiable historical administration actions. Filter by action type, user, timestamp, or IP address with cryptographic hash verification." 
        action={
          <Button onClick={handleCsvExport} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all hover:scale-105 text-xs font-bold">
            <Download className="h-4 w-4 mr-2" />
            Export Audit Trail (CSV)
          </Button>
        }
      />

      {/* Live count from filtered API result */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="glass-card rounded-2xl p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Recorded Events</span>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400">
              <Database className="h-4 w-4" />
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-bold text-white tracking-tight">{totalEntries.toLocaleString()} Entries</div>
            <p className="text-[11px] font-medium text-muted-foreground mt-1">
              {actionFilter === "ALL" && !search ? "Matching current filters" : "Filtered result total"}
            </p>
          </div>
        </motion.div>
      </div>

      {/* Main Audit Table */}
      <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-white/10 pb-4 gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by action, user, IP address, timestamp..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-secondary/40 border-white/10 focus:border-primary text-xs font-semibold text-white"
            />
          </div>
          <div className="flex items-center gap-3">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <select value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} className="flex h-9 w-48 rounded-xl border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
              <option value="ALL" className="bg-slate-900">All Modules & Actions</option>
              <option value="Admissions" className="bg-slate-900">Admissions Module</option>
              <option value="Courses" className="bg-slate-900">Courses Module</option>
              <option value="Notifications" className="bg-slate-900">Notifications Module</option>
              <option value="Vapi AI" className="bg-slate-900">Vapi AI Module</option>
              <option value="CMS" className="bg-slate-900">CMS Module</option>
              <option value="Media Library" className="bg-slate-900">Media Library</option>
              <option value="Placements" className="bg-slate-900">Placements Module</option>
              <option value="System Config" className="bg-slate-900">System Config</option>
            </select>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 overflow-hidden glass-panel shadow-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-slate-900/80">
                <th className="text-left px-6 py-4 text-xs font-bold text-white uppercase tracking-wider">Action Type & Module</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-white uppercase tracking-wider">System User</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-white uppercase tracking-wider">Action Description</th>
                <th className="text-left px-6 py-4 text-xs font-bold text-white uppercase tracking-wider">Timestamp & IP Address</th>
                <th className="w-24 px-6 py-4 text-right text-xs font-bold text-white uppercase tracking-wider">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 bg-secondary/20">
              {filteredAudits.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-16 text-center text-xs text-muted-foreground">
                    No audit entries match the current filters.
                  </td>
                </tr>
              ) : filteredAudits.map((aud) => (
                <tr key={aud.id} onClick={() => setSelectedAudit(aud)} className="hover:bg-white/5 transition-colors cursor-pointer group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary shrink-0">
                        <History className="h-5 w-5" />
                      </div>
                      <div>
                        <span className="font-bold text-white group-hover:text-primary transition-colors text-xs block">{aud.actionType}</span>
                        <span className="text-[10px] font-semibold text-muted-foreground block mt-0.5">Module: {aud.module}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-bold text-white block">{aud.user}</span>
                    <span className="text-[11px] text-muted-foreground block mt-0.5">{aud.email}</span>
                  </td>
                  <td className="px-6 py-4 text-xs text-muted-foreground font-medium max-w-xs truncate">
                    {aud.description}
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs font-semibold text-white block flex items-center gap-1"><Clock className="h-3 w-3 text-primary" /> {aud.timestamp}</span>
                    <span className="text-[11px] text-muted-foreground block mt-0.5 flex items-center gap-1"><Globe className="h-3 w-3 text-muted-foreground" /> {aud.ipAddress}</span>
                  </td>
                  <td className="px-6 py-4 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" onClick={() => setSelectedAudit(aud)} className="text-xs font-bold text-emerald-400 hover:bg-white/10">
                      <ShieldCheck className="h-4 w-4 mr-1.5" /> Inspect Hash
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Audit Inspect Modal */}
      <Dialog open={!!selectedAudit} onOpenChange={(o) => !o && setSelectedAudit(null)}>
        <DialogContent className="max-w-3xl glass-panel border-white/10 bg-slate-900/95 p-0 overflow-hidden">
          <DialogHeader className="p-6 border-b border-white/10 bg-slate-900/80">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="text-xl font-bold text-white flex items-center gap-2">
                  <ShieldCheck className="h-6 w-6 text-emerald-400" />
                  Ledger Entry: {selectedAudit?.actionType}
                </DialogTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Module: <span className="font-semibold text-white">{selectedAudit?.module}</span> • Entry ID: <span className="font-mono text-primary font-bold">{selectedAudit?.id}</span>
                </p>
              </div>
            </div>
          </DialogHeader>

          {selectedAudit && (
            <div className="p-6 space-y-6 overflow-y-auto max-h-[60vh]">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 p-4 rounded-xl bg-secondary/30 border border-white/5">
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase block">System Operator</span>
                  <p className="text-sm font-bold text-white mt-1">{selectedAudit.user}</p>
                  <p className="text-xs text-muted-foreground">{selectedAudit.email}</p>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-muted-foreground uppercase block">Network Origin</span>
                  <p className="text-sm font-bold text-white mt-1">{selectedAudit.ipAddress}</p>
                  <p className="text-xs text-muted-foreground">Logged at {selectedAudit.timestamp}</p>
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Full Action Detail</h3>
                <div className="p-4 rounded-xl bg-secondary/40 border border-white/5 text-xs font-medium text-white leading-relaxed">
                  {selectedAudit.description}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-2">Integrity Hash</h3>
                <div className="p-4 rounded-xl bg-slate-950 border border-white/10 text-xs font-mono font-bold text-emerald-400 select-all overflow-x-auto">
                  {selectedAudit.integrityHash}
                </div>
                <p className="text-[11px] text-muted-foreground mt-1.5">Row hash from the audit ledger for this entry.</p>
              </div>
            </div>
          )}

          <DialogFooter className="p-6 border-t border-white/10 bg-slate-900/80">
            <Button variant="outline" onClick={() => setSelectedAudit(null)} className="border-white/10 hover:bg-white/5 text-xs font-bold">
              Close Audit Dossier
            </Button>
            <Button onClick={() => { navigator.clipboard.writeText(JSON.stringify(selectedAudit, null, 2)); toast({ title: "Audit Record Copied", description: "JSON proof copied to clipboard." }); }} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
              Copy JSON Proof
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
