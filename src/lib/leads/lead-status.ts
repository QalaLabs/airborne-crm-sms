import { LeadStatus } from "@prisma/client";

/**
 * Phase 2 lead status workflow hierarchy.
 *
 * Level 1 (pipeline stage):
 *   NEW, CONNECTED, NOT_CONNECTED, LOST
 * Level 2 (Connected):
 *   CALL_BACK, INTERESTED, PROSPECT, WON
 * Level 2 (Not Connected):
 *   RINGING, NOT_REACHABLE, SWITCHED_OFF, VOICEMAIL
 * Level 2 (Lost reasons):
 *   INCOMING_BARD, OUT_OF_SERVICE, NOT_AWARE, NOT_CONTACTABLE,
 *   LOCATION_OUT_OF_SCOPE, LANGUAGE_BARRIER, PRICE_HIGH, JOINED_OTHERS,
 *   NOT_ELIGIBLE, INVALID_NUMBER, TEST_LEAD,
 *   NOT_INTERESTED, REASON_NOT_SHARED, JOB_SEEKER
 *
 * Legacy values (CONTACTED / FOLLOW_UP / COUNSELED / APPLICATION_SUBMITTED)
 * remain in the DB enum for backward compatibility with historical data and
 * automations; new leads use the Phased 2 hierarchy above.
 *
 * Canonical transition rules (Section 3, Phase B/N):
 *   - The DB enum is the ONLY vocabulary for lead status.
 *   - WON / CONVERTED are SYSTEM-ONLY terminal states (reached by admission
 *     enrollment / deal-won); a generic lead status PATCH cannot set them.
 *   - Entering any LOST status persists a loss reason (the status itself is a
 *     taxonomy value; REASON_NOT_SHARED is a first-class persisted reason).
 *   - Entering PROSPECT ensures a Deal record exists (auto-created,
 *     idempotent + concurrency-safe via deals(orgId, leadId) unique).
 *   - Prior lead statuses must be one of the transitions returned by
 *     getAllowedLeadStatuses(); service layer enforces it.
 */

export interface LeadStatusLevel {
  key: string;
  label: string;
  statuses: LeadStatus[];
}

export const LEAD_STATUS_HIERARCHY: LeadStatusLevel[] = [
  {
    key: "L1_CONNECTED_GROUP",
    label: "Connected",
    statuses: [
      LeadStatus.NEW,
      LeadStatus.CONNECTED,
      LeadStatus.CALL_BACK,
      LeadStatus.INTERESTED,
      LeadStatus.PROSPECT,
      LeadStatus.WON,
    ],
  },
  {
    key: "L1_NOT_CONNECTED_GROUP",
    label: "Not Connected",
    statuses: [
      LeadStatus.NOT_CONNECTED,
      LeadStatus.RINGING,
      LeadStatus.NOT_REACHABLE,
      LeadStatus.SWITCHED_OFF,
      LeadStatus.VOICEMAIL,
    ],
  },
  {
    key: "L1_LOST_GROUP",
    label: "Lost",
    statuses: [
      LeadStatus.LOST,
      LeadStatus.INCOMING_BARD,
      LeadStatus.OUT_OF_SERVICE,
      LeadStatus.NOT_AWARE,
      LeadStatus.NOT_CONTACTABLE,
      LeadStatus.LOCATION_OUT_OF_SCOPE,
      LeadStatus.LANGUAGE_BARRIER,
      LeadStatus.PRICE_HIGH,
      LeadStatus.JOINED_OTHERS,
      LeadStatus.NOT_ELIGIBLE,
      LeadStatus.INVALID_NUMBER,
      LeadStatus.TEST_LEAD,
      LeadStatus.NOT_INTERESTED,
      LeadStatus.REASON_NOT_SHARED,
      LeadStatus.JOB_SEEKER,
    ],
  },
];

/** Flat list of every selectable status in the workflow. */
export const ALL_LEAD_STATUSES: LeadStatus[] = LEAD_STATUS_HIERARCHY.flatMap(
  (level) => level.statuses,
);

