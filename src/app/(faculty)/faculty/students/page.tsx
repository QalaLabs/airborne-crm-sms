"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

interface FacultyStudent {
  student: {
    id: string;
    firstName: string;
    lastName: string;
    studentCode: string;
    email: string;
    status: string;
  };
  batch: {
    id: string;
    name: string;
    type: string;
  };
}

export default function FacultyStudentsPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["lms-faculty-students"],
    queryFn: () => apiFetch<FacultyStudent[]>("/lms/faculty/students"),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">My Students</h1>
        <p className="mt-1 text-sm text-white/50">Students across your assigned batches</p>
      </div>

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-white/[0.03]" />)}
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
          {(error as Error).message}
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/[0.03] text-xs uppercase tracking-wide text-white/40">
              <tr>
                <th className="px-4 py-3">Student</th>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Batch</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(data ?? []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center">
                    <Users className="mx-auto h-8 w-8 text-white/15" />
                    <p className="mt-2 text-sm text-white/40">No students in your batches yet.</p>
                  </td>
                </tr>
              )}
              {(data ?? []).map((row, i) => (
                <tr key={`${row.student.id}-${row.batch.id}-${i}`} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <p className="text-white/80">{row.student.firstName} {row.student.lastName}</p>
                    <p className="text-xs text-white/40">{row.student.email}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-white/50">{row.student.studentCode}</td>
                  <td className="px-4 py-3 text-white/60">{row.batch.name}</td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      row.student.status === "ACTIVE" ? "bg-emerald-500/15 text-emerald-400" : "bg-white/10 text-white/50",
                    )}>
                      {row.student.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
