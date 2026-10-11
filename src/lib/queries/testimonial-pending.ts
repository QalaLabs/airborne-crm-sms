"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

/**
 * Single source for the "pending review" testimonial count. Sidebar badge and
 * page header share this query key, and any invalidation of ["testimonials"]
 * refreshes both.
 */
export const PENDING_TESTIMONIALS_QUERY_KEY = ["testimonials", "pending-count"] as const;

export function pendingCountFromResponse(res: { count?: unknown } | null | undefined): number {
  const n = Number(res?.count);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function usePendingTestimonialCount() {
  const query = useQuery({
    queryKey: PENDING_TESTIMONIALS_QUERY_KEY,
    queryFn: () => apiFetch<{ count: number }>("/testimonials/pending-count"),
    refetchInterval: 60_000,
  });
  return { ...query, count: pendingCountFromResponse(query.data) };
}