/** Lost / terminal statuses (used to disqualify a lead from conversion). */
export const LOST_STATUSES: LeadStatus[] = [
  LeadStatus.LOST,
  LeadStatus.INCOMING_BARD,
  LeadStatus.OUT_OF_SERVICE,
  LeadStatus.NOT_AWARE,
  LeadStatus.NOT_CONTACTABLE,
  LeadStatus.LOCATION_OUT_OF_SCOPE,
  LeadStatus.LANGUAGE_BARRIER,
  LeadStatus.PRICE_HIGH,
  LeadStatus.JOINED_OTHERS,
  LeadStatus.NOT_ELIGIBLE,
  LeadStatus.INVALID_NUMBER,
  LeadStatus.TEST_LEAD,
  LeadStatus.NOT_INTERESTED,
  LeadStatus.REASON_NOT_SHARED,
  LeadStatus.JOB_SEEKER,
];

/** Default persisted loss-reason text for reason-only lost statuses. */
export const LOSS_REASON_DEFAULT_TEXT: Partial<Record<LeadStatus, string>> = {
  [LeadStatus.NOT_INTERESTED]: "Not interested in the course",
  [LeadStatus.REASON_NOT_SHARED]: "Not Interested — Reason Not Shared",
  [LeadStatus.JOB_SEEKER]: "Lead is job-seeking, not a course prospect",
  [LeadStatus.NOT_ELIGIBLE]: "Not eligible for the course",
  [LeadStatus.PRICE_HIGH]: "Price / budget mismatch",
  [LeadStatus.LOCATION_OUT_OF_SCOPE]: "Location out of scope",
  [LeadStatus.LANGUAGE_BARRIER]: "Language barrier",
  [LeadStatus.INVALID_NUMBER]: "Invalid phone number",
  [LeadStatus.TEST_LEAD]: "Test lead",
};

/** Productive statuses for funnel metrics. */
export const CONNECTED_STATUSES: LeadStatus[] = [
  LeadStatus.CONNECTED,
  LeadStatus.CALL_BACK,
  LeadStatus.INTERESTED,
  LeadStatus.PROSPECT,
  LeadStatus.WON,
];

/**
 * Active (non-terminal) leads for the default CRM list view.
 * Excludes LOST* reasons, WON, and CONVERTED so counselors see working pipeline only.
 * Maps spreadsheet "NEW / CONTACTED / ENGAGED" → NEW + CONNECTED/CONTACTED + engaged stages.
 */
export const ACTIVE_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONTACTED,
  LeadStatus.CONNECTED,
  LeadStatus.CALL_BACK,
  LeadStatus.INTERESTED,
  LeadStatus.PROSPECT,
  LeadStatus.FOLLOW_UP,
  LeadStatus.COUNSELED,
  LeadStatus.APPLICATION_SUBMITTED,
  LeadStatus.NOT_CONNECTED,
  LeadStatus.RINGING,
  LeadStatus.NOT_REACHABLE,
  LeadStatus.SWITCHED_OFF,
  LeadStatus.VOICEMAIL,
];

/** "Today's Follow-ups" statuses (per Phase 2 spec). */
export const TODAY_FOLLOW_UP_STATUSES: LeadStatus[] = [
  LeadStatus.CALL_BACK,
  LeadStatus.NOT_CONNECTED,
  LeadStatus.NOT_CONTACTABLE,
  LeadStatus.INTERESTED,
  LeadStatus.PROSPECT,
];

/** "Today's Opportunity Sales" originate from Prospect-stage leads. */
export const OPPORTUNITY_STATUS: LeadStatus = LeadStatus.PROSPECT;

export const WON_STATUS: LeadStatus = LeadStatus.WON;

export function isLostStatus(status: LeadStatus): boolean {
  return LOST_STATUSES.includes(status);
}

export function isActiveStatus(status: LeadStatus): boolean {
  return ACTIVE_LEAD_STATUSES.includes(status);
}

/** Human readable label for a status value (e.g. LOCATION_OUT_OF_SCOPE → Location Out Of Scope). */
const STATUS_LABEL_OVERRIDES: Record<string, string> = {
  NOT_INTERESTED: "Not Interested",
  REASON_NOT_SHARED: "Not Interested - Reason Not Shared",
  JOB_SEEKER: "Job Seeker",
  CALL_BACK: "Call Back",
  INCOMING_BARD: "Incoming Barred",
};

