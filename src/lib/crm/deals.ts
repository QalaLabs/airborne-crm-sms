import { apiFetch } from "@/lib/api";
import type { DealData, DealRecord, DealRecordFilters } from "./types";
import type { AdmissionStage, LeadSource } from "@prisma/client";

export async function getDealsData(): Promise<DealData> {
  return apiFetch<DealData>("/crm/deals");
}

export async function getDeals(
  filters: DealRecordFilters = {},
): Promise<{ data: DealRecord[]; meta: { page: number; perPage: number; total: number; totalPages: number } }> {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== "") search.set(k, String(v));
  }
  const qs = search.toString();
  const res = await fetch(`/api/v1/deals${qs ? `?${qs}` : ""}`, { credentials: "include" });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    throw new Error(err?.error?.message ?? `HTTP ${res.status}`);
  }
  const payload = (await res.json()) as { data: DealRecord[]; meta: Record<string, string> };
  return {
    data: payload.data,
    meta: {
      page: Number(payload.meta?.page ?? 1),
      perPage: Number(payload.meta?.perPage ?? payload.data.length),
      total: Number(payload.meta?.total ?? payload.data.length),
      totalPages: Number(payload.meta?.totalPages ?? 1),
    },
  };
}

export async function getDeal(id: string): Promise<DealRecord> {
  return apiFetch<DealRecord>(`/deals/${id}`);
}

export function buildDealQuery(
  base: URLSearchParams,
  filters: DealRecordFilters,
): URLSearchParams {
  const url = new URLSearchParams(base);
  for (const [k, v] of Object.entries(filters)) {
    if (v !== undefined && v !== null && v !== "") url.set(k, String(v));
  }
  return url;
}

export interface CreateDealPayload {
  leadId: string;
  title: string;
  stage?: AdmissionStage;
  value?: number;
  currency?: string;
  expectedCloseAt?: string;
  source?: LeadSource;
  assignedTo?: string;
  notes?: string;
}

export async function createDeal(payload: CreateDealPayload) {
  return apiFetch<DealRecord>("/deals", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateDeal(id: string, payload: Partial<CreateDealPayload> & { lostReason?: string }) {
  return apiFetch<DealRecord>(`/deals/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export async function assignDeal(id: string, counselorId: string) {
  return apiFetch<{ ok: true }>(`/deals/${id}/assign`, { method: "POST", body: JSON.stringify({ counselorId }) });
}

export async function convertDealToAdmission(id: string, payload: { courseName?: string; counselorId?: string; campusId?: string; feeAmount?: number; notes?: string } = {}) {
  return apiFetch<{ admission: { id: string; applicationNo: string; stage: string }; created: boolean }>(
    `/deals/${id}/convert-to-admission`,
    { method: "POST", body: JSON.stringify(payload) },
  );
}

export async function revertDealToProspect(id: string, notes?: string) {
  return apiFetch<DealRecord>(`/deals/${id}/revert-to-prospect`, {
    method: "POST",
    body: JSON.stringify({ notes }),
  });
}

export async function bulkAssignLeads(leadIds: string[], counselorId: string, note?: string) {
  return apiFetch<{ ok: true; count: number }>("/leads/bulk-assign", {
    method: "POST",
    body: JSON.stringify({ leadIds, counselorId, note }),
  });
}