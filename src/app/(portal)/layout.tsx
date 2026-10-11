"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { Plus_Jakarta_Sans, Instrument_Serif } from "next/font/google";
import {
  BookOpen,
  LayoutDashboard,
  Award,
  ClipboardCheck,
  LogOut,
  Plane,
  Sparkles,
  BarChart3,
  Bookmark,
  FileText,
  User,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "@/components/portal/portal.css";

const portalSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-portal-sans",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

const portalDisplay = Instrument_Serif({
  subsets: ["latin"],
  variable: "--font-portal-display",
  display: "swap",
  weight: ["400"],
});

const NAV = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/portal/courses", label: "Courses", icon: BookOpen, exact: false },
  { href: "/portal/progress", label: "Progress", icon: BarChart3, exact: false },
  { href: "/portal/assignments", label: "Assignments", icon: FileText, exact: false },
  { href: "/portal/assessments", label: "Assessments", icon: FileText, exact: false },
  { href: "/portal/attendance", label: "Attendance", icon: ClipboardCheck, exact: false },
  { href: "/portal/certificates", label: "Certificates", icon: Award, exact: false },
  { href: "/portal/bookmarks", label: "Bookmarks", icon: Bookmark, exact: false },
  { href: "/portal/announcements", label: "News", icon: Megaphone, exact: false },
  { href: "/portal/assistant", label: "AI Tutor", icon: Sparkles, exact: false },
  { href: "/portal/profile", label: "Profile", icon: User, exact: false },
];

const MOBILE_NAV = [
  { href: "/portal", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/portal/courses", label: "Learn", icon: BookOpen, exact: false },
  { href: "/portal/progress", label: "Progress", icon: BarChart3, exact: false },
  { href: "/portal/assistant", label: "AI", icon: Sparkles, exact: false },
  { href: "/portal/profile", label: "You", icon: User, exact: false },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { data: session, status } = useSession();

  React.useEffect(() => {
    if (status === "authenticated" && session?.user?.role && session.user.role !== "STUDENT") {
      window.location.href = "/";
    }
  }, [status, session]);

  if (status === "loading") {
    return (
      <div className={cn("portal-shell flex min-h-screen items-center justify-center", portalSans.variable, portalDisplay.variable)}>
        <div className="flex flex-col items-center gap-4">
          <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--ab-red)] shadow-[0_0_40px_var(--ab-red-glow)]">
            <Plane className="h-6 w-6 text-white" aria-hidden="true" />
          </span>
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-[var(--ab-red)]" />
          </div>
          <p className="text-xs tracking-wide text-white/45">Preparing flight deck…</p>
        </div>
      </div>
    );
  }

  if (status === "unauthenticated") {
    if (typeof window !== "undefined") {
      window.location.href = "/login?callbackUrl=/portal";
    }
    return null;
  }

  return (
    <div className={cn("portal-shell relative", portalSans.variable, portalDisplay.variable)}>
      <div className="portal-atmosphere" aria-hidden="true" />

      <header className="sticky top-0 z-30 border-b border-white/10 bg-[rgba(7,21,38,0.82)] backdrop-blur-xl">
        <div className="relative z-10 mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3.5">
          <Link
            href="/portal"
            className="group flex items-center gap-2.5"
            aria-label="Airborne Student Portal - Dashboard"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--ab-red)] shadow-[0_8px_24px_var(--ab-red-glow)] transition-transform group-hover:scale-105">
              <Plane className="h-5 w-5 text-white" aria-hidden="true" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold tracking-tight text-white">Airborne</span>
              <span className="block text-[10px] font-medium uppercase tracking-[0.16em] text-white/40">
                Student Academy
              </span>
            </span>
          </Link>

          <div className="flex items-center gap-2.5 text-sm">
            {session?.user?.name && (
              <Link
                href="/portal/profile"
                className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] py-1 pl-1 pr-3 transition-colors hover:border-white/20 sm:inline-flex"
              >
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--ab-red)]/20 text-[10px] font-bold text-[#ff8a9a]">
                  {session.user.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="max-w-[120px] truncate text-xs text-white/70">{session.user.name}</span>
              </Link>
            )}
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="ab-btn ab-btn-ghost px-3 py-1.5"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>

        <nav
          aria-label="Student portal navigation"
          className="relative z-10 mx-auto hidden max-w-6xl gap-1 overflow-x-auto px-3 pb-3 scrollbar-none md:flex"
        >
          {NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "ab-nav-pill inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium",
                  active ? "text-white" : "text-white/50 hover:bg-white/5 hover:text-white/90",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="relative z-10 mx-auto max-w-6xl px-4 py-8 pb-28 md:pb-10">
        {children}
      </main>

      {/* Mobile bottom nav */}
      <nav
        aria-label="Mobile portal navigation"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[rgba(7,21,38,0.92)] px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-between gap-1 py-2">
          {MOBILE_NAV.map((item) => {
            const active = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(`${item.href}/`);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl px-1 py-1.5 text-[10px] font-medium",
                  active ? "text-white" : "text-white/40",
                )}
              >
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-xl transition-colors",
                    active && "bg-[var(--ab-red)]/20 text-[var(--ab-red)]",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
