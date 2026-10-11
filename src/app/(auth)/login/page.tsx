"use client";

import * as React from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Plane, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/use-toast";

const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  orgSlug: z.string().min(1, "Organization slug is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = React.useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      orgSlug: "airborne-aviation",
    },
  });

  const onSubmit = async (data: LoginForm) => {
    try {
      const result = await signIn("credentials", {
        email: data.email,
        password: data.password,
        orgSlug: data.orgSlug,
        redirect: false,
      });

      if (result?.error) {
        toast({
          title: "Sign in failed",
          description: "Invalid email, password, or organization.",
          variant: "destructive",
        });
        return;
      }

      // Role-aware landing: students → portal, staff → admin dashboard
      const callback = new URLSearchParams(window.location.search).get("callbackUrl");
      if (callback?.startsWith("/")) {
        router.push(callback);
      } else {
        // Fetch session role via lightweight cookie round-trip after signIn
        const sessionRes = await fetch("/api/auth/session");
        const session = (await sessionRes.json()) as { user?: { role?: string } };
        router.push(session.user?.role === "STUDENT" ? "/portal" : "/");
      }
      router.refresh();
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
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Plane className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground">Airborne OS</h1>
            <p className="text-sm text-muted-foreground">Aviation Academy Operations Platform</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sign in to your account</CardTitle>
            <CardDescription>Enter your credentials to access the admin panel</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="orgSlug">Organization</Label>
                <Input
                  id="orgSlug"
                  placeholder="airborne-aviation"
                  {...register("orgSlug")}
                />
                {errors.orgSlug && (
                  <p className="text-xs text-destructive">{errors.orgSlug.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@airborne.academy"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-xs text-destructive">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
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
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-xs text-destructive">{errors.password.message}</p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
              <div className="text-center">
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">
                  Forgot your password?
                </Link>
              </div>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          Airborne Aviation Academy &copy; {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}
