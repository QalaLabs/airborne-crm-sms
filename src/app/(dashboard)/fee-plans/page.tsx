"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Receipt, Plus, Trash2, Pencil, X, Save, Check, IndianRupee, Clock } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { apiFetch } from "@/lib/api";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const PERCENT_PRESETS = [25, 50, 75, 100];

interface PlanItem {
  id: string;
  name: string;
  amount: number | string;
  percentOfFee?: number | string | null;
  dueOffsetDays?: number;
  sortOrder?: number;
}

interface CourseOption {
  id: string;
  title: string;
  fee?: number | string | null;
}

interface FeePlan {
  id: string;
  name: string;
  description?: string | null;
  currency?: string;
  isActive: boolean;
  createdAt: string;
  courseId?: string | null;
  course?: CourseOption | null;
  items?: PlanItem[];
  _count?: { admissions?: number };
}

function courseFee(course?: CourseOption | null): number | undefined {
  const n = Number(course?.fee);
  return course?.fee != null && Number.isFinite(n) && n > 0 ? n : undefined;
}

function percentSum(items: ItemDraft[]): number {
  return items.filter((i) => i.mode === "percent" && i.value !== "").reduce((acc, i) => acc + (Number(i.value) || 0), 0);
}

interface ItemDraft {
  key: string;
  name: string;
  mode: "amount" | "percent";
  value: string;
  dueOffsetDays: string;
}

function money(v: number | string | null | undefined) {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN")}` : "-";
}

function newItemDraft(): ItemDraft {
  return { key: crypto.randomUUID(), name: "", mode: "amount", value: "", dueOffsetDays: "0" };
}

function toInputItems(items: ItemDraft[]) {
  return items
    .filter((i) => i.name.trim() !== "" && i.value !== "")
    .map((i, idx) => ({
      name: i.name.trim(),
      amount: i.mode === "amount" ? Number(i.value) : undefined,
      percentOfFee: i.mode === "percent" ? Number(i.value) : undefined,
      dueOffsetDays: Number(i.dueOffsetDays) || 0,
      sortOrder: idx,
    }));
}

function fromPlanItems(items?: PlanItem[]): ItemDraft[] {
  return (items ?? []).map((it, idx) => ({
    key: it.id,
    name: it.name,
    mode: it.percentOfFee != null && Number(it.percentOfFee) > 0 ? "percent" : "amount",
    value: String(it.percentOfFee != null && Number(it.percentOfFee) > 0 ? it.percentOfFee : it.amount),
    dueOffsetDays: String(it.dueOffsetDays ?? 0),
  }));
}

function computeTotal(items: ItemDraft[], baseFee?: number) {
  let hasPercent = false;
  let total = 0;
  for (const i of items) {
    const v = Number(i.value) || 0;
    if (i.mode === "percent") {
      hasPercent = true;
      if (baseFee != null) total += (v / 100) * baseFee;
    } else {
      total += v;
    }
  }
  return { total, hasPercent };
}

