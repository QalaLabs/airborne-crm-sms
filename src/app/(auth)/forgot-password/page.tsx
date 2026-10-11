"use client";

import * as React from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plane, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [submitted, setSubmitted] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { orgSlug: "airborne-aviation" },
  });

  const onSubmit = async (data: ForgotPasswordForm) => {
    try {
      const res = await fetch("/api/v1/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } };

      if (!res.ok) {
        toast({
          title: "Request failed",
          description: payload.error?.message ?? `HTTP ${res.status}`,
          variant: "destructive",
        });
        return;
      }

      setSubmitted(true);
      toast({
        title: "Request received",
        description: "If an account exists for that email, a password reset link has been sent.",
      });
    } catch {
      toast({
        title: "Error",
        description: "Something went wrong. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Plane className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Reset your password</h1>
            <p className="text-sm text-muted-foreground">Airborne OS</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Forgot password</CardTitle>
            <CardDescription>
              Enter the email and organization you signed in with.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {submitted ? (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  If an account exists for that email, a password reset link has been sent.
                </p>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2 text-xs text-amber-400">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Email delivery for password reset is not configured in this environment.
                    No reset email was sent. Contact your administrator to regain access.
                  </span>
                </div>
                <Button type="button" variant="outline" className="w-full" onClick={() => router.push("/login")}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="orgSlug">Organization</Label>
                  <Input id="orgSlug" placeholder="airborne-aviation" {...register("orgSlug")} />
                  {errors.orgSlug && <p className="text-xs text-destructive">{errors.orgSlug.message}</p>}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" placeholder="you@airborneacademy.in" {...register("email")} />
                  {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
                </div>
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2 text-xs text-amber-400">
                  <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    Email delivery for password reset is not configured in this environment.
                    The request is still recorded; contact your administrator to regain access.
                  </span>
                </div>
                <Button type="submit" className="w-full" disabled={isSubmitting}>
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Submitting...
                    </>
                  ) : (
                    "Request reset link"
                  )}
                </Button>
                <div className="text-center">
                  <Link href="/login" className="text-xs text-primary hover:underline">
                    Back to sign in
                  </Link>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
