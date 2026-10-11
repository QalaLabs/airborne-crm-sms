"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  Landmark,
  Calendar,
  AlertTriangle,
  Clock,
  Phone,
  MessageSquare,
  Search,
  CheckCircle2,
  ExternalLink,
  ChevronRight,
  TrendingDown,
  DollarSign,
  Plus,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api";
import { formatDate, cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";

interface CollectionAdmission {
  id: string;
  applicationNo: string;
  stage: string;
  courseName?: string | null;
  feeAmount?: number | string | null;
  feeDiscount?: number | string | null;
  feeFinal?: number | string | null;
  feePaid?: number | string | null;
  feeBalance?: number | string | null;
  createdAt: string;
  batchStartDate?: string | null;
  leadId: string;
  lead?: { id: string; name: string; phone: string; email?: string } | null;
  student?: { id: string; studentCode: string; firstName: string; lastName: string; phone?: string; email?: string } | null;
  counselor?: { name: string } | null;
}

function money(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN")}` : "₹0";
}

export default function FinanceCollectionsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [remarkOpen, setRemarkOpen] = React.useState(false);
  const [selectedAdmission, setSelectedAdmission] = React.useState<CollectionAdmission | null>(null);
  const [remarkText, setRemarkText] = React.useState("");

  const { data: admissions = [], isLoading } = useQuery({
    queryKey: ["finance-collections-admissions"],
    queryFn: async () => {
      try {
        const res = await apiFetch<any>("/admissions?limit=100");
        const list = res?.data ?? (Array.isArray(res) ? res : []);
        return list.filter((a: CollectionAdmission) => Number(a.feeBalance ?? 0) > 0);
      } catch {
        return [];
      }
    },
  });

  const addRemarkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAdmission || !remarkText.trim()) return;
      return apiFetch(`/leads/${selectedAdmission.leadId}/activities`, {
        method: "POST",
        body: JSON.stringify({
          activityType: "NOTE",
          title: `Fee Collection Note: ${selectedAdmission.applicationNo}`,
          notes: `[Fee Collection]: ${remarkText.trim()}`,
        }),
      });
    },
    onSuccess: () => {
      toast({ title: "Remark Saved", description: "Logged to candidate's unified timeline." });
      setRemarkOpen(false);
      setRemarkText("");
      setSelectedAdmission(null);
      queryClient.invalidateQueries({ queryKey: ["finance-collections-admissions"] });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to save remark", description: err.message, variant: "destructive" });
    },
  });

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const filtered = React.useMemo(() => {
    if (!search.trim()) return admissions;
    const q = search.toLowerCase();
    return admissions.filter((a: CollectionAdmission) => {
      const name = a.student
        ? `${a.student.firstName} ${a.student.lastName}`.toLowerCase()
        : (a.lead?.name || "").toLowerCase();
      const phone = a.student?.phone || a.lead?.phone || "";
      const app = a.applicationNo.toLowerCase();
      const course = (a.courseName || "").toLowerCase();
      return name.includes(q) || phone.includes(q) || app.includes(q) || course.includes(q);
    });
  }, [admissions, search]);

  // Split into Due This Month vs Overdue
  const { dueThisMonth, overdueFees } = React.useMemo(() => {
    const dueThisMonthList: CollectionAdmission[] = [];
    const overdueList: CollectionAdmission[] = [];

    for (const a of filtered) {
      const created = new Date(a.createdAt);
      const isCreatedThisMonth = created.getMonth() === currentMonth && created.getFullYear() === currentYear;
      const isPastMonth = created < new Date(currentYear, currentMonth, 1);

      if (isCreatedThisMonth) {
        dueThisMonthList.push(a);
      } else {
        overdueList.push(a);
      }
    }

    return { dueThisMonth: dueThisMonthList, overdueFees: overdueList };
  }, [filtered, currentMonth, currentYear]);

  const totalOutstanding = admissions.reduce((s: number, a: CollectionAdmission) => s + Number(a.feeBalance ?? 0), 0);
  const totalDueMonth = dueThisMonth.reduce((s: number, a: CollectionAdmission) => s + Number(a.feeBalance ?? 0), 0);
  const totalOverdue = overdueFees.reduce((s: number, a: CollectionAdmission) => s + Number(a.feeBalance ?? 0), 0);

  return (
    <div className="space-y-6 p-6 pb-12">
      <PageHeader
        title="Fee Collections & Receivables"
        description="Monitor outstanding candidate balances, dues for the active cycle, and overdue collections."
        action={
          <div className="flex items-center gap-3">
            <Button size="sm" asChild className="bg-primary hover:bg-primary/90 text-white font-bold text-xs">
              <Link href="/payments">
                <DollarSign className="h-4 w-4 mr-1.5" /> Payments Ledger
              </Link>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="glass-card border-white/10 bg-slate-900/60 shadow-lg">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground font-semibold uppercase">Total Outstanding</p>
              <p className="text-2xl font-bold text-white mt-1">{money(totalOutstanding)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{admissions.length} active fee accounts</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Landmark className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10 bg-slate-900/60 shadow-lg">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-amber-400 font-semibold uppercase">Due This Month</p>
              <p className="text-2xl font-bold text-amber-400 mt-1">{money(totalDueMonth)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{dueThisMonth.length} candidate(s)</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Calendar className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10 bg-slate-900/60 shadow-lg">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-rose-400 font-semibold uppercase">Overdue Collections</p>
              <p className="text-2xl font-bold text-rose-400 mt-1">{money(totalOverdue)}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{overdueFees.length} overdue candidate(s)</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
              <AlertTriangle className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card border-white/10 bg-slate-900/60 shadow-lg">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs text-emerald-400 font-semibold uppercase">Recovery Status</p>
              <p className="text-2xl font-bold text-white mt-1">
                {totalOutstanding > 0 ? `${Math.round(((totalOutstanding - totalOverdue) / totalOutstanding) * 100)}%` : "100%"}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Current cycle on-track</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search candidate name, phone, application no..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 bg-secondary/40 border-white/10 text-xs font-semibold text-white"
          />
        </div>
      </div>

      {/* Table 1: Fees Due This Month */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-amber-400" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Fees Due This Month</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
              {dueThisMonth.length}
            </span>
          </div>
          <span className="text-xs font-bold font-mono text-amber-400">Total: {money(totalDueMonth)}</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-900/60 shadow-xl">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-900/90 text-[10px] uppercase font-bold text-muted-foreground border-b border-white/10">
              <tr>
                <th className="p-3">Student / Candidate</th>
                <th className="p-3">Application & Date</th>
                <th className="p-3">Program</th>
                <th className="p-3">Course Fees</th>
                <th className="p-3">Pending Amount</th>
                <th className="p-3">Counselor</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading collections...</td></tr>
              ) : dueThisMonth.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No candidate fees due in the current month.</td></tr>
              ) : (
                dueThisMonth.map((a) => {
                  const candidateName = a.student ? `${a.student.firstName} ${a.student.lastName}` : (a.lead?.name || "Candidate");
                  const phone = a.student?.phone || a.lead?.phone || "";
                  const cleanPhone = phone.replace(/[^0-9]/g, "");
                  const waNumber = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone.replace(/^0+/, "")}`;
                  return (
                    <tr key={a.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-3">
                        <p className="font-bold text-white">{candidateName}</p>
                        <p className="text-[11px] text-muted-foreground">{phone}</p>
                      </td>
                      <td className="p-3">
                        <Link href={`/admissions?id=${a.id}`} className="font-mono font-bold text-primary hover:underline">
                          {a.applicationNo}
                        </Link>
                        <p className="text-[10px] text-muted-foreground">{formatDate(a.createdAt)}</p>
                      </td>
                      <td className="p-3 text-slate-300 font-semibold">{a.courseName ?? "—"}</td>
                      <td className="p-3 font-mono">{money(a.feeFinal ?? a.feeAmount)}</td>
                      <td className="p-3 font-mono font-bold text-amber-400">{money(a.feeBalance)}</td>
                      <td className="p-3 text-muted-foreground">{a.counselor?.name ?? "—"}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] font-bold border-white/10 hover:bg-white/5"
                            onClick={() => {
                              setSelectedAdmission(a);
                              setRemarkOpen(true);
                            }}
                          >
                            <MessageSquare className="h-3 w-3 mr-1" /> Remark
                          </Button>
                          {phone && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10" asChild>
                              <a
                                href={`https://wa.me/${waNumber}?text=Dear%20${encodeURIComponent(candidateName)},%20greeting%20from%20Airborne%20Aviation%20Academy.%20This%20is%20a%20gentle%20reminder%20regarding%20your%20installment%20balance%20of%20${encodeURIComponent(money(a.feeBalance))}%20for%20Application%20${encodeURIComponent(a.applicationNo)}.`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                WhatsApp
                              </a>
                            </Button>
                          )}
                          <Button size="sm" className="h-7 text-[10px] font-bold bg-primary hover:bg-primary/90 text-white" asChild>
                            <Link href={`/admissions?id=${a.id}`}>
                              Pay
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Table 2: Overdue Fees */}
      <div className="space-y-3 pt-4">
        <div className="flex items-center justify-between border-b border-white/10 pb-2">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-rose-400 animate-pulse" />
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">Overdue Fees</h2>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20">
              {overdueFees.length}
            </span>
          </div>
          <span className="text-xs font-bold font-mono text-rose-400">Total Overdue: {money(totalOverdue)}</span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-white/10 bg-slate-900/60 shadow-xl">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-900/90 text-[10px] uppercase font-bold text-muted-foreground border-b border-white/10">
              <tr>
                <th className="p-3">Student / Candidate</th>
                <th className="p-3">Application & Date</th>
                <th className="p-3">Program</th>
                <th className="p-3">Course Fees</th>
                <th className="p-3">Overdue Amount</th>
                <th className="p-3">Counselor</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">Loading collections...</td></tr>
              ) : overdueFees.length === 0 ? (
                <tr><td colSpan={7} className="p-8 text-center text-muted-foreground">No overdue fee balances recorded. Excellent recovery!</td></tr>
              ) : (
                overdueFees.map((a) => {
                  const candidateName = a.student ? `${a.student.firstName} ${a.student.lastName}` : (a.lead?.name || "Candidate");
                  const phone = a.student?.phone || a.lead?.phone || "";
                  const cleanPhone = phone.replace(/[^0-9]/g, "");
                  const waNumber = cleanPhone.startsWith("91") ? cleanPhone : `91${cleanPhone.replace(/^0+/, "")}`;
                  return (
                    <tr key={a.id} className="hover:bg-white/5 transition-colors">
                      <td className="p-3">
                        <p className="font-bold text-white">{candidateName}</p>
                        <p className="text-[11px] text-muted-foreground">{phone}</p>
                      </td>
                      <td className="p-3">
                        <Link href={`/admissions?id=${a.id}`} className="font-mono font-bold text-primary hover:underline">
                          {a.applicationNo}
                        </Link>
                        <p className="text-[10px] text-muted-foreground">{formatDate(a.createdAt)}</p>
                      </td>
                      <td className="p-3 text-slate-300 font-semibold">{a.courseName ?? "—"}</td>
                      <td className="p-3 font-mono">{money(a.feeFinal ?? a.feeAmount)}</td>
                      <td className="p-3 font-mono font-bold text-rose-400">{money(a.feeBalance)}</td>
                      <td className="p-3 text-muted-foreground">{a.counselor?.name ?? "—"}</td>
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-[10px] font-bold border-white/10 hover:bg-white/5"
                            onClick={() => {
                              setSelectedAdmission(a);
                              setRemarkOpen(true);
                            }}
                          >
                            <MessageSquare className="h-3 w-3 mr-1" /> Remark
                          </Button>
                          {phone && (
                            <Button size="sm" variant="outline" className="h-7 text-[10px] font-bold border-rose-500/30 text-rose-400 hover:bg-rose-500/10" asChild>
                              <a
                                href={`https://wa.me/${waNumber}?text=URGENT:%20Dear%20${encodeURIComponent(candidateName)},%20this%20is%20from%20Airborne%20Aviation%20Academy%20Finance.%20Your%20fee%20installment%20of%20${encodeURIComponent(money(a.feeBalance))}%20is%20overdue.%20Please%20contact%20accounts%20to%20regularize%20your%20dossier.`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                Follow Up
                              </a>
                            </Button>
                          )}
                          <Button size="sm" className="h-7 text-[10px] font-bold bg-primary hover:bg-primary/90 text-white" asChild>
                            <Link href={`/admissions?id=${a.id}`}>
                              Pay
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Collection Remark Dialog */}
      <Dialog open={remarkOpen} onOpenChange={setRemarkOpen}>
        <DialogContent className="glass-panel border-white/10 bg-slate-900/95 max-w-md text-white">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              Add Collection Remark & Timeline Note
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground">
              Candidate: <span className="font-bold text-white">{selectedAdmission?.student ? `${selectedAdmission.student.firstName} ${selectedAdmission.student.lastName}` : (selectedAdmission?.lead?.name || "Cadet")}</span> ({selectedAdmission?.applicationNo})
            </p>

            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground font-semibold">Remark / Follow-up Commitment</Label>
              <Textarea
                rows={3}
                value={remarkText}
                onChange={(e) => setRemarkText(e.target.value)}
                placeholder="e.g. Spoke to father, committed to transfer ₹50,000 on Friday via NEFT..."
                className="bg-secondary/40 border-white/10 text-xs font-medium"
                autoFocus
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              This note automatically attaches to the candidate's unified audit timeline.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setRemarkOpen(false)} className="text-xs font-bold">
              Cancel
            </Button>
            <Button
              disabled={addRemarkMutation.isPending || !remarkText.trim()}
              onClick={() => addRemarkMutation.mutate()}
              className="bg-primary hover:bg-primary/90 text-white text-xs font-bold"
            >
              {addRemarkMutation.isPending ? "Logging..." : "Save Remark to Timeline"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
