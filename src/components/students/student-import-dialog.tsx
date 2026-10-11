"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import {
  MAX_STUDENT_IMPORT_BYTES,
  MAX_STUDENT_IMPORT_ROWS,
  STUDENT_IMPORT_COLUMNS,
  STUDENT_IMPORT_TEMPLATE,
} from "@/lib/students/student-import";
import { toast } from "@/components/ui/use-toast";

interface StudentImportReport {
  dryRun: boolean;
  committed: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  fileErrors: string[];
  errors: { rowNumber: number; column?: string; message: string }[];
  preview: { rowNumber: number; name: string; email: string; phone: string; campus: string | null }[];
  created: { id: string; studentCode: string; email: string }[];
}

function downloadTemplate() {
  const blob = new Blob(["\uFEFF" + STUDENT_IMPORT_TEMPLATE], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "student-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function StudentImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [file, setFile] = React.useState<File | null>(null);
  const [preview, setPreview] = React.useState<StudentImportReport | null>(null);
  const [done, setDone] = React.useState<StudentImportReport | null>(null);
  const [failure, setFailure] = React.useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    setDone(null);
    setFailure(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const runImport = useMutation({
    mutationFn: (dryRun: boolean) => {
      const form = new FormData();
      form.append("file", file!);
      form.append("dryRun", String(dryRun));
      return apiFetch<StudentImportReport>("/students/import", { method: "POST", body: form });
    },
    onSuccess: (result) => {
      setFailure(null);
      if (result.dryRun) {
        setPreview(result);
        return;
      }
      setDone(result);
      queryClient.invalidateQueries({ queryKey: ["students"] });
      toast({ title: "Import complete", description: `${result.created.length} students created.` });
    },
    onError: (err) => setFailure(err.message),
  });

  const handleFile = (f: File) => {
    setPreview(null);
    setDone(null);
    if (!f.name.toLowerCase().endsWith(".csv")) {
      setFile(null);
      setFailure("Only .csv files can be imported. In Excel use File → Save As → CSV UTF-8.");
      return;
    }
    if (f.size > MAX_STUDENT_IMPORT_BYTES) {
      setFile(null);
      setFailure(`File is larger than ${Math.round(MAX_STUDENT_IMPORT_BYTES / 1000)} KB.`);
      return;
    }
    setFailure(null);
    setFile(f);
  };

  const canImport = !!preview && preview.fileErrors.length === 0 && preview.invalidRows === 0 && preview.validRows > 0;
  const close = () => {
    reset();
    onOpenChange(false);
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
      <DialogContent className="max-w-2xl glass-panel border-white/10 bg-slate-900/95" data-testid="student-import-dialog">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Bulk Upload Students (CSV)
          </DialogTitle>
          <DialogDescription className="text-xs">
            Up to {MAX_STUDENT_IMPORT_ROWS} students per file, validated with the same rules as Add Student. The import is
            all-or-nothing: if any row is invalid or a duplicate, nothing is saved until the file is fixed.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 py-2" data-testid="student-import-done">
            <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-400" />
              <p className="text-sm font-bold text-white">{done.created.length} students imported</p>
            </div>
            <ul className="max-h-40 overflow-y-auto text-[11px] text-muted-foreground font-mono space-y-1">
              {done.created.map((s) => (
                <li key={s.id}>{s.studentCode} — {s.email}</li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Required: <span className="font-bold text-foreground">{STUDENT_IMPORT_COLUMNS.filter((c) => c.required).map((c) => c.key).join(", ")}</span>.
                Optional: {STUDENT_IMPORT_COLUMNS.filter((c) => !c.required).map((c) => c.key).join(", ")}.
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
              <p className="text-sm font-bold text-white" data-testid="student-import-filename">{file?.name ?? "Choose a CSV file"}</p>
              <p className="text-xs text-muted-foreground mt-1">UTF-8 CSV, up to {MAX_STUDENT_IMPORT_ROWS} students / {Math.round(MAX_STUDENT_IMPORT_BYTES / 1000)} KB</p>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="student-import-file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />

            {failure && (
              <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300" data-testid="student-import-failure">
                {failure}
              </p>
            )}

            {preview && (
              <div className="space-y-3" data-testid="student-import-preview">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-lg border border-white/10 bg-secondary/30 p-2">
                    <p className="text-lg font-extrabold text-white" data-testid="student-import-total">{preview.totalRows}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Rows</p>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
                    <p className="text-lg font-extrabold text-emerald-400" data-testid="student-import-valid">{preview.validRows}</p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Valid</p>
                  </div>
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2">
                    <p className="text-lg font-extrabold text-rose-400 flex items-center justify-center gap-1" data-testid="student-import-invalid">
                      <AlertTriangle className="h-4 w-4" />{preview.invalidRows}
                    </p>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase">Invalid</p>
                  </div>
                </div>

                {(preview.fileErrors.length > 0 || preview.errors.length > 0) && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                    <p className="text-xs font-bold text-rose-400 mb-2">Fix these and re-upload — nothing will be imported until then</p>
                    <ul className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-muted-foreground font-mono" data-testid="student-import-errors">
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
                    <p className="text-xs font-bold text-white mb-2">Students that will be created</p>
                    <ul className="max-h-40 overflow-y-auto space-y-1 text-[11px] text-muted-foreground">
                      {preview.preview.slice(0, MAX_STUDENT_IMPORT_ROWS).map((p) => (
                        <li key={p.rowNumber}>
                          Row {p.rowNumber}: <span className="text-white font-semibold">{p.name}</span> · {p.email} · {p.phone}
                          {p.campus ? ` · ${p.campus}` : ""}
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
            <Button type="button" data-testid="student-import-close" onClick={close} className="bg-primary text-white text-xs font-bold">
              Close
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close} disabled={runImport.isPending} className="border-white/10 text-xs font-bold">
                Cancel
              </Button>
              <Button type="button" variant="outline" disabled={!file || runImport.isPending} onClick={() => runImport.mutate(true)} className="border-white/10 text-xs font-bold">
                {runImport.isPending && runImport.variables === true ? "Checking..." : preview ? "Re-check File" : "Check File"}
              </Button>
              <Button type="button" disabled={!canImport || runImport.isPending} onClick={() => runImport.mutate(false)} className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold">
                {runImport.isPending && runImport.variables === false ? "Importing..." : `Import ${preview?.validRows ?? 0} Students`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
