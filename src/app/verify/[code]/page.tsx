"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, XCircle, Loader2, Plane } from "lucide-react";

type VerifyResult = {
  valid: boolean;
  message?: string;
  certificateNo?: string;
  studentName?: string;
  courseTitle?: string;
  orgName?: string;
  issuedAt?: string | null;
};

export default function PublicCertificateVerifyPage() {
  const params = useParams<{ code: string }>();
  const code = decodeURIComponent(params.code ?? "");

  const [loading, setLoading] = React.useState(true);
  const [result, setResult] = React.useState<VerifyResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!code) {
      setLoading(false);
      setResult({ valid: false, message: "No verification code provided" });
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/public/lms/certificates?code=${encodeURIComponent(code)}`,
          { credentials: "omit" },
        );
        const json = (await res.json()) as {
          success?: boolean;
          data?: VerifyResult;
          error?: { message?: string };
        };
        if (!res.ok || json.success === false) {
          throw new Error(json.error?.message ?? `HTTP ${res.status}`);
        }
        if (!cancelled) setResult(json.data ?? { valid: false, message: "Unexpected response" });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Verification failed");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  const issuedDate =
    result?.issuedAt
      ? new Date(result.issuedAt).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : null;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(160deg, #0b1f3a 0%, #162d54 55%, #0b1f3a 100%)",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "48px 20px",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#c8102e",
            marginBottom: 14,
          }}
        >
          <Plane style={{ width: 28, height: 28 }} />
        </div>
        <p
          style={{
            fontSize: 11,
            letterSpacing: "0.28em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.5)",
            margin: 0,
          }}
        >
          Airborne Aviation
        </p>
        <h1 style={{ fontSize: 28, fontWeight: 700, margin: "10px 0 0", letterSpacing: "-0.02em" }}>
          Certificate verification
        </h1>
        <p style={{ margin: "8px 0 0", fontSize: 14, color: "rgba(255,255,255,0.5)" }}>
          Confirm authenticity of an issued training certificate
        </p>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 520,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.12)",
          background: "rgba(255,255,255,0.04)",
          padding: "28px 28px 24px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
        }}
      >
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "32px 0" }}>
            <Loader2
              style={{
                width: 28,
                height: 28,
                color: "rgba(255,255,255,0.6)",
                animation: "spin 1s linear infinite",
              }}
            />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
            <p style={{ margin: 0, fontSize: 14, color: "rgba(255,255,255,0.55)" }}>Checking certificate…</p>
          </div>
        )}

        {!loading && error && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <XCircle style={{ width: 40, height: 40, color: "#f87171", margin: "0 auto 12px" }} />
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Unable to verify</p>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>{error}</p>
          </div>
        )}

        {!loading && !error && result && !result.valid && (
          <div style={{ textAlign: "center", padding: "16px 0" }}>
            <XCircle style={{ width: 40, height: 40, color: "#f87171", margin: "0 auto 12px" }} />
            <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Certificate not valid</p>
            <p style={{ margin: "8px 0 0", fontSize: 13, color: "rgba(255,255,255,0.5)" }}>
              {result.message ?? "No matching issued certificate was found for this code."}
            </p>
            <p
              style={{
                margin: "16px 0 0",
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
                color: "rgba(255,255,255,0.35)",
                wordBreak: "break-all",
              }}
            >
              Code: {code}
            </p>
          </div>
        )}

        {!loading && !error && result?.valid && (
          <div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                marginBottom: 20,
                padding: "10px 14px",
                borderRadius: 10,
                background: "rgba(16,185,129,0.12)",
                border: "1px solid rgba(16,185,129,0.35)",
              }}
            >
              <CheckCircle2 style={{ width: 22, height: 22, color: "#34d399", flexShrink: 0 }} />
              <div>
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: "#6ee7b7" }}>Valid certificate</p>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "rgba(255,255,255,0.55)" }}>
                  This certificate was issued by {result.orgName ?? "Airborne Aviation"}
                </p>
              </div>
            </div>

            <dl style={{ margin: 0, display: "grid", gap: 14 }}>
              <div>
                <dt style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", margin: 0 }}>
                  Recipient
                </dt>
                <dd style={{ margin: "4px 0 0", fontSize: 18, fontWeight: 600 }}>{result.studentName}</dd>
              </div>
              <div>
                <dt style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", margin: 0 }}>
                  Course
                </dt>
                <dd style={{ margin: "4px 0 0", fontSize: 16, fontWeight: 500 }}>{result.courseTitle}</dd>
              </div>
              {issuedDate && (
                <div>
                  <dt style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", margin: 0 }}>
                    Date of issue
                  </dt>
                  <dd style={{ margin: "4px 0 0", fontSize: 14 }}>{issuedDate}</dd>
                </div>
              )}
              <div>
                <dt style={{ fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.4)", margin: 0 }}>
                  Certificate no.
                </dt>
                <dd
                  style={{
                    margin: "4px 0 0",
                    fontSize: 13,
                    fontFamily: "ui-monospace, monospace",
                    color: "rgba(255,255,255,0.75)",
                    wordBreak: "break-all",
                  }}
                >
                  {result.certificateNo}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </div>

      <p style={{ marginTop: 28, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>
        Questions?{" "}
        <Link href="/login" style={{ color: "rgba(255,255,255,0.55)", textDecoration: "underline" }}>
          Contact Airborne Aviation
        </Link>
      </p>
    </div>
  );
}