export function statusLabel(status: string): string {
  const override = STATUS_LABEL_OVERRIDES[status];
  if (override) return override;
  return status
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Tailwind badge classes per status (shared with status-badge). */
export const LEAD_STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  CONTACTED: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  INTERESTED: "bg-green-500/20 text-green-400 border-green-500/30",
  NOT_INTERESTED: "bg-red-500/20 text-red-400 border-red-500/30",
  REASON_NOT_SHARED: "bg-red-500/10 text-red-400 border-red-500/30",
  JOB_SEEKER: "bg-red-500/10 text-red-400 border-red-500/30",
  FOLLOW_UP: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  COUNSELED: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  APPLICATION_SUBMITTED: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  CONVERTED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  LOST: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  CONNECTED: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  CALL_BACK: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  PROSPECT: "bg-lime-500/20 text-lime-400 border-lime-500/30",
  WON: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  NOT_CONNECTED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  RINGING: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  NOT_REACHABLE: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  SWITCHED_OFF: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  VOICEMAIL: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  INCOMING_BARD: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  OUT_OF_SERVICE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  NOT_AWARE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  NOT_CONTACTABLE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  LOCATION_OUT_OF_SCOPE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  LANGUAGE_BARRIER: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  PRICE_HIGH: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  JOINED_OTHERS: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  NOT_ELIGIBLE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  INVALID_NUMBER: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  TEST_LEAD: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

/**
 * System-only terminal statuses: reached exclusively by the conversion path
 * (deal won → admission enrolled → lead CONVERTED, or direct admission
 * enrollment). A generic lead status change cannot enter these.
 */
export const LOCKED_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.WON,
  LeadStatus.CONVERTED,
];

/**
 * Statuses a counselor may pick when creating a lead. PROSPECT is excluded
 * because it opens a Deal; WON/CONVERTED are system-only; lost and legacy
 * statuses are not valid starting points.
 */
export const INITIAL_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.NEW,
  LeadStatus.CONNECTED,
  LeadStatus.CALL_BACK,
  LeadStatus.INTERESTED,
  LeadStatus.NOT_CONNECTED,
  LeadStatus.RINGING,
  LeadStatus.NOT_REACHABLE,
  LeadStatus.SWITCHED_OFF,
  LeadStatus.VOICEMAIL,
];

export function isInitialLeadStatus(status: string): status is LeadStatus {
  return (INITIAL_LEAD_STATUSES as string[]).includes(status);
}

/** Legacy statuses preserved in the DB enum for historical data/automation. */
export const LEGACY_LEAD_STATUSES: LeadStatus[] = [
  LeadStatus.CONTACTED,
  LeadStatus.FOLLOW_UP,
  LeadStatus.COUNSELED,
  LeadStatus.APPLICATION_SUBMITTED,
];

/**
 * Canonical validated transition model (Phase B/N).
 *
 * Returns every status a lead may be moved to from `from`:
 *  - WON / CONVERTED: locked (no manual moves).
 *  - APPLICATION_SUBMITTED (legacy): only lost-statuses or PROSPECT re-open.
 *  - Lost statuses: any active status (re-open) or another lost reason.
 *  - Everything else: any status that is not system-locked.
 *
 * NOTE: the vocabulary is bounded by the DB enum; this function guarantees
 * intent (e.g. no manual WON), not string freedom.
 */
export function getAllowedLeadStatuses(from: LeadStatus): LeadStatus[] {
  if (LOCKED_LEAD_STATUSES.includes(from)) return [];
  const allMinusLocked = [
    ...ALL_LEAD_STATUSES,
    ...LEGACY_LEAD_STATUSES,
  ].filter((s) => !LOCKED_LEAD_STATUSES.includes(s));
  if (from === LeadStatus.APPLICATION_SUBMITTED) {
    return [...LOST_STATUSES, LeadStatus.PROSPECT];
  }
  return allMinusLocked;
}

/** Canonical guard used by the service layer before any status write. */
export function canTransitionLeadStatus(
  from: LeadStatus,
  to: LeadStatus,
): boolean {
  if (from === to) return true;
  return getAllowedLeadStatuses(from).includes(to);
}