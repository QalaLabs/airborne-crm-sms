"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { formatDate } from "@/lib/utils";
import { roleCan } from "@/lib/utils/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { PartnerDialog, type PartnerRecord } from "@/components/placements/partner-dialog";
import { 
  Building2, Briefcase, Calendar, Plus, CheckCircle2,
  UserCheck, ExternalLink, Pencil
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "@/components/ui/use-toast";

interface HiringPartner extends PartnerRecord {
  _count?: { jobs?: number; placements?: number };
}

const SECTIONS = [
  { id: "placements", label: "Placements", icon: UserCheck },
  { id: "recruitment", label: "Recruitment", icon: Briefcase },
  { id: "partners", label: "Partners", icon: Building2 },
] as const;
type SectionId = (typeof SECTIONS)[number]["id"];

function sectionFrom(value: string | null): SectionId {
  return SECTIONS.some((s) => s.id === value) ? (value as SectionId) : "placements";
}

interface PlacementJob {
  id: string;
  title: string;
  location?: string;
  status: string;
  createdAt: string;
  hiringPartner?: { name: string };
  _count?: { applications?: number };
}

interface PlacementRecord {
  id: string;
  jobTitle: string;
  status: string;
  notes?: string;
  joiningDate?: string;
  createdAt: string;
  student?: { firstName: string; lastName: string };
  hiringPartner?: { name: string };
}

interface StudentLite {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  studentCode?: string;
}

export default function PlacementsPage() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = sectionFrom(searchParams.get("tab"));
  const setActiveTab = (id: SectionId) => router.push(`/placements?tab=${id}`, { scroll: false });
  const { data: session } = useSession();
  const role = session?.user?.role;
  const canWritePlacements = roleCan(role, "write", "placements");
  const canWriteJobs = roleCan(role, "write", "jobs");
  const canWritePartners = roleCan(role, "write", "hiring_partners");
  const [newDriveOpen, setNewDriveOpen] = React.useState(false);
  const [partnerEditor, setPartnerEditor] = React.useState<{ open: boolean; partner: PartnerRecord | null }>({ open: false, partner: null });
  const [shortlistSearch, setShortlistSearch] = React.useState("");

  // Form states
  const [selectedStudent, setSelectedStudent] = React.useState("");
  const [selectedPartner, setSelectedPartner] = React.useState("");
  const [jobTitle, setJobTitle] = React.useState("");
  const [pkg, setPkg] = React.useState("");
  const [joiningDate, setJoiningDate] = React.useState("");
  const [notes, setNotes] = React.useState("");

  // Queries. HiringPartner/Placement/Job services each return { data, total } as a
  // single object, so ok() double-wraps it and apiFetch's one-level unwrap lands
  // back on { data, total } — unlike /students, which needs the flat-array fetch below.
  const { data: partnersRes } = useQuery({
    queryKey: ["hiring-partners"],
    queryFn: () => apiFetch<{ data: HiringPartner[]; total: number }>("/hiring-partners?page=1&limit=100"),
  });
  const partners = partnersRes?.data ?? [];

  const { data: placementsRes } = useQuery({
    queryKey: ["placements-list"],
    queryFn: () => apiFetch<{ data: PlacementRecord[]; total: number }>("/placements?page=1&limit=100"),
  });
  const placementsList = placementsRes?.data ?? [];

  const { data: jobsRes } = useQuery({
    queryKey: ["placement-jobs"],
    queryFn: () => apiFetch<{ data: PlacementJob[]; total: number }>("/jobs?page=1&limit=50"),
  });
  const jobs = jobsRes?.data ?? [];

  const { data: studentsList = [] } = useQuery({
    queryKey: ["students-for-placements"],
    queryFn: () => apiFetch<StudentLite[]>("/students?page=1&limit=100"),
  });

  const totalApplications = jobs.reduce((sum, j) => sum + (j._count?.applications ?? 0), 0);

  // Mappers
  const currentPartners = partners.map(p => ({
    record: p,
    id: p.id,
    name: p.name,
    logo: p.name.substring(0, 2).toUpperCase(),
    code: p.slug.toUpperCase(),
    industry: p.industry?.trim() || null,
    website: p.website?.trim() || null,
    activeDrives: p._count?.jobs ?? 0,
    cadetsPlaced: p._count?.placements ?? 0,
    status: p.isActive ? "HIRING_ACTIVE" : "RECRUITMENT_CLOSED",
    bg: p.isActive ? "bg-blue-600/10 text-blue-400 border-blue-600/30" : "bg-secondary text-muted-foreground border-white/10"
  }));

  const currentDrives = jobs.map(j => ({
    id: j.id,
    airline: j.hiringPartner?.name ?? "Academy Drive",
    title: j.title,
    date: formatDate(j.createdAt),
    venue: j.location || undefined,
    shortlistedCount: j._count?.applications ?? 0,
    status: j.status === "PUBLISHED" ? "REGISTRATION_OPEN" : "IN_PROGRESS"
  }));

  const shortlistNeedle = shortlistSearch.trim().toLowerCase();
  const currentShortlists = placementsList.map(pl => ({
    id: pl.id,
    name: pl.student ? `${pl.student.firstName} ${pl.student.lastName}` : "Cadet Candidate",
    course: pl.jobTitle,
    airline: pl.hiringPartner?.name ?? "Independent",
    status: pl.status,
    drive: pl.notes || "Selection Drive",
    date: formatDate(pl.joiningDate || pl.createdAt)
  })).filter((sc) => !shortlistNeedle || `${sc.name} ${sc.course} ${sc.airline}`.toLowerCase().includes(shortlistNeedle));

  // Mutations
  const createPlacementMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch("/placements", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["placements-list"] });
      toast({ title: "Placement added", description: "The placement has been recorded." });
      setNewDriveOpen(false);
      setSelectedStudent("");
      setSelectedPartner("");
      setJobTitle("");
      setPkg("");
      setJoiningDate("");
      setNotes("");
    },
    onError: (err: unknown) => {
      toast({ title: "Failed to log placement", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  });

  const handleCreateDrive = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent || !jobTitle) return;

    createPlacementMutation.mutate({
      studentId: selectedStudent,
      hiringPartnerId: selectedPartner || undefined,
      jobTitle,
      package: pkg ? parseFloat(pkg) : undefined,
      joiningDate: joiningDate ? new Date(joiningDate).toISOString() : undefined,
      notes: notes || undefined,
      status: "PENDING"
    });
  };

  return (
    <div className="space-y-8 pb-12">
      <PageHeader 
        title="Placements & Airlines Cell" 
        description="Cadet placements, recruitment drives and the airline partner directory." 
        action={
          <div className="flex flex-wrap items-center gap-2" data-testid="placement-actions">
            {canWritePlacements && (
              <Button onClick={() => setNewDriveOpen(true)} data-testid="add-placement" className="bg-primary hover:bg-primary/90 text-white shadow-lg shadow-primary/20">
                <Plus className="h-4 w-4 mr-2" />
                Add Placement
              </Button>
            )}
            {canWriteJobs && (
              <Button asChild variant="outline" data-testid="add-recruitment-drive" className="border-white/10 hover:bg-white/5 text-white">
                <Link href="/jobs?new=1">
                  <Briefcase className="h-4 w-4 mr-2" />
                  New Recruitment Drive
                </Link>
              </Button>
            )}
            {canWritePartners && (
              <Button variant="outline" data-testid="add-partner" onClick={() => setPartnerEditor({ open: true, partner: null })} className="border-white/10 hover:bg-white/5 text-white">
                <Building2 className="h-4 w-4 mr-2" />
                Add Partner
              </Button>
            )}
          </div>
        }
      />

      {/* KPI Overview — live counts only */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { title: "Total Cadets Placed", value: String(placementsList.length), change: "From placement records", color: "text-emerald-400", bg: "bg-emerald-500/10", icon: CheckCircle2 },
          { title: "Active Airline Partners", value: String(partners.length), change: "Registered hiring partners", color: "text-blue-400", bg: "bg-blue-500/10", icon: Building2 },
          { title: "Ongoing Placement Drives", value: String(jobs.length), change: `${totalApplications} applications across drives`, color: "text-amber-400", bg: "bg-amber-500/10", icon: Briefcase },
        ].map((kpi, idx) => {
          const Icon = kpi.icon;
          return (
            <motion.div key={kpi.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: idx * 0.05 }} className="glass-card rounded-2xl p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">{kpi.title}</span>
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${kpi.bg} ${kpi.color}`}>
                  <Icon className="h-4 w-4" />
                </div>
              </div>
              <div className="mt-4">
                <div className="text-2xl font-bold text-white tracking-tight">{kpi.value}</div>
                <p className="text-[11px] font-medium text-muted-foreground mt-1">{kpi.change}</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Tabs Navigation */}
      <nav aria-label="Placement sections" className="flex border-b border-white/10 gap-2 overflow-x-auto pb-1">
        {SECTIONS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              data-testid={`placement-nav-${tab.id}`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border ${
                isActive ? "bg-primary text-white border-primary shadow-lg shadow-primary/20" : "text-muted-foreground hover:bg-white/5 hover:text-foreground border-transparent"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-white" : "text-muted-foreground"}`} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      <AnimatePresence mode="wait">
        {activeTab === "partners" && (
          <motion.div key="partners" data-testid="placement-section-partners" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-6">
            {currentPartners.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center glass-card rounded-2xl border border-white/10">
                <Building2 className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-bold text-white">No Airline Partners Registered</p>
                <p className="text-xs text-muted-foreground mt-1">Use Add Partner to register an airline in the directory.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {currentPartners.map((al) => (
                  <div key={al.id} data-testid="partner-card" className="glass-card rounded-2xl p-6 border border-white/10 flex flex-col justify-between group hover:border-white/20 transition-all">
                    <div>
                      <div className="flex items-center justify-between border-b border-white/10 pb-4">
                        <div className="flex items-center gap-3.5">
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-white font-black text-lg border border-white/10 shadow-lg group-hover:scale-105 transition-transform">
                            {al.logo}
                          </div>
                          <div>
                            <h3 className="text-base font-bold text-white tracking-tight">{al.name}</h3>
                            <span className="text-xs font-mono text-muted-foreground" data-testid="partner-code">Code: {al.code}</span>
                            {al.industry ? <span className="block text-[11px] text-muted-foreground">{al.industry}</span> : null}
                          </div>
                        </div>
                        <span className={`text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${al.bg}`}>
                          {al.status.replace("_", " ")}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-4 my-6">
                        <div className="p-3 rounded-xl bg-secondary/30 border border-white/5 text-center">
                          <span className="text-[10px] font-bold text-muted-foreground block uppercase">Active Drives</span>
                          <span className="text-lg font-bold text-white mt-0.5 block">{al.activeDrives}</span>
                        </div>
                        <div className="p-3 rounded-xl bg-secondary/30 border border-white/5 text-center">
                          <span className="text-[10px] font-bold text-muted-foreground block uppercase">Cadets Placed</span>
                          <span className="text-lg font-bold text-primary mt-0.5 block">{al.cadetsPlaced}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-white/10 text-xs font-semibold">
                      {canWritePartners ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Edit ${al.name}`}
                          onClick={() => setPartnerEditor({ open: true, partner: al.record })}
                          className="h-7 border-white/10 text-[11px] font-bold hover:bg-white/5"
                        >
                          <Pencil className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">Airline partner</span>
                      )}
                      {al.website ? (
                        <a href={al.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1">
                          View Portal <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "recruitment" && (
          <motion.div key="recruitment" data-testid="placement-section-recruitment" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-6">
            {currentDrives.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center glass-card rounded-2xl border border-white/10">
                <Briefcase className="h-12 w-12 text-muted-foreground/40 mb-3" />
                <p className="text-sm font-bold text-white">No Active Recruitment Drives</p>
                <p className="text-xs text-muted-foreground mt-1">Recruitment drives are job listings. Use New Recruitment Drive to create one.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {currentDrives.map((dr) => (
                  <div key={dr.id} className="glass-card rounded-2xl p-6 border border-white/10 flex flex-col md:flex-row md:items-center justify-between gap-6 hover:border-white/20 transition-all">
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-extrabold bg-primary/20 text-white border border-primary/30 px-3 py-0.5 rounded-full">
                          {dr.airline}
                        </span>
                        <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full border ${dr.status === "IN_PROGRESS" ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-blue-500/20 text-blue-400 border-blue-500/30"}`}>
                          {dr.status.replace("_", " ")}
                        </span>
                      </div>
                      <h3 className="text-xl font-bold text-white tracking-tight">{dr.title}</h3>
                      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-1">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="h-3.5 w-3.5 text-amber-400" />
                          <span>Schedule: {dr.date}</span>
                        </div>
                        {dr.venue ? (
                          <div className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5 text-primary" />
                            <span>Venue: {dr.venue}</span>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-6 shrink-0 border-t md:border-t-0 md:border-l border-white/10 pt-4 md:pt-0 md:pl-6">
                      <div className="text-center">
                        <span className="text-[10px] font-bold text-muted-foreground block uppercase">Applications</span>
                        <span className="text-xl font-extrabold text-emerald-400 mt-0.5 block">{dr.shortlistedCount}</span>
                      </div>
                      {dr.id ? (
                        <Button asChild className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
                          <Link href={`/jobs/${dr.id}`}>Manage Drive →</Link>
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {activeTab === "placements" && (
          <motion.div key="placements" data-testid="placement-section-placements" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.2 }} className="space-y-6">
            <div className="glass-card rounded-2xl p-6 border border-white/10 space-y-4">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-base font-bold text-white flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-primary" /> Placements
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">Cadets placed or shortlisted with airline partners.</p>
                </div>
                <Input placeholder="Search placements..." aria-label="Search placements" value={shortlistSearch} onChange={(e) => setShortlistSearch(e.target.value)} className="bg-secondary/40 border-white/10 text-xs font-semibold w-64" />
              </div>

              {currentShortlists.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground border border-white/5 bg-secondary/10 rounded-xl mt-2">
                  <UserCheck className="h-10 w-10 text-muted-foreground/30 mb-2" />
                  <p className="text-xs font-semibold text-white">{shortlistNeedle ? "No placements match your search" : "No placements recorded yet"}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">Use Add Placement to record a cadet placement.</p>
                </div>
              ) : (
                <div className="space-y-3 pt-2">
                  {currentShortlists.map((sc) => (
                    <div key={sc.id} data-testid="placement-row" className="flex items-center justify-between p-4 rounded-xl bg-secondary/30 border border-white/5 hover:border-white/10 transition-colors">
                      <div className="flex items-center gap-4 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary border border-primary/30 font-bold text-sm">
                          ✈️
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-white truncate">{sc.name}</p>
                            <span className="text-[10px] font-bold bg-secondary px-2 py-0.5 rounded text-muted-foreground border border-white/5">
                              {sc.course}
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">Target Airline: <span className="text-white font-semibold">{sc.airline}</span> • Process Notes: {sc.drive}</p>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1.5 shrink-0">
                        <span className="text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                          {sc.status.replace(/_/g, " ")}
                        </span>
                        <span className="text-[11px] text-muted-foreground font-medium">Logged {sc.date}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Placement Dialog */}
      <Dialog open={newDriveOpen} onOpenChange={setNewDriveOpen}>
        <DialogContent className="max-w-md glass-panel border-white/10 bg-slate-900/95" data-testid="placement-dialog">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-white flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" />
              Add Placement
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateDrive} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <label htmlFor="placement-student" className="text-xs font-bold text-muted-foreground">Cadet Student *</label>
              <select
                id="placement-student"
                value={selectedStudent}
                onChange={(e) => setSelectedStudent(e.target.value)}
                required
                className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="" className="bg-slate-900">Select Cadet Student...</option>
                {studentsList.map((st) => (
                  <option key={st.id} value={st.id} className="bg-slate-900">
                    {`${st.firstName || ""} ${st.lastName || ""}`.trim() || st.email} ({st.studentCode || "n/a"})
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="placement-partner" className="text-xs font-bold text-muted-foreground">Airline Partner</label>
              <select
                id="placement-partner"
                value={selectedPartner}
                onChange={(e) => setSelectedPartner(e.target.value)}
                className="flex h-9 w-full rounded-lg border border-white/10 bg-secondary/60 px-3 py-1 text-xs font-bold text-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <option value="" className="bg-slate-900">Independent (Direct Placement)</option>
                {partners.map((al) => (
                  <option key={al.id} value={al.id} className="bg-slate-900">{al.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="placement-title" className="text-xs font-bold text-muted-foreground">Placement Job Title *</label>
              <Input
                id="placement-title"
                placeholder="e.g. First Officer / A320 Cadet"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                required
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="placement-date" className="text-xs font-bold text-muted-foreground">Interview / Joining Date</label>
              <Input
                id="placement-date"
                type="date"
                value={joiningDate}
                onChange={(e) => setJoiningDate(e.target.value)}
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="placement-notes" className="text-xs font-bold text-muted-foreground">Notes (selection venue, simulator screening)</label>
              <Input
                id="placement-notes"
                placeholder="e.g. Delhi Campus / simulator screening"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="bg-secondary/40 border-white/10 text-xs font-semibold text-white"
              />
            </div>
            <DialogFooter className="pt-4 border-t border-white/10">
              <Button type="button" variant="outline" onClick={() => setNewDriveOpen(false)} className="border-white/10 hover:bg-white/5 text-xs font-bold">Cancel</Button>
              <Button type="submit" disabled={createPlacementMutation.isPending} className="bg-primary hover:bg-primary/90 text-white text-xs font-bold shadow-lg shadow-primary/20">
                {createPlacementMutation.isPending ? "Saving…" : "Save Placement"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <PartnerDialog
        open={partnerEditor.open}
        partner={partnerEditor.partner}
        onClose={() => setPartnerEditor({ open: false, partner: null })}
      />
    </div>
  );
}
