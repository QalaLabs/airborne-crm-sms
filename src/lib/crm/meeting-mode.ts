/**
 * Meeting mode for MEETING activities, persisted as `metadata.mode`.
 * Meetings created before modes existed have no value and read as null.
 */
export const MEETING_MODES = ["ONLINE", "OFFLINE", "CAMPUS_VISIT"] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

export const MEETING_MODE_LABELS: Record<MeetingMode, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  CAMPUS_VISIT: "Campus Visit",
};

export function isMeetingMode(value: unknown): value is MeetingMode {
  return typeof value === "string" && (MEETING_MODES as readonly string[]).includes(value);
}

export function readMeetingMode(metadata: unknown): MeetingMode | null {
  const mode = (metadata as { mode?: unknown } | null | undefined)?.mode;
  return isMeetingMode(mode) ? mode : null;
}

/** Merges a validated mode into metadata; an explicit `mode` wins over any value inside metadata. */
export function withMeetingMode(
  metadata: Record<string, unknown> | undefined,
  mode: MeetingMode | undefined,
): Record<string, unknown> | undefined {
  if (mode === undefined) return metadata;
  return { ...(metadata ?? {}), mode };
}
