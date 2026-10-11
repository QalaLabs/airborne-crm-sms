import { apiFetch } from "@/lib/api";
import type { Meeting, MeetingsData } from "./types";
import type { MeetingMode } from "./meeting-mode";

export async function getMeetings(
  scope: "upcoming" | "past" | "all" = "upcoming",
  q?: string,
): Promise<MeetingsData> {
  const params = new URLSearchParams({ scope });
  if (q) params.set("q", q);
  return apiFetch<MeetingsData>(`/crm/meetings?${params.toString()}`);
}

export interface ScheduleMeetingInput {
  leadId: string;
  title?: string;
  dueAt: string;
  durationMins?: number;
  mode?: MeetingMode;
  notes?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

export async function scheduleMeeting(input: ScheduleMeetingInput): Promise<Meeting> {
  return apiFetch<Meeting>("/crm/meetings", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface UpdateMeetingInput {
  title?: string;
  dueAt?: string;
  durationMins?: number;
  mode?: MeetingMode;
  notes?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

/** Reschedule / edit a persisted meeting. */
export async function updateMeeting(id: string, input: UpdateMeetingInput): Promise<Meeting> {
  return apiFetch<Meeting>(`/crm/meetings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

/** Cancel a meeting (kept for audit with outcome=CANCELLED). */
export async function cancelMeeting(id: string): Promise<Meeting> {
  return apiFetch<Meeting>(`/crm/meetings/${id}`, { method: "DELETE" });
}
