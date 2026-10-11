"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { JOB_IMPORT_COLUMNS, JOB_IMPORT_TEMPLATE, MAX_JOB_IMPORT_BYTES } from "@/lib/jobs/job-import";
import { toast } from "@/components/ui/use-toast";

interface JobImportIssue {
  rowNumber: number;
  column?: string;
  message: string;
}

interface JobImportReport {
  dryRun: boolean;
  committed: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  fileErrors: string[];
  errors: JobImportIssue[];
  preview: { rowNumber: number; title: string; slug: string; location: string | null; jobType: string; company: string | null }[];
  created: { id: string; slug: string; title: string }[];
}

function downloadTemplate() {
  const blob = new Blob(["\uFEFF" + JOB_IMPORT_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "job-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function JobImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [csv, setCsv] = React.useState<string>("");
  const [preview, setPreview] = React.useState<JobImportReport | null>(null);
  const [done, setDone] = React.useState<JobImportReport | null>(null);

  const reset = () => {
    setFileName(null);
    setCsv("");
    setPreview(null);
    setDone(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const runImport = useMutation({
    mutationFn: (dryRun: boolean) =>
      apiFetch<JobImportReport>("/jobs/import", { method: "POST", body: JSON.stringify({ csv, dryRun }) }),
    onSuccess: (result) => {
      if (result.dryRun) {
        setPreview(result);
        return;
      }
      setDone(result);
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast({ title: "Import complete", description: `${result.created.length} draft jobs created.` });
    },
    onError: (err) => toast({ title: "Import failed", description: err.message, variant: "destructive" }),
  });

  const handleFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "CSV file required", description: "In Excel use File → Save As → CSV UTF-8.", variant: "destructive" });
      return;
    }
    if (file.size > MAX_JOB_IMPORT_BYTES) {
      toast({ title: "File too large", description: "At most 1 MB per upload — split the file.", variant: "destructive" });
      return;
    }
    setFileName(file.name);
    setCsv(await file.text());
    setPreview(null);
    setDone(null);
  };

  const canImport = !!preview && preview.fileErrors.length === 0 && preview.invalidRows === 0 && preview.validRows > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (runImport.isPending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-2xl glass-panel border-white/10 bg-slate-900/95">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Bulk Upload Jobs (CSV)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Jobs are validated with the same rules as Create Job and created as Drafts. The import is all-or-nothing:
            if any row is invalid or a duplicate, nothing is saved until the file is fixed.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 py-2" data-testid="job-import-done">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <p className="text-sm font-bold text-white">{done.created.length} draft jobs imported</p>
            </div>
            <ul className="max-h-40 overflow-y-auto text-[11px] text-muted-foreground font-mono space-y-1">
              {done.created.map((j) => (
                <li key={j.id}>{j.title} — /{j.slug}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Required: <span className="font-bold text-foreground">title</span>. Optional:{" "}
                {JOB_IMPORT_COLUMNS.filter((c) => !c.required).map((c) => c.key).join(", ")}.
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
              <p className="text-xs text-muted-foreground mt-1">UTF-8 CSV, up to 500 rows / 1 MB</p>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="job-import-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />

            {preview && (
              <div className="space-y-3" data-testid="job-import-preview">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/10 bg-secondary/30 p-2">
                    <p className="text-lg font-extrabold text-white" data-testid="job-import-total">{preview.totalRows}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Rows</p>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
                    <p className="text-lg font-extrabold text-emerald-400" data-testid="job-import-valid">{preview.validRows}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Valid</p>
                  </div>
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2">
                    <p className="text-lg font-extrabold text-rose-400 flex items-center justify-center gap-1" data-testid="job-import-invalid">
                      <AlertTriangle className="h-4 w-4" />{preview.invalidRows}
                    </p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Invalid</p>
                  </div>
                </div>

                {(preview.fileErrors.length > 0 || preview.errors.length > 0) && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                    <p className="text-xs font-bold text-rose-400 mb-2">Fix these and re-upload — nothing will be imported until then</p>
                    <ul className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-muted-foreground font-mono" data-testid="job-import-errors">
                      {preview.fileErrors.map((e) => (
                        <li key={e}>File: {e}</li>
                      ))}
                      {preview.errors.slice(0, 200).map((e, i) => (
                        <li key={`${e.rowNumber}-${i}`}>Row {e.rowNumber}: {e.message}</li>
                      ))}
                      {preview.errors.length > 200 && <li>…and {preview.errors.length - 200} more</li>}
                    </ul>
                  </div>
                )}

                {preview.preview.length > 0 && (
                  <div className="rounded-lg border border-white/10 p-3">
                    <p className="text-xs font-bold text-white mb-2">Will be created as Draft</p>
                    <ul className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-muted-foreground">
                      {preview.preview.slice(0, 200).map((p) => (
                        <li key={p.rowNumber}>
                          Row {p.rowNumber}: <span className="text-white font-semibold">{p.title}</span>
                          {p.company ? ` · ${p.company}` : ""}{p.location ? ` · ${p.location}` : ""} · {p.jobType} · /{p.slug}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="pt-4 border-t border-white/10">
          {done ? (
            <Button type="button" data-testid="job-import-close" onClick={() => { reset(); onOpenChange(false); }} className="bg-primary text-white text-xs font-bold">
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={() => { reset(); onOpenChange(false); }} disabled={runImport.isPending} className="border-white/10 text-xs font-bold">
                Cancel
              </Button>
              <Button type="button" variant="outline" disabled={!csv || runImport.isPending} onClick={() => runImport.mutate(true)} className="border-white/10 text-xs font-bold">
                {runImport.isPending && runImport.variables === true ? "Checking..." : preview ? "Re-check File" : "Check File"}
              </Button>
              <Button type="button" disabled={!canImport || runImport.isPending} onClick={() => runImport.mutate(false)} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">
                {runImport.isPending && runImport.variables === false ? "Importing..." : `Import ${preview?.validRows ?? 0} Jobs`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
