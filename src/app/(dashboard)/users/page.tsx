"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Users, Shield, Plus, UserX, UserCheck, Link2, Copy, Check } from "lucide-react";
import { motion } from "framer-motion";
import { toast } from "@/components/ui/use-toast";
import { getInitials } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

const ROLES = [
  "SUPER_ADMIN",
  "ADMIN",
  "MARKETING_MANAGER",
  "CONTENT_MANAGER",
  "ADMISSIONS_COUNSELOR",
  "PLACEMENT_MANAGER",
  "SUPPORT_STAFF",
  "TEACHER",
  "STUDENT",
];

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Admin",
  MARKETING_MANAGER: "Marketing Manager",
  CONTENT_MANAGER: "Content Manager",
  ADMISSIONS_COUNSELOR: "Admissions Counselor",
  PLACEMENT_MANAGER: "Placement Manager",
  SUPPORT_STAFF: "Support Staff",
  TEACHER: "Teacher",
  STUDENT: "Student",
};

const PAGE_SIZE = 20;

interface SystemUser {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  isActive: boolean;
  lastLoginAt?: string | null;
  campusId?: string | null;
  campus?: { id: string; name: string; code?: string } | null;
}

interface Campus {
  id: string;
  name: string;
  code?: string;
}

interface UsersResponse {
  users: SystemUser[];
  total: number;
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";

  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("");
  const [campusFilter, setCampusFilter] = React.useState("");
  const [activeFilter, setActiveFilter] = React.useState("all");
  const [page, setPage] = React.useState(1);

  const [editingUser, setEditingUser] = React.useState<SystemUser | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [deactivateTarget, setDeactivateTarget] = React.useState<SystemUser | null>(null);
  const [reactivateTarget, setReactivateTarget] = React.useState<SystemUser | null>(null);
  const [inviteResult, setInviteResult] = React.useState<{ name: string; email: string; link: string; emailStatus?: string; emailError?: string } | null>(null);
  const [copied, setCopied] = React.useState(false);

  const { data: campuses = [] } = useQuery<Campus[]>({
    queryKey: ["campuses"],
    queryFn: () => apiFetch("/organizations/campuses"),
  });

