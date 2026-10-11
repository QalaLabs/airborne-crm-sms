"use client";

import * as React from "react";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "@/components/ui/use-toast";
import { getInitials } from "@/lib/utils";
import { Loader2, ShieldCheck } from "lucide-react";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "Password must be at least 8 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type ChangePasswordForm = z.infer<typeof changePasswordSchema>;

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const user = session?.user;

  const [profileName, setProfileName] = React.useState("");
  const [profilePhone, setProfilePhone] = React.useState("");
  const [profileAvatar, setProfileAvatar] = React.useState("");
  const [updatingProfile, setUpdatingProfile] = React.useState(false);

  React.useEffect(() => {
    fetch("/api/v1/users/me")
      .then((res) => res.json())
      .then((payload) => {
        if (payload.data) {
          setProfileName(payload.data.name || "");
          setProfilePhone(payload.data.phone || "");
          setProfileAvatar(payload.data.avatarUrl || "");
        }
      })
      .catch((err) => console.error("Failed to load profile details", err));
  }, []);

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdatingProfile(true);
    try {
      const res = await fetch("/api/v1/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profileName || undefined,
          phone: profilePhone || null,
          avatarUrl: profileAvatar || null,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };

      if (!res.ok) {
        toast({
          title: "Profile update failed",
          description: payload.error?.message ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Profile updated", description: "Your details have been saved successfully." });
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    } finally {
      setUpdatingProfile(false);
    }
  };

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordForm>({ resolver: zodResolver(changePasswordSchema) });

  const onSubmit = async (data: ChangePasswordForm) => {
    try {
      const res = await fetch("/api/v1/users/me/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };

      if (!res.ok) {
        toast({
          title: "Password not changed",
          description: payload.error?.message ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }

      toast({ title: "Password changed", description: "Your password has been updated." });
      reset();
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    }
  };

  if (status === "loading") {
    return (
      <div className="p-6 text-white text-xs flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading profile...
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12 max-w-2xl">
      <PageHeader title="Profile" description="Your account details and security settings." />

      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>Update your public identity details.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="profileName">Full Name</Label>
              <Input
                id="profileName"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                placeholder="e.g. John Doe"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profilePhone">Phone Number</Label>
              <Input
                id="profilePhone"
                value={profilePhone}
                onChange={(e) => setProfilePhone(e.target.value)}
                placeholder="e.g. +919876543210"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="profileAvatar">Avatar Image URL</Label>
              <Input
                id="profileAvatar"
                value={profileAvatar}
                onChange={(e) => setProfileAvatar(e.target.value)}
                placeholder="e.g. https://example.com/avatar.jpg"
              />
            </div>
            <Button type="submit" disabled={updatingProfile || !profileName}>
              {updatingProfile ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Saving...
                </>
              ) : (
                "Save changes"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account information</CardTitle>
          <CardDescription>Identity fields managed by your organization are read-only.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="h-14 w-14 border border-primary/30 shadow-md">
              {profileAvatar ? (
                <AvatarImage src={profileAvatar} alt={profileName} />
              ) : user?.avatarUrl ? (
                <AvatarImage src={user.avatarUrl} alt={profileName} />
              ) : null}
              <AvatarFallback className="bg-primary/20 text-primary font-bold">{getInitials(profileName || user?.name || "?")}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-bold text-foreground">{profileName || user?.name}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Input value={(user?.role ?? "").replace("_", " ")} readOnly disabled className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
            <div className="space-y-1.5">
              <Label>Organization ID</Label>
              <Input value={user?.orgId ?? ""} readOnly disabled className="bg-secondary/40 border-white/10 text-xs font-semibold text-white" />
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Role, organization, and account status are managed by your organization&apos;s administrator.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>Use your current password to set a new one.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input id="currentPassword" type="password" placeholder="••••••••" {...register("currentPassword")} />
              {errors.currentPassword && <p className="text-xs text-destructive">{errors.currentPassword.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPassword">New password</Label>
              <Input id="newPassword" type="password" placeholder="••••••••" {...register("newPassword")} />
              {errors.newPassword && <p className="text-xs text-destructive">{errors.newPassword.message}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm">Confirm new password</Label>
              <Input id="confirm" type="password" placeholder="••••••••" {...register("confirm")} />
              {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
            </div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Updating...
                </>
              ) : (
                "Change password"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