export default function FeePlansPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
  const [creating, setCreating] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [courseFilter, setCourseFilter] = React.useState("");

  const { data: plans, isLoading, isError, error } = useQuery({
    queryKey: ["fee-plans", "all", courseFilter],
    queryFn: () =>
      apiFetch<FeePlan[]>(`/fee-plans?limit=100${courseFilter ? `&courseId=${encodeURIComponent(courseFilter)}` : ""}`),
  });

  const { data: courses } = useQuery({
    queryKey: ["fee-plans", "course-options"],
    queryFn: () => apiFetch<CourseOption[]>("/courses?limit=100"),
  });

  const toggleActive = async (plan: FeePlan) => {
    try {
      await apiFetch(`/fee-plans/${plan.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !plan.isActive }),
      });
      queryClient.invalidateQueries({ queryKey: ["fee-plans", "all"] });
      toast({ title: plan.isActive ? "Fee plan deactivated" : "Fee plan activated" });
    } catch (err) {
      toast({ title: "Update failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const deletePlan = async (plan: FeePlan) => {
    const linked = plan._count?.admissions ?? 0;
    const warning = linked
      ? ` ${linked} admission(s) use it; they keep their saved fee schedule but will no longer be linked to this plan.`
      : "";
    if (!window.confirm(`Permanently delete fee plan "${plan.name}"?${warning} This cannot be undone.`)) return;
    try {
      await apiFetch(`/fee-plans/${plan.id}`, { method: "DELETE" });
      if (editingId === plan.id) setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ["fee-plans", "all"] });
      toast({ title: "Fee plan deleted", description: plan.name });
    } catch (err) {
      toast({ title: "Delete failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Fee Plans"
        description="Installment schedules with fixed amounts or percent-of-course-fee items."
        action={
          !editingId && (
            <Button size="sm" className="text-xs font-bold" onClick={() => setCreating((c) => !c)}>
              {creating ? <X className="h-3.5 w-3.5 mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
              {creating ? "Cancel" : "New fee plan"}
            </Button>
          )
        }
      />

      <div className="flex items-center gap-2">
        <Label htmlFor="fee-plan-course-filter" className="text-[10px] font-bold text-muted-foreground">Course</Label>
        <select
          id="fee-plan-course-filter"
          data-testid="fee-plan-course-filter"
          value={courseFilter}
          onChange={(e) => setCourseFilter(e.target.value)}
          className="flex h-8 rounded-lg border border-white/10 bg-secondary/60 px-2 text-xs font-bold"
        >
          <option value="">All courses</option>
          {(courses ?? []).map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </div>

      {creating && (
        <PlanEditor
          courses={courses ?? []}
          onDone={() => {
            setCreating(false);
            queryClient.invalidateQueries({ queryKey: ["fee-plans", "all"] });
          }}
        />
      )}

      {editingId && plans?.some((p) => p.id === editingId) && (
        <PlanEditor
          key={editingId}
          courses={courses ?? []}
          initial={plans?.find((p) => p.id === editingId)}
          onDone={() => {
            setEditingId(null);
            queryClient.invalidateQueries({ queryKey: ["fee-plans", "all"] });
          }}
        />
      )}

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : isError ? (
        <div className="p-8 text-center text-sm text-rose-400">
          {error instanceof Error ? error.message : "Failed to load fee plans"}
        </div>
      ) : !plans?.length ? (
        <div className="p-8 text-center text-sm text-muted-foreground">No fee plans yet. Create your first one.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {plans.map((plan) => {
            const planCourseFee = courseFee(plan.course);
            const { total, hasPercent } = computeTotal(fromPlanItems(plan.items), planCourseFee);
            return (
              <div key={plan.id} data-testid={`fee-plan-card-${plan.id}`} className={cn("rounded-xl border p-4 space-y-3 bg-slate-900/60", plan.isActive ? "border-primary/30" : "border-white/10 opacity-80")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-white truncate">{plan.name}</p>
                    <p className="text-[10px] font-bold text-primary/80 truncate" data-testid="fee-plan-course">
                      {plan.course ? plan.course.title : "No course linked"}
                    </p>
                    {plan.description ? <p className="text-[11px] text-muted-foreground line-clamp-2">{plan.description}</p> : null}
                  </div>
                  <button
                    onClick={() => toggleActive(plan)}
                    className={cn(
                      "flex h-6 items-center rounded-full border px-2 text-[9px] font-extrabold uppercase tracking-wider",
                      plan.isActive
                        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                        : "border-white/10 bg-secondary/40 text-muted-foreground",
                    )}
                  >
                    {plan.isActive ? <Check className="h-3 w-3 mr-1" /> : <X className="h-3 w-3 mr-1" />}
                    {plan.isActive ? "Active" : "Inactive"}
                  </button>
                </div>

                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1"><Receipt className="h-3 w-3" /> {plan.items?.length ?? 0} items</span>
                  <span className="flex items-center gap-1"><IndianRupee className="h-3 w-3" /> {hasPercent && planCourseFee == null ? "Has % items" : money(total)}</span>
                  {plan._count?.admissions ? <span>{plan._count.admissions} admissions</span> : null}
                </div>

                {plan.items?.length ? (
                  <div className="space-y-1 border-l border-white/10 pl-2">
                    {plan.items.slice(0, 5).map((it) => (
                      <p key={it.id} className="text-[10px] text-muted-foreground">
                        • {it.name}:{" "}
                        {it.percentOfFee != null && Number(it.percentOfFee) > 0
                          ? `${it.percentOfFee}% of course fee`
                          : money(it.amount)}
                        {it.dueOffsetDays ? ` · due +${it.dueOffsetDays}d` : ""}
                      </p>
                    ))}
                    {(plan.items?.length ?? 0) > 5 ? <p className="text-[10px] text-muted-foreground/60">+{(plan.items?.length ?? 0) - 5} more</p> : null}
                  </div>
                ) : null}

                <div className="flex items-center justify-between pt-2 border-t border-white/10">
                  <p className="text-[10px] text-muted-foreground">Created {plan.createdAt.slice(0, 10)}</p>
                  <div className="flex items-center gap-1.5">
                    {isSuperAdmin && (
                      <Button
                        variant="outline"
                        size="sm"
                        data-testid={`fee-plan-delete-${plan.id}`}
                        className="h-7 text-[11px] border-rose-500/30 text-rose-400 hover:text-rose-300"
                        onClick={() => void deletePlan(plan)}
                      >
                        <Trash2 className="h-3 w-3 mr-1" /> Delete
                      </Button>
                    )}
                    <Button variant="outline" size="sm" className="h-7 text-[11px] border-white/10" onClick={() => setEditingId(plan.id)}>
                      <Pencil className="h-3 w-3 mr-1" /> Edit
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlanEditor({
  initial,
  courses,
  onDone,
}: {
  initial?: FeePlan;
  courses: CourseOption[];
  onDone: () => void;
}) {
  const [name, setName] = React.useState(initial?.name ?? "");
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [courseId, setCourseId] = React.useState(initial?.courseId ?? "");
  const [items, setItems] = React.useState<ItemDraft[]>(initial?.items?.length ? fromPlanItems(initial.items) : [newItemDraft()]);
  const [baseFee, setBaseFee] = React.useState(() => {
    const fee = courseFee(initial?.course);
    return fee != null ? String(fee) : "";
  });
  const [saving, setSaving] = React.useState(false);

  const { total, hasPercent } = computeTotal(items, baseFee ? Number(baseFee) : undefined);
  const pctSum = percentSum(items);
  const pctInvalid = hasPercent && Math.abs(pctSum - 100) > 0.01;

  const selectCourse = (id: string) => {
    setCourseId(id);
    const fee = courseFee(courses.find((c) => c.id === id));
    if (fee != null) setBaseFee(String(fee));
  };

  const setItem = (key: string, patch: Partial<ItemDraft>) => {
    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, ...patch } : i)));
  };

  const save = async () => {
    if (!name.trim()) {
      toast({ title: "Plan name is required", variant: "destructive" });
      return;
    }
    const inputItems = toInputItems(items);
    if (!inputItems.length) {
      toast({ title: "Add at least one item", variant: "destructive" });
      return;
    }
    if (inputItems.some((i) => i.amount != null && i.amount > 9_999_999.99)) {
      toast({ title: "Amount exceeds max ₹99,99,999.99", variant: "destructive" });
      return;
    }
    if (inputItems.some((i) => i.percentOfFee != null && i.percentOfFee > 100)) {
      toast({ title: "Percent cannot exceed 100", variant: "destructive" });
      return;
    }
    if (pctInvalid) {
      toast({ title: `Percentage items must add up to 100% (currently ${Number(pctSum.toFixed(2))}%)`, variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      if (initial) {
        await apiFetch(`/fee-plans/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name,
            description: description || null,
            courseId: courseId || null,
            items: inputItems,
          }),
        });
        toast({ title: "Fee plan updated" });
      } else {
        await apiFetch("/fee-plans", {
          method: "POST",
          body: JSON.stringify({ name, description: description || undefined, courseId: courseId || null, items: inputItems }),
        });
        toast({ title: "Fee plan created" });
      }
      onDone();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-slate-900/70 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Receipt className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-bold text-white">{initial ? `Edit: ${initial.name}` : "New fee plan"}</h3>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] font-bold text-muted-foreground">Plan name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs bg-secondary/40 border-white/10" placeholder="e.g. 3 Installments with down payment" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="fee-plan-course" className="text-[10px] font-bold text-muted-foreground">Linked course</Label>
          <select
            id="fee-plan-course"
            data-testid="fee-plan-course-select"
            value={courseId}
            onChange={(e) => selectCourse(e.target.value)}
            className="flex h-8 w-full rounded-lg border border-white/10 bg-secondary/60 px-2 text-xs font-bold"
          >
            <option value="">No course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.title}{courseFee(c) != null ? ` · ${money(c.fee)}` : ""}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] font-bold text-muted-foreground">
            Course fee for preview (% items) · current total {money(total)}
          </Label>
          <Input type="number" min="0" step="0.01" value={baseFee} onChange={(e) => setBaseFee(e.target.value)} className="h-8 text-xs bg-secondary/40 border-white/10" placeholder="Pick a course or enter a fee" />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-[10px] font-bold text-muted-foreground">Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-[60px] text-xs bg-secondary/40 border-white/10" placeholder="Optional note about this schedule" />
        </div>
      </div>

      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={item.key} className="grid grid-cols-12 gap-2 items-end rounded-lg border border-white/10 bg-secondary/30 p-2">
            <div className="col-span-12 md:col-span-3 space-y-1">
              <Label className="text-[9px] font-bold text-muted-foreground">{idx + 1}. Item name</Label>
              <Input value={item.name} onChange={(e) => setItem(item.key, { name: e.target.value })} className="h-8 text-xs bg-secondary/40 border-white/10" placeholder="e.g. Tuition install 1" />
            </div>
            <div className="col-span-4 md:col-span-2 space-y-1">
              <Label className="text-[9px] font-bold text-muted-foreground">Type</Label>
              <select value={item.mode} onChange={(e) => setItem(item.key, { mode: e.target.value as "amount" | "percent", value: "" })} className="flex h-8 w-full rounded-lg border border-white/10 bg-secondary/60 px-2 text-xs font-bold">
                <option value="amount">Fixed ₹</option>
                <option value="percent">% of fee</option>
              </select>
            </div>
            <div className="col-span-4 md:col-span-3 space-y-1">
              <Label className="text-[9px] font-bold text-muted-foreground">{item.mode === "amount" ? "Amount (₹)" : "Percent (%)"}</Label>
              <Input type="number" min="0" max={item.mode === "amount" ? 9999999.99 : 100} step={item.mode === "amount" ? "0.01" : "1"} value={item.value} onChange={(e) => setItem(item.key, { value: e.target.value })} className="h-8 text-xs bg-secondary/40 border-white/10" placeholder={item.mode === "amount" ? "0.00" : "0"} />
            </div>
            <div className="col-span-4 md:col-span-2 space-y-1">
              <Label className="text-[9px] font-bold text-muted-foreground">Due +days</Label>
              <div className="relative">
                <Clock className="h-3 w-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input type="number" min="0" step="1" value={item.dueOffsetDays} onChange={(e) => setItem(item.key, { dueOffsetDays: e.target.value })} className="h-8 pl-7 text-xs bg-secondary/40 border-white/10" />
              </div>
            </div>
            <div className="col-span-12 md:col-span-2 flex items-center justify-end md:justify-between gap-2">
              {item.mode === "percent" && (
                <div className="flex gap-1">
                  {PERCENT_PRESETS.map((p) => (
                    <button key={p} type="button" onClick={() => setItem(item.key, { value: String(p) })} className={cn("h-6 rounded-md border px-1.5 text-[10px] font-bold", item.value === String(p) ? "border-primary/40 bg-primary/20 text-white" : "border-white/10 text-muted-foreground hover:text-white")}>
                      {p}%
                    </button>
                  ))}
                </div>
              )}
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-400" disabled={items.length <= 1} onClick={() => setItems((prev) => prev.filter((i) => i.key !== item.key))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="h-8 text-xs border-white/10" onClick={() => setItems((prev) => [...prev, newItemDraft()])}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Add item
          </Button>
          <p className="text-[11px] text-muted-foreground">
            {hasPercent ? (
              <>
                {baseFee ? (
                  <>Total at {money(baseFee)} course fee: <span className="font-bold text-white">{money(total)}</span> · </>
                ) : null}
                <span className={cn(pctInvalid ? "text-rose-400 font-bold" : "")} data-testid="fee-plan-percent-sum">
                  % items sum {Number(pctSum.toFixed(2))}%{pctInvalid ? " (must be 100%)" : ""}
                </span>
              </>
            ) : (
              <>
                Plan total: <span className="font-bold text-white">{money(total)}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={onDone}>Cancel</Button>
          <Button size="sm" className="h-8 text-xs font-bold" disabled={saving} onClick={save}>
            <Save className="h-3.5 w-3.5 mr-1" /> {saving ? "Saving…" : initial ? "Save changes" : "Create plan"}
          </Button>
        </div>
      </div>
    </div>
  );
}