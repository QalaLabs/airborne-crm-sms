"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { CalendarDays, Users, FileText, BookOpen, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface FacultyDashboard {
  batches: Array<{
    id: string;
    name: string;
    type: string;
    course: { id: string; title: string };
    _count: { students: number };
  }>;
  todayClasses: Array<{
    id: string;
    title: string;
    startsAt: string;
    endsAt: string;
    room?: string | null;
    batch: { id: string; name: string };
    course: { title: string };
  }>;
  assignments: Array<{
    id: string;
    title: string;
    status: string;
    dueAt?: string | null;
    course: { title: string };
    _count: { submissions: number };
  }>;
  studentCount: number;
}

export default function FacultyDashboardPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["lms-faculty"],
    queryFn: () => apiFetch<FacultyDashboard>("/lms/faculty"),
  });

  if (isLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-48 rounded bg-white/10" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-xl bg-white/5" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">Faculty Dashboard</h1>
        <p className="mt-1 text-sm text-white/50">Your batches, today&apos;s classes, and assignments</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <Users className="h-4 w-4 text-[#c8102e]" />
          <p className="mt-3 text-2xl font-bold text-white">{data.studentCount}</p>
          <p className="text-xs text-white/50">Total students</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <BookOpen className="h-4 w-4 text-[#c8102e]" />
          <p className="mt-3 text-2xl font-bold text-white">{data.batches.length}</p>
          <p className="text-xs text-white/50">Active batches</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <CalendarDays className="h-4 w-4 text-[#c8102e]" />
          <p className="mt-3 text-2xl font-bold text-white">{data.todayClasses.length}</p>
          <p className="text-xs text-white/50">Classes today</p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          <CalendarDays className="h-4 w-4 text-[#c8102e]" />
          Today&apos;s Classes
        </h2>
        {data.todayClasses.length === 0 ? (
          <p className="text-sm text-white/40">No classes scheduled for today.</p>
        ) : (
          <div className="space-y-2">
            {data.todayClasses.map((c) => (
              <div key={c.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="font-medium text-white">{c.title}</p>
                <p className="text-xs text-white/50 mt-0.5">
                  {c.batch.name} · {c.course.title}
                  {c.room ? ` · Room ${c.room}` : ""}
                </p>
                <p className="text-xs text-white/40 mt-1">
                  {new Date(c.startsAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                  {" – "}
                  {new Date(c.endsAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold text-white">
            <BookOpen className="h-4 w-4 text-[#c8102e]" />
            My Batches
          </h2>
          <Link href="/faculty/students" className="text-xs text-white/50 hover:text-white flex items-center gap-1">
            View students <ChevronRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {data.batches.map((b) => (
            <div key={b.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <p className="font-medium text-white">{b.name}</p>
              <p className="text-xs text-white/50">{b.course.title}</p>
              <div className="mt-2 flex gap-2">
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase bg-white/10 text-white/60")}>
                  {b.type}
                </span>
                <span className="text-xs text-white/40">{b._count.students} students</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-white">
          <FileText className="h-4 w-4 text-[#c8102e]" />
          Assignments
        </h2>
        {data.assignments.length === 0 ? (
          <p className="text-sm text-white/40">No assignments yet.</p>
        ) : (
          <div className="space-y-2">
            {data.assignments.map((a) => (
              <div key={a.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div>
                  <p className="font-medium text-white">{a.title}</p>
                  <p className="text-xs text-white/50">{a.course.title} · {a._count.submissions} submissions</p>
                </div>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase text-white/60">
                  {a.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
