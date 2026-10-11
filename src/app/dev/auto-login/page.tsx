"use client";

import * as React from "react";
import { Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";

function AutoLoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = React.useState("Signing you in…");

  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      setStatus("Disabled in production.");
      return;
    }

    const asStudent = params.get("as") === "student";
    const creds = asStudent
      ? {
          email: "demo.student@airborneaviation.in",
          password: "DemoStudent1!",
          orgSlug: "airborne-aviation",
          next: "/portal",
        }
      : {
          email: "admin@airborneaviation.in",
          password: "Admin@1234!",
          orgSlug: "airborne-aviation",
          next: "/",
        };

    void (async () => {
      const result = await signIn("credentials", {
        email: creds.email,
        password: creds.password,
        orgSlug: creds.orgSlug,
        redirect: false,
      });

      if (result?.error) {
        setStatus(
          `Login failed (${result.error}). Ensure admin is running: cd admin && npm run dev`,
        );
        return;
      }

      setStatus("OK - opening dashboard…");
      router.replace(creds.next);
      router.refresh();
    })();
  }, [params, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <p className="text-sm">{status}</p>
    </div>
  );
}

/** LOCAL ONLY: http://localhost:4000/dev/auto-login */
export default function DevAutoLoginPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm">Loading…</div>}>
      <AutoLoginInner />
    </Suspense>
  );
}
