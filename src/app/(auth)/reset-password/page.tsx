"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plane, Eye, EyeOff, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";

const resetPasswordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters").max(128),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match",
    path: ["confirm"],
  });

type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

function ResetPasswordFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [showPassword, setShowPassword] = React.useState(false);
  const [done, setDone] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordForm>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = async (data: ResetPasswordForm) => {
    if (!token) {
      toast({ title: "Invalid link", description: "This reset link is missing its token.", variant: "destructive" });
      return;
    }
    try {
      const res = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: data.password }),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };

      if (!res.ok) {
        toast({
          title: "Reset failed",
          description: payload.error?.message ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }

      setDone(true);
      toast({ title: "Password reset", description: "Your password has been updated. You can now sign in." });
      router.push("/login");
      router.refresh();
    } catch {
      toast({ title: "Error", description: "Something went wrong. Please try again.", variant: "destructive" });
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-6 space-y-3">
            <p className="text-sm font-semibold text-foreground">Invalid reset link</p>
            <p className="text-sm text-muted-foreground">This link is missing its token. Request a new reset link.</p>
            <Button variant="outline" className="w-full" onClick={() => router.push("/forgot-password")}>
              Request a new link
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Plane className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Set a new password</h1>
            <p className="text-sm text-muted-foreground">Airborne OS</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
            <CardDescription>Choose a new password for your account.</CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <p className="text-sm text-muted-foreground">
                Password updated. Redirecting to sign in...
              </p>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="••••••••"
                      className="pr-10"
                      {...register("password")}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input id="confirm" type="password" placeholder="••••••••" {...register("confirm")} />
                  {errors.confirm && <p className="text-xs text-destructive">{errors.confirm.message}</p>}
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2 text-xs text-amber-400">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>This link is single-use and expires. Submitting consumes it.</span>
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Updating...
                    </>
                  ) : (
                    "Set password"
                  )}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-background text-xs text-muted-foreground">Loading...</div>}>
      <ResetPasswordFormInner />
    </React.Suspense>
  );
}

