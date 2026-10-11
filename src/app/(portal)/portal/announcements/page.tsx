"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { MePayload } from "@/components/portal/types";
import {
  PortalPageHeader,
  GlassCard,
  EmptyState,
  MotionSection,
  StatusPill,
} from "@/components/portal/portal-ui";
import { TextSkeleton, CardSkeleton } from "@/components/portal/portal-skeleton";
import { Megaphone } from "lucide-react";

export default function PortalAnnouncementsPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["lms-me"],
    queryFn: () => apiFetch<MePayload>("/lms/me"),
  });

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <TextSkeleton className="h-8 w-52" />
        <CardSkeleton className="h-32" />
        <CardSkeleton className="h-32" />
      </div>
    );
  }

  if (isError || !data) {
    return <EmptyState icon={Megaphone} title="Unable to load announcements" />;
  }

  const items = [...(data.announcements ?? [])].sort((a, b) => {
    const da = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const db = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return db - da;
  });

  return (
    <MotionSection>
      <PortalPageHeader
        eyebrow="Academy board"
        title="Announcements"
        description="Schedule changes, exam notices, and academy updates from your instructors."
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="All quiet on the flight line"
          description="When faculty publish announcements, they will appear here."
        />
      ) : (
        <div className="space-y-4">
          {items.map((a) => (
            <GlassCard key={a.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusPill tone="brand">Notice</StatusPill>
                {a.publishedAt && (
                  <span className="text-[10px] uppercase tracking-wider text-white/35">
                    {new Date(a.publishedAt).toLocaleDateString(undefined, {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                )}
              </div>
              <h2 className="text-lg font-semibold text-white">{a.title}</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/55">{a.body}</p>
            </GlassCard>
          ))}
        </div>
      )}
    </MotionSection>
  );
}
