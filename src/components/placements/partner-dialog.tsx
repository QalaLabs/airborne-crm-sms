"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/use-toast";

export interface PartnerRecord {
  id: string;
  name: string;
  slug: string;
  website?: string | null;
  industry?: string | null;
  description?: string | null;
  isActive: boolean;
}

const CODE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function emptyForm(p: PartnerRecord | null) {
  return {
    name: p?.name ?? "",
    slug: p?.slug ?? "",
    website: p?.website ?? "",
    industry: p?.industry ?? "",
    description: p?.description ?? "",
    isActive: p?.isActive ?? true,
  };
}

export function PartnerDialog({
  open,
  partner,
  onClose,
}: {
  open: boolean;
  partner: PartnerRecord | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = React.useState(() => emptyForm(partner));
  const [error, setError] = React.useState<string | null>(null);
  const isEdit = !!partner;

  React.useEffect(() => {
    if (open) {
      setForm(emptyForm(partner));
      setError(null);
    }
  }, [open, partner]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      isEdit
        ? apiFetch<PartnerRecord>(`/hiring-partners/${partner!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : apiFetch<PartnerRecord>("/hiring-partners", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: (saved) => {
      queryClient.invalidateQueries({ queryKey: ["hiring-partners"] });
      toast({ title: isEdit ? "Airline partner updated" : "Airline partner added", description: saved.name });
      onClose();
    },
    onError: (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const name = form.name.trim();
    const slug = form.slug.trim();
    if (!name) return setError("Partner name is required.");
    if (slug && !CODE_PATTERN.test(slug)) return setError("Code must be lowercase letters, digits and single hyphens.");
    setError(null);
    const body: Record<string, unknown> = {
      name,
      website: form.website.trim(),
      industry: form.industry.trim(),
      description: form.description.trim(),
      isActive: form.isActive,
    };
    if (slug) body.slug = slug;
    if (!isEdit) {
      // Create schema treats these as optional, not clearable.
      for (const k of ["website", "industry", "description"]) if (!body[k]) delete body[k];
    }
    save.mutate(body);
  };

  const set = (k: keyof ReturnType<typeof emptyForm>) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md glass-panel border-white/10 bg-slate-900/95" data-testid="partner-dialog">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            {isEdit ? "Edit Airline Partner" : "Add Airline Partner"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="partner-name" className="text-xs font-bold text-muted-foreground">Airline / partner name *</Label>
            <Input id="partner-name" value={form.name} onChange={set("name")} maxLength={255} required className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="partner-code" className="text-xs font-bold text-muted-foreground">Directory code</Label>
            <Input id="partner-code" value={form.slug} onChange={set("slug")} placeholder={isEdit ? "" : "Generated from the name if empty"} maxLength={255} className="bg-secondary/40 border-white/10 text-xs font-mono text-white" />
            <p className="text-[10px] text-muted-foreground">Unique within the directory. Lowercase letters, digits and hyphens.</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="partner-website" className="text-xs font-bold text-muted-foreground">Website / careers portal</Label>
            <Input id="partner-website" type="url" value={form.website} onChange={set("website")} placeholder="https://" maxLength={500} className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="partner-industry" className="text-xs font-bold text-muted-foreground">Industry / segment</Label>
            <Input id="partner-industry" value={form.industry} onChange={set("industry")} placeholder="e.g. Commercial airline" maxLength={100} className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="partner-description" className="text-xs font-bold text-muted-foreground">Description</Label>
            <Textarea id="partner-description" value={form.description} onChange={set("description")} rows={3} maxLength={5000} className="bg-secondary/40 border-white/10 text-xs text-white" />
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
              aria-label="Hiring active"
            />
            Hiring active
          </label>
          {error && (
            <p className="text-xs text-rose-400" data-testid="partner-error">{error}</p>
          )}
          <DialogFooter className="pt-3 border-t border-white/10">
            <Button type="button" variant="outline" onClick={onClose} className="border-white/10 hover:bg-white/5 text-xs font-bold">Cancel</Button>
            <Button type="submit" disabled={save.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold">
              {save.isPending ? "Saving…" : isEdit ? "Save Changes" : "Add Partner"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