  const { data = { users: [], total: 0 }, isLoading, error } = useQuery<UsersResponse>({
    queryKey: ["users", search, roleFilter, campusFilter, activeFilter, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (roleFilter) params.set("role", roleFilter);
      if (campusFilter) params.set("campusId", campusFilter);
      if (activeFilter !== "all") params.set("isActive", activeFilter === "active" ? "true" : "false");
      params.set("page", String(page));
      params.set("limit", String(PAGE_SIZE));
      const res = await fetch(`/api/v1/users?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load users");
      const payload = (await res.json()) as { data?: SystemUser[]; meta?: { total?: number } };
      return { users: payload.data ?? [], total: payload.meta?.total ?? 0 };
    },
  });

  const users = data.users;
  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  const { data: stats = [] } = useQuery<SystemUser[]>({
    queryKey: ["users-stats"],
    queryFn: () => apiFetch("/users?limit=100"),
  });
  const activeCount = stats.filter((u) => u.isActive).length;
  const superAdminCount = stats.filter((u) => u.role === "SUPER_ADMIN").length;

  const inviteMutation = useMutation({
    mutationFn: (body: { email: string; name: string; role: string; campusId?: string }) =>
      apiFetch<SystemUser & { inviteToken?: string; inviteLink?: string; emailStatus?: string; emailError?: string }>(
        "/users?action=invite",
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["users-stats"] });
      setInviteOpen(false);
      if (user.inviteToken) {
        setInviteResult({
          name: user.name,
          email: user.email,
          link: user.inviteLink ?? `${window.location.origin}/invite/${user.inviteToken}`,
          emailStatus: user.emailStatus,
          emailError: user.emailError,
        });
      } else {
        toast({ title: "Invite created" });
      }
    },
    onError: (err: unknown) => toast({ title: "Invite failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: (body: { email: string; name: string; role: string; password: string; phone?: string; campusId?: string }) =>
      apiFetch("/users", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["users-stats"] });
      toast({ title: "User created" });
      setCreateOpen(false);
    },
    onError: (err: unknown) => toast({ title: "Create failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiFetch(`/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["users-stats"] });
      toast({ title: "User updated" });
      setEditingUser(null);
    },
    onError: (err: unknown) => toast({ title: "Update failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["users-stats"] });
      toast({ title: "User deactivated" });
      setDeactivateTarget(null);
    },
    onError: (err: unknown) => toast({ title: "Deactivate failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/users/${id}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users"] });
      queryClient.invalidateQueries({ queryKey: ["users-stats"] });
      toast({ title: "User reactivated" });
      setReactivateTarget(null);
    },
    onError: (err: unknown) => toast({ title: "Reactivation failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" }),
  });

  // Only SUPER_ADMIN may see/assign SUPER_ADMIN. ADMIN and below get a safe dropdown.
  const selectableRoles = isSuperAdmin ? ROLES : ROLES.filter((r) => r !== "SUPER_ADMIN");

  const handleInvite = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    inviteMutation.mutate({
      email: String(form.get("email")),
      name: String(form.get("name")),
      role: String(form.get("role")),
      ...(form.get("campusId") ? { campusId: String(form.get("campusId")) } : {}),
    });
  };

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    createMutation.mutate({
      email: String(form.get("email")),
      name: String(form.get("name")),
      role: String(form.get("role")),
      password: String(form.get("password")),
      ...(form.get("phone") ? { phone: String(form.get("phone")) } : {}),
      ...(form.get("campusId") ? { campusId: String(form.get("campusId")) } : {}),
    });
  };

  const handleUpdate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingUser) return;
    const form = new FormData(e.currentTarget);
    const body: Record<string, unknown> = { name: String(form.get("name")) };
    if (form.get("phone")) body.phone = String(form.get("phone"));
    if (isSuperAdmin) body.role = String(form.get("role"));
    const campusId = form.get("campusId");
    body.campusId = campusId ? String(campusId) : null;
    updateMutation.mutate({ id: editingUser.id, body });
  };

  const copyInviteLink = async () => {
    if (!inviteResult) return;
    try {
      await navigator.clipboard.writeText(inviteResult.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: "Copy failed", description: "Copy the link manually.", variant: "destructive" });
    }
  };

  const resetFilters = () => {
    setSearch("");
    setRoleFilter("");
    setCampusFilter("");
    setActiveFilter("all");
    setPage(1);
  };

  if (isLoading) return <div className="p-6 text-white text-xs">Loading users...</div>;
  if (error) return <div className="p-6 text-red-500 font-bold">Error loading users: {error instanceof Error ? error.message : String(error)}</div>;

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        title="User Management"
        description="Manage staff accounts, roles, and access."
        action={
          <div className="flex items-center gap-2">
            <Button onClick={() => setCreateOpen(true)} variant="outline" className="border-white/10 hover:bg-white/5 text-xs font-bold text-white">
              <Plus className="h-4 w-4 mr-2" />
              Create User
            </Button>
            <Button onClick={() => setInviteOpen(true)} className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20 transition-all hover:scale-105 text-xs font-bold">
              <Plus className="h-4 w-4 mr-2" />
              Invite User
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {[
          { title: "Active Users", value: String(activeCount), color: "text-emerald-400", bg: "bg-emerald-500/10", icon: Users },
          { title: "Super Admins", value: String(superAdminCount), color: "text-amber-400", bg: "bg-amber-500/10", icon: Shield },
        ].map((kpi) => {
          const Icon = kpi.icon;
          return (
            <motion.div key={kpi.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="glass-card rounded-2xl p-5 flex items-center justify-between">
              <div>
                <span className="text-xs font-semibold text-muted-foreground">{kpi.title}</span>
                <div className="text-2xl font-bold text-white tracking-tight mt-1">{kpi.value}</div>
              </div>
              <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${kpi.bg} ${kpi.color}`}>
                <Icon className="h-4 w-4" />
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-white/10 pb-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" /> Staff Directory
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder="Search by name, email..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="bg-secondary/40 border-white/10 text-xs font-semibold w-56 text-white" />
            <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
              <option value="">All roles</option>
              {ROLES.map((r) => <option key={r} value={r} className="bg-slate-900">{ROLE_LABELS[r]}</option>)}
            </select>
            <select value={campusFilter} onChange={(e) => { setCampusFilter(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
              <option value="">All campuses</option>
              {campuses.map((c) => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
            </select>
            <select value={activeFilter} onChange={(e) => { setActiveFilter(e.target.value); setPage(1); }} className="h-9 rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
              <option value="all">All status</option>
              <option value="active" className="bg-slate-900">Active</option>
              <option value="inactive" className="bg-slate-900">Deactivated</option>
            </select>
            {(search || roleFilter || campusFilter || activeFilter !== "all") && (
              <Button size="sm" variant="ghost" onClick={resetFilters} className="text-xs font-bold text-muted-foreground hover:text-white">
                Clear
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3 pt-2">
          {users.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-8">No users found.</p>
          )}
          {users.map((usr) => (
            <div key={usr.id} className="flex flex-col md:flex-row md:items-center justify-between p-5 rounded-2xl bg-secondary/30 border border-white/5 hover:border-white/10 transition-all gap-4">
              <div className="flex items-center gap-4 min-w-0">
                <Avatar className="h-12 w-12 border border-primary/30 shadow-md">
                  <AvatarFallback className="bg-primary/20 text-primary font-bold text-sm">{getInitials(usr.name)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <span className="text-sm font-bold text-white truncate">{usr.name}</span>
                    <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${usr.role === "SUPER_ADMIN" ? "bg-amber-500/20 text-amber-400 border-amber-500/30" : "bg-blue-500/20 text-blue-400 border-blue-500/30"}`}>
                      {ROLE_LABELS[usr.role] ?? usr.role}
                    </span>
                    {!usr.isActive && (
                      <span className="text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border bg-secondary text-muted-foreground border-white/10">
                        Deactivated
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {usr.email}{usr.campus?.name ? ` • ${usr.campus.name}` : ""}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0 border-t md:border-t-0 pt-3 md:pt-0 border-white/10 justify-end">
                <Button size="sm" onClick={() => setEditingUser(usr)} variant="outline" className="border-white/10 hover:bg-white/5 text-xs font-bold text-white py-1 px-3 h-8">
                  Edit
                </Button>
                {!usr.isActive ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs font-bold text-emerald-400 hover:bg-emerald-500/10 py-1 px-3 h-8"
                    onClick={() => setReactivateTarget(usr)}
                  >
                    <UserCheck className="h-3.5 w-3.5 mr-1.5" /> Reactivate
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs font-bold text-rose-400 hover:bg-rose-500/10 py-1 px-3 h-8"
                    onClick={() => setDeactivateTarget(usr)}
                  >
                    <UserX className="h-3.5 w-3.5 mr-1.5" /> Deactivate
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-white/10 pt-4">
            <p className="text-xs text-muted-foreground">
              Page {page} of {totalPages} · {data.total} users
            </p>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="border-white/10 hover:bg-white/5 text-xs font-bold text-white h-8 px-3" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                Previous
              </Button>
              <Button size="sm" variant="outline" className="border-white/10 hover:bg-white/5 text-xs font-bold text-white h-8 px-3" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                Next
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Edit User Dialog */}
      <Dialog open={!!editingUser} onOpenChange={(o) => !o && setEditingUser(null)}>
        <DialogContent className="max-w-lg glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Edit {editingUser?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Full Name</label>
              <Input name="name" defaultValue={editingUser?.name} required className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Phone</label>
              <Input name="phone" defaultValue={editingUser?.phone ?? ""} className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            {isSuperAdmin && (
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-muted-foreground">Role</label>
                <select name="role" defaultValue={editingUser?.role} className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                  {ROLES.map((r) => <option key={r} value={r} className="bg-slate-900">{ROLE_LABELS[r]}</option>)}
                </select>
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Campus</label>
              <select name="campusId" defaultValue={editingUser?.campusId ?? ""} className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                <option value="">No campus</option>
                {campuses.map((c) => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
              </select>
            </div>
            <DialogFooter className="pt-4 border-t border-white/10">
              <Button type="button" variant="outline" onClick={() => setEditingUser(null)} className="border-white/10 hover:bg-white/5 text-xs font-bold">Cancel</Button>
              <Button type="submit" disabled={updateMutation.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Invite User Dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="max-w-lg glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Invite User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleInvite} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Full Name *</label>
              <Input name="name" required className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Work Email *</label>
              <Input name="email" type="email" required className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Role</label>
              <select name="role" defaultValue="SUPPORT_STAFF" className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                {selectableRoles.map((r) => <option key={r} value={r} className="bg-slate-900">{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Campus</label>
              <select name="campusId" className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                <option value="">No campus</option>
                {campuses.map((c) => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
              </select>
            </div>
            <div className="rounded-lg border border-white/10 bg-secondary/30 p-3 text-xs text-muted-foreground">
              An invitation email with a set-password link is sent to this address. The link is also shown after creating the invite in case you need to share it manually.
            </div>
            <DialogFooter className="pt-4 border-t border-white/10">
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)} className="border-white/10 hover:bg-white/5 text-xs font-bold">Cancel</Button>
              <Button type="submit" disabled={inviteMutation.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
                {inviteMutation.isPending ? "Creating..." : "Create Invite"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Create User</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Full Name *</label>
              <Input name="name" required className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Work Email *</label>
              <Input name="email" type="email" required className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Temporary Password *</label>
              <Input name="password" type="password" required minLength={8} className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Phone</label>
              <Input name="phone" className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Role</label>
              <select name="role" defaultValue="SUPPORT_STAFF" className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                {selectableRoles.map((r) => <option key={r} value={r} className="bg-slate-900">{ROLE_LABELS[r]}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-muted-foreground">Campus</label>
              <select name="campusId" className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary">
                <option value="">No campus</option>
                {campuses.map((c) => <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>)}
              </select>
            </div>
            <DialogFooter className="pt-4 border-t border-white/10">
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} className="border-white/10 hover:bg-white/5 text-xs font-bold">Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
                {createMutation.isPending ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Invite Link Dialog */}
      <Dialog open={!!inviteResult} onOpenChange={(o) => !o && setInviteResult(null)}>
        <DialogContent className="max-w-lg glass-panel border-white/10 bg-slate-900/95">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white">Invitation created</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <p className="text-xs text-muted-foreground">
              Invite created for <span className="text-white font-bold">{inviteResult?.email}</span> ({inviteResult?.name}).
            </p>
            {inviteResult?.emailStatus === "SENT" ? (
              <div data-testid="invite-email-status" className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-400">
                Invitation email sent. The link below expires in 7 days and is single-use.
              </div>
            ) : (
              <div data-testid="invite-email-status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-400">
                {inviteResult?.emailStatus === "FAILED"
                  ? `The invitation email could not be sent${inviteResult.emailError ? ` (${inviteResult.emailError})` : ""}.`
                  : "Email delivery is not configured, so no email was sent."}{" "}
                Share this link manually. It expires in 7 days and is single-use.
              </div>
            )}
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-secondary/40 p-3">
              <Link2 className="h-4 w-4 text-primary shrink-0" />
              <span className="text-xs text-muted-foreground break-all flex-1">{inviteResult?.link}</span>
              <Button size="sm" variant="outline" onClick={copyInviteLink} className="border-white/10 hover:bg-white/5 text-xs font-bold text-white h-8 px-3 shrink-0">
                {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <DialogFooter className="pt-4 border-t border-white/10">
              <Button type="button" onClick={() => setInviteResult(null)} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
                Done
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirm */}
      <AlertDialog open={!!deactivateTarget} onOpenChange={(o) => !o && setDeactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate user?</AlertDialogTitle>
            <AlertDialogDescription>
              {deactivateTarget?.name} will lose access immediately. This can be reversed later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivateTarget && deactivateMutation.mutate(deactivateTarget.id)}
              className="bg-rose-600 hover:bg-rose-700"
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reactivate Confirm */}
      <AlertDialog open={!!reactivateTarget} onOpenChange={(o) => !o && setReactivateTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reactivate user?</AlertDialogTitle>
            <AlertDialogDescription>
              {reactivateTarget?.name} will regain access to their account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => reactivateTarget && reactivateMutation.mutate(reactivateTarget.id)}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              Reactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
