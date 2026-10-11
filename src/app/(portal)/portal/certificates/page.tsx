"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Award, Download, ExternalLink, ShieldCheck, Copy } from "lucide-react";
import Link from "next/link";
import type { MePayload } from "@/components/portal/types";
import { CardSkeleton } from "@/components/portal/portal-skeleton";
import { toast } from "@/components/ui/use-toast";
import {
  PortalPageHeader,
  GlassCard,
  EmptyState,
  MotionSection,
  Stagger,
  StatusPill,
} from "@/components/portal/portal-ui";

export default function PortalCertificatesPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  const certs = data?.certificates ?? [];

  function copyToClipboard(text: string, label: string) {
    void navigator.clipboard.writeText(text).then(() => {
      toast({ title: `${label} copied`, description: text });
    });
  }

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <CardSkeleton className="h-20" />
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1, 2].map((i) => (
            <CardSkeleton key={i} className="h-52" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <MotionSection>
      <PortalPageHeader
        eyebrow="My Achievements"
        title="Certificates"
        description="Your issued course completion certificates from Airborne Aviation"
        action={
          certs.length > 0 ? (
            <StatusPill tone="success">{certs.length} earned</StatusPill>
          ) : undefined
        }
      />

      {certs.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No certificates yet"
          description="Complete your enrolled course modules and pass all assessments to earn your certificate."
          action={
            <Link href="/portal/courses" className="ab-btn ab-btn-primary px-4 py-2">
              View courses
            </Link>
          }
        />
      ) : (
        <Stagger className="grid gap-5 sm:grid-cols-2">
          {certs.map((c) => (
            <GlassCard
              key={c.id}
              soft
              className="border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.06] to-transparent"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20">
                  <Award className="h-6 w-6 text-emerald-400" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight text-white">{c.title}</p>
                  {c.course?.title && (
                    <p className="mt-0.5 text-xs text-white/50">{c.course.title}</p>
                  )}
                  {c.issuedAt && (
                    <p className="mt-1 text-[11px] text-white/35">
                      Issued{" "}
                      {new Date(c.issuedAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-1.5 rounded-xl border border-white/[0.08] bg-white/[0.03] p-3 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white/40">Certificate No.</span>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-white/80">{c.certificateNo}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(c.certificateNo, "Certificate number")}
                      aria-label="Copy certificate number"
                      className="rounded p-0.5 text-white/30 hover:text-white/70 transition-colors"
                    >
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {c.verificationCode && c.verificationCode !== c.certificateNo && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-white/40">Verification Code</span>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-white/80">{c.verificationCode}</span>
                      <button
                        type="button"
                        onClick={() => copyToClipboard(c.verificationCode!, "Verification code")}
                        aria-label="Copy verification code"
                        className="rounded p-0.5 text-white/30 hover:text-white/70 transition-colors"
                      >
                        <Copy className="h-3 w-3" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-white/40">Status</span>
                  <StatusPill tone="success">{c.status}</StatusPill>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {c.fileUrl && (
                  <a
                    href={c.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                    className="ab-btn ab-btn-primary px-3 py-2 text-xs"
                  >
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    Download
                  </a>
                )}
                <Link
                  href={`/portal/certificates/${c.certificateNo}/print`}
                  target="_blank"
                  className="ab-btn ab-btn-ghost px-3 py-2 text-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                  View / Print
                </Link>
                <a
                  href={`/verify/${encodeURIComponent(c.verificationCode ?? c.certificateNo)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ab-btn ab-btn-ghost border-emerald-500/30 px-3 py-2 text-xs text-emerald-400/80 hover:bg-emerald-500/10"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  Verify
                </a>
              </div>
            </GlassCard>
          ))}
        </Stagger>
      )}
    </MotionSection>
  );
}
