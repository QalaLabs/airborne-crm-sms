"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { parseCsv } from "@/lib/leads/csv";
import { canonicalHeader, MAX_IMPORT_ROWS } from "@/lib/leads/lead-import-headers";
import { toast } from "@/components/ui/use-toast";

interface ImportIssue {
  rowNumber: number;
  reason: string;
}

interface ImportResult {
  dryRun: boolean;
  totalRows: number;
  toCreate: number;
  created: number;
  duplicates: ImportIssue[];
  errors: ImportIssue[];
  batchId: string | null;
}

const TEMPLATE_CSV =
  "Name,Phone,Email,Course,City,State,Pincode,Source,Status,Counselor Email,Date,Notes\n" +
  "Rahul Sharma,9876543210,rahul@example.com,CPL Ground School,Delhi,Delhi,110075,Google Ads,NEW,,15-08-2025,Asked about fees\n";

function downloadTemplate() {
  const blob = new Blob([TEMPLATE_CSV], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lead-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function IssueList({ title, items, tone }: { title: string; items: ImportIssue[]; tone: "amber" | "rose" }) {
  if (items.length === 0) return null;
  const color = tone === "amber" ? "text-amber-400 border-amber-500/30 bg-amber-500/10" : "text-rose-400 border-rose-500/30 bg-rose-500/10";
  return (
    <div className={`rounded-lg border p-3 ${color}`}>
      <p className="text-xs font-bold mb-2">{title} ({items.length})</p>
      <ul className="max-h-32 overflow-y-auto space-y-1 text-[11px] text-muted-foreground font-mono">
        {items.slice(0, 200).map((i) => (
          <li key={`${i.rowNumber}-${i.reason}`}>Row {i.rowNumber}: {i.reason}</li>
        ))}
        {items.length > 200 && <li>…and {items.length - 200} more</li>}
      </ul>
    </div>
  );
}

export function LeadImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Record<string, string>[]>([]);
  const [unmapped, setUnmapped] = React.useState<string[]>([]);
  const [preview, setPreview] = React.useState<ImportResult | null>(null);
  const [done, setDone] = React.useState<ImportResult | null>(null);

  const reset = () => {
    setFileName(null);
    setRows([]);
    setUnmapped([]);
    setPreview(null);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const runImport = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<ImportResult>("/leads/import", { method: "POST", body: JSON.stringify({ rows, dryRun }) }),
    onSuccess: (result) => {
      if (result.dryRun) {
        setPreview(result);
        return;
      }
      setDone(result);
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      toast({ title: "Import complete", description: `${result.created} leads added to CRM.` });
    },
    onError: (err) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "CSV file required", description: "In Excel use File → Save As → CSV (Comma delimited).", variant: "destructive" });
      return;
    }
    const { headers, rows: parsed } = parseCsv(await file.text());
    const mapped = headers.filter((h) => canonicalHeader(h));
    if (!mapped.some((h) => canonicalHeader(h) === "name") || !mapped.some((h) => canonicalHeader(h) === "phone")) {
      toast({ title: "Missing columns", description: "The file needs at least a Name and a Phone column.", variant: "destructive" });
      return;
    }
    if (parsed.length > MAX_IMPORT_ROWS) {
      toast({ title: "File too large", description: `At most ${MAX_IMPORT_ROWS} rows per upload — split the file.`, variant: "destructive" });
      return;
    }
    setFileName(file.name);
    setRows(parsed);
    setUnmapped(headers.filter((h) => h && !canonicalHeader(h)));
    setPreview(null);
    setDone(null);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (runImport.isPending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-xl glass-panel border-white/10 bg-slate-900/95">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Import Previous Leads
          </DialogTitle>
          <DialogDescription className="text-xs">
            Upload a CSV of past enquiries. Duplicates (same phone already in CRM) are skipped, and imported leads do not
            trigger welcome WhatsApp or email messages.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 py-2">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <p className="text-sm font-bold text-white">{done.created} leads imported</p>
            </div>
            <IssueList title="Skipped — already in CRM" items={done.duplicates} tone="amber" />
            <IssueList title="Skipped — errors" items={done.errors} tone="rose" />
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Required: <span className="font-bold text-foreground">Name, Phone</span>. Optional: Email, Course, City, State,
                Pincode, Source, Status, Counselor Email, Date, Notes.
              </p>
              <Button type="button" size="sm" variant="outline" onClick={downloadTemplate} className="shrink-0 border-white/10 text-xs font-bold">
                <Download className="h-3.5 w-3.5 mr-1.5" /> Template
              </Button>
            </div>

            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-xl border-2 border-dashed border-white/15 hover:border-primary/60 p-6 text-center transition-colors"
            >
              <FileSpreadsheet className="h-8 w-8 mx-auto text-primary mb-2" />
              <p className="text-sm font-bold text-white">{fileName ?? "Choose a CSV file"}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {fileName ? `${rows.length} data rows found` : "Excel: File → Save As → CSV (Comma delimited)"}
              </p>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />

            {unmapped.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Ignored columns: <span className="font-mono">{unmapped.join(", ")}</span>
              </p>
            )}

            {preview && (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
                    <p className="text-lg font-extrabold text-emerald-400">{preview.toCreate}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">New leads</p>
                  </div>
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                    <p className="text-lg font-extrabold text-amber-400 flex items-center justify-center gap-1">
                      <Copy className="h-4 w-4" />{preview.duplicates.length}
                    </p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Already in CRM</p>
                  </div>
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2">
                    <p className="text-lg font-extrabold text-rose-400 flex items-center justify-center gap-1">
                      <AlertTriangle className="h-4 w-4" />{preview.errors.length}
                    </p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Errors</p>
                  </div>
                </div>
                <IssueList title="Will be skipped — already in CRM" items={preview.duplicates} tone="amber" />
                <IssueList title="Will be skipped — fix in file and re-upload" items={preview.errors} tone="rose" />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="pt-4 border-t border-white/10">
          {done ? (
            <Button type="button" onClick={() => { reset(); onOpenChange(false); }} className="bg-primary text-white text-xs font-bold">
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={runImport.isPending} className="border-white/10 text-xs font-bold">
                Cancel
              </Button>
              {!preview ? (
                <Button type="button" disabled={rows.length === 0 || runImport.isPending} onClick={() => runImport.mutate(true)} className="bg-primary text-white text-xs font-bold">
                  {runImport.isPending ? "Checking..." : "Check File"}
                </Button>
              ) : (
                <Button type="button" disabled={preview.toCreate === 0 || runImport.isPending} onClick={() => runImport.mutate(false)} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">
                  {runImport.isPending ? "Importing..." : `Import ${preview.toCreate} Leads`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
