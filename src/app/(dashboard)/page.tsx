"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Users, GraduationCap, TrendingUp, Briefcase,
  DollarSign, Calendar, Clock, UserCheck, Activity, Plus,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { StatusBadge } from "@/components/shared/status-badge";
import { formatDate } from "@/lib/utils";
import Link from "next/link";
import { motion } from "framer-motion";
import { Skeleton } from "@/components/ui/skeleton";

interface DashboardLead {
  id: string;
  name: string;
  email: string;
  phone: string;
  status: string;
  courseInterest?: string;
  createdAt: string;
}

interface DashboardStats {
  leadsCount: number;
  leadsToday: number;
  leadsThisWeek: number;
  leadsThisMonth: number;
  leadsFollowUp: number;
  studentsCount: number;
  admissionsCount: number;
  placementsCount: number;
  activeCounsellors: number;
  revenue: number;
}

export default function DashboardPage() {
  const { data: leads, isLoading: leadsLoading } = useQuery({
    queryKey: ["leads", "dashboard"],
    queryFn: () => apiFetch<DashboardLead[]>("/leads?page=1&limit=8"),
  });

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => apiFetch<DashboardStats>("/dashboard/stats"),
  });

  const STAT_CARDS = [
    { title: "Today's Leads", value: String(stats?.leadsToday ?? 0), icon: Users, color: "text-blue-500", bg: "bg-blue-500/10", href: "/leads?filter=today" },
    { title: "This Week", value: String(stats?.leadsThisWeek ?? 0), icon: Calendar, color: "text-indigo-500", bg: "bg-indigo-500/10", href: "/leads?filter=week" },
    { title: "Monthly Leads", value: String(stats?.leadsThisMonth ?? 0), icon: TrendingUp, color: "text-purple-500", bg: "bg-purple-500/10", href: "/leads?filter=month" },
    { title: "Admissions", value: String(stats?.admissionsCount ?? 0), icon: GraduationCap, color: "text-emerald-500", bg: "bg-emerald-500/10", href: "/admissions" },
    {
      title: "Revenue (recorded)",
      value: stats ? `₹${(Number(stats.revenue) / 100000).toFixed(1)}L` : "₹0.0L",
      icon: DollarSign,
      color: "text-amber-500",
      bg: "bg-amber-500/10",
      href: "/payments",
    },
    { title: "Pending Follow-ups", value: String(stats?.leadsFollowUp ?? 0), icon: Clock, color: "text-rose-500", bg: "bg-rose-500/10", href: "/leads?status=FOLLOW_UP" },
    { title: "Students", value: String(stats?.studentsCount ?? 0), icon: Users, color: "text-teal-500", bg: "bg-teal-500/10", href: "/students" },
    { title: "Active Counsellors", value: String(stats?.activeCounsellors ?? 0), icon: UserCheck, color: "text-cyan-500", bg: "bg-cyan-500/10", href: "/users" },
    { title: "Placements logged", value: String(stats?.placementsCount ?? 0), icon: Briefcase, color: "text-sky-500", bg: "bg-sky-500/10", href: "/placements" },
    { title: "Total Leads", value: String(stats?.leadsCount ?? 0), icon: Activity, color: "text-violet-500", bg: "bg-violet-500/10", href: "/leads" },
  ];

  const recentLeads = leads ?? [];

  return (
    <div className="space-y-8 pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
            <Activity className="h-6 w-6 text-primary" />
            Operations Dashboard
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Live counts from your database - leads, admissions, students, and recorded fees.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/admissions"
            className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-white px-4 py-2 rounded-xl text-sm font-semibold shadow-lg shadow-primary/20 transition-all"
          >
            <Plus className="h-4 w-4" />
            <span>Admissions</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {STAT_CARDS.map((stat, idx) => {
          const Icon = stat.icon;
          return (
            <Link key={stat.title} href={stat.href} className="block group">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: idx * 0.03 }}
                className="glass-card rounded-2xl p-5 flex flex-col justify-between h-full border border-white/5 transition-all group-hover:border-primary/40 group-hover:bg-white/[0.07] group-hover:-translate-y-0.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground group-hover:text-foreground transition-colors truncate pr-2">
                    {stat.title}
                  </span>
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${stat.bg} ${stat.color} shrink-0`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="mt-4">
                  {statsLoading ? (
                    <Skeleton className="h-8 w-20" />
                  ) : (
                    <div className="text-2xl font-bold text-white tracking-tight">{stat.value}</div>
                  )}
                </div>
              </motion.div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card rounded-2xl p-6 border border-white/10">
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Recent leads</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Latest intake from the CRM</p>
            </div>
            <Link
              href="/leads"
              className="text-xs font-bold text-primary hover:underline bg-primary/10 px-3 py-1.5 rounded-xl border border-primary/20"
            >
              View all leads
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {leadsLoading && (
              <>
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </>
            )}
            {!leadsLoading && recentLeads.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-10 border border-dashed border-white/10 rounded-xl">
                No leads yet. New website inquiries will appear here.
              </p>
            )}
            {recentLeads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between p-3.5 rounded-xl bg-secondary/30 hover:bg-secondary/60 border border-white/5 hover:border-white/10 transition-all group"
              >
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary font-bold border border-primary/30">
                    {lead.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link href={`/leads/${lead.id}`} className="text-sm font-semibold text-white hover:text-primary transition-colors truncate">
                        {lead.name}
                      </Link>
                      {lead.courseInterest ? (
                        <span className="text-[10px] font-semibold bg-secondary px-2 py-0.5 rounded border border-white/5 text-muted-foreground hidden sm:inline-block">
                          {lead.courseInterest}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                      <span className="truncate">{lead.email || "-"}</span>
                      <span className="hidden sm:inline-block font-mono text-[11px]">{lead.phone}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0">
                  <StatusBadge status={lead.status} domain="lead" />
                  <span className="text-[11px] text-muted-foreground font-medium">{formatDate(lead.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6 border border-white/10">
          <h2 className="text-base font-bold text-white border-b border-white/10 pb-4">Quick actions</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {[
              { label: "Add Lead", href: "/leads" },
              { label: "Admissions", href: "/admissions" },
              { label: "Students", href: "/students" },
              { label: "LMS", href: "/lms" },
            ].map((act) => (
              <Link
                key={act.href}
                href={act.href}
                className="flex items-center justify-center rounded-xl border border-white/10 bg-secondary/40 px-3 py-4 text-xs font-bold text-white hover:border-primary/40 hover:bg-primary/10 transition-colors"
              >
                {act.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
