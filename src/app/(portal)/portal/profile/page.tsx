"use client";

import * as React from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import type { MePayload } from "@/components/portal/types";
import {
  PortalPageHeader,
  GlassCard,
  EmptyState,
  MotionSection,
  StatTile,
  ProgressBar,
  StatusPill,
} from "@/components/portal/portal-ui";
import { TextSkeleton, CardSkeleton } from "@/components/portal/portal-skeleton";
import {
  User,
  Mail,
  Hash,
  BookOpen,
  Award,
  ClipboardCheck,
  Sparkles,
  Loader2,
  Save,
  KeyRound,
  PenLine,
} from "lucide-react";

export default function PortalProfilePage() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [avatarUrl, setAvatarUrl] = React.useState("");
  const [synced, setSynced] = React.useState(false);

  React.useEffect(() => {
    if (data && !synced) {
      setFirstName(data.student.firstName);
      setLastName(data.student.lastName);
      setPhone(data.user?.phone ?? "");
      setAvatarUrl(data.user?.avatarUrl ?? "");
      setSynced(true);
    }
  }, [data, synced]);

  const saveProfile = useMutation({
    mutationFn: () =>
      apiFetch("/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          firstName,
          lastName,
          phone: phone.trim() ? phone.trim() : null,
          avatarUrl: avatarUrl.trim() ? avatarUrl.trim() : null,
        }),
      }),
    onSuccess: () => {
      setSynced(false);
      void queryClient.invalidateQueries({ queryKey: ["lms-me"] });
      toast({ title: "Profile updated", description: "Your academy profile has been saved." });
    },
    onError: (err: Error) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");

  const changePassword = useMutation({
    mutationFn: () =>
      apiFetch("/users/me/password", {
        method: "POST",
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password changed", description: "Use your new password next time you sign in." });
    },
    onError: (err: Error) =>
      toast({ title: "Password not changed", description: err.message, variant: "destructive" }),
  });

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast({ title: "Password too short", description: "Use at least 8 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords do not match", description: "New and confirmation must match.", variant: "destructive" });
      return;
    }
    changePassword.mutate();
  };

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <TextSkeleton className="h-8 w-40" />
        <CardSkeleton className="h-48" />
      </div>
    );
  }

  if (isError || !data) {
    return <EmptyState icon={User} title="Unable to load profile" />;
  }

  const s = data.student;
  const initials = `${s.firstName?.[0] ?? ""}${s.lastName?.[0] ?? ""}`.toUpperCase() || "S";

  return (
    <MotionSection>
      <PortalPageHeader
        eyebrow="Cadet profile"
        title={`${s.firstName} ${s.lastName}`}
        description="Your academy identity, enrollment snapshot, and learning vitals."
      />

      <GlassCard hero className="mb-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-[var(--ab-red)] text-2xl font-bold text-white shadow-[0_12px_40px_var(--ab-red-glow)]">
            {initials}
          </span>
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="ab-display text-2xl text-white">
                {s.firstName} {s.lastName}
              </h2>
              <StatusPill tone="brand">Student</StatusPill>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-white/55">
              <span className="inline-flex items-center gap-1.5">
                <Hash className="h-3.5 w-3.5 text-[var(--ab-gold)]" aria-hidden="true" />
                {s.studentCode}
              </span>
              {(s.email || session?.user?.email) && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-[var(--ab-gold)]" aria-hidden="true" />
                  {s.email || session?.user?.email}
                </span>
              )}
            </div>
          </div>
          <Link href="/portal/assistant" className="ab-btn ab-btn-primary px-4 py-2.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            Ask AI Tutor
          </Link>
        </div>
      </GlassCard>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <StatTile icon={BookOpen} label="Courses enrolled" value={data.enrollments.length} />
        <StatTile
          icon={ClipboardCheck}
          label="Attendance"
          value={`${data.attendancePercent}%`}
          accent
        />
        <StatTile icon={Award} label="Certificates" value={data.certificates.length} />
      </div>

      <GlassCard>
        <p className="ab-eyebrow mb-3">Learning vitals</p>
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex justify-between text-xs">
              <span className="text-white/50">Topics completed</span>
              <span className="font-semibold text-white">{data.completedTopics}</span>
            </div>
            <ProgressBar
              value={
                data.enrollments[0]?.percentComplete ??
                (data.completedTopics > 0 ? Math.min(100, data.completedTopics * 5) : 0)
              }
            />
          </div>
          {data.continueLearning && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-white/35">
                Continue learning
              </p>
              <p className="mt-1 text-sm font-medium text-white">{data.continueLearning.courseTitle}</p>
              <ProgressBar value={data.continueLearning.percentComplete} className="mt-2" />
            </div>
          )}
        </div>
      </GlassCard>

      <GlassCard className="mt-6">
        <div className="mb-4 flex items-center gap-2">
          <PenLine className="h-4 w-4 text-[var(--ab-red)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-wide text-white/90">Edit profile</h2>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile.mutate();
          }}
          className="grid gap-4 sm:grid-cols-2"
        >
          <div className="space-y-1.5">
            <label htmlFor="profile-first-name" className="text-xs text-white/55">
              First name
            </label>
            <input
              id="profile-first-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[rgba(200,16,46,0.5)]"
              placeholder="First name"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="profile-last-name" className="text-xs text-white/55">
              Last name
            </label>
            <input
              id="profile-last-name"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[rgba(200,16,46,0.5)]"
              placeholder="Last name"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="profile-phone" className="text-xs text-white/55">
              Phone
            </label>
            <input
              id="profile-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[rgba(200,16,46,0.5)]"
              placeholder="+91…"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="profile-avatar" className="text-xs text-white/55">
              Avatar image URL
            </label>
            <input
              id="profile-avatar"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[rgba(200,16,46,0.5)]"
              placeholder="https://…"
            />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={saveProfile.isPending || !firstName.trim()} className="ab-btn ab-btn-primary px-5 py-2.5 disabled:opacity-50">
              {saveProfile.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Saving…
                </>
              ) : (
                <>
                  <Save className="h-3.5 w-3.5" aria-hidden="true" /> Save changes
                </>
              )}
            </button>
          </div>
        </form>
      </GlassCard>

      <GlassCard className="mt-6">
        <div className="mb-4 flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-[var(--ab-red)]" aria-hidden="true" />
          <h2 className="text-sm font-semibold tracking-wide text-white/90">Change password</h2>
        </div>
        <form onSubmit={handlePasswordSubmit} className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="profile-current-password" className="text-xs text-white/55">
              Current password
            </label>
            <input
              id="profile-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[rgba(200,16,46,0.5)]"
              placeholder="••••••••"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="profile-new-password" className="text-xs text-white/55">
              New password
            </label>
            <input
              id="profile-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[rgba(200,16,46,0.5)]"
              placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="profile-confirm-password" className="text-xs text-white/55">
              Confirm new password
            </label>
            <input
              id="profile-confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-white/30 focus:border-[rgba(200,16,46,0.5)]"
              placeholder="Repeat new password"
            />
          </div>
          <div className="sm:col-span-3">
            <button type="submit" disabled={changePassword.isPending} className="ab-btn ab-btn-ghost px-5 py-2.5 disabled:opacity-50">
              {changePassword.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Updating…
                </>
              ) : (
                <>
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> Change password
                </>
              )}
            </button>
          </div>
        </form>
      </GlassCard>
    </MotionSection>
  );
}
