"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardCheck,
  Users,
  CalendarDays,
  LogOut,
  GraduationCap,
  Loader2,
  FileText,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/faculty", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/lms/attendance", label: "Attendance", icon: ClipboardCheck, exact: false },
  { href: "/faculty/students", label: "Students", icon: Users, exact: false },
  { href: "/lms/assignments", label: "Assignments", icon: FileText, exact: false },
];

export default function FacultyLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session, status } = useSession();

  React.useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/faculty");
    } else if (status === "authenticated" && session?.user?.role === "STUDENT") {
      router.replace("/portal");
    }
  }, [status, session, router]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1419]">
        <Loader2 className="h-8 w-8 animate-spin text-[#c8102e]" />
      </div>
    );
  }

  if (!session || session.user.role === "STUDENT") return null;

  return (
    <div className="min-h-screen bg-[#0f1419] text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0a0e12]/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/faculty" className="flex items-center gap-2 font-semibold">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#c8102e]">
              <GraduationCap className="h-4 w-4 text-white" />
            </span>
            <span>Faculty Panel</span>
          </Link>
          <div className="flex items-center gap-3">
            {session.user.name && (
              <span className="hidden text-xs text-white/50 sm:inline">{session.user.name}</span>
            )}
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/60 hover:bg-white/5 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-0.5 overflow-x-auto px-2 pb-2">
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                  active ? "bg-[#c8102e]/20 text-white" : "text-white/55 hover:bg-white/5 hover:text-white",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  );
}
