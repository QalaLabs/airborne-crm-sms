import { prisma } from "@/lib/db/client";
import { getProvider } from "@/lib/messaging";
import { InteraktProvider } from "@/lib/messaging/providers/interakt.provider";
import { splitIndianPhone } from "@/lib/messaging/phone";
import {
  INTERAKT_LEAD_CREATED_EVENT,
  interaktEventName,
  isLeadCreatedEventName,
  leadToCreatedEventTraits,
  leadToUserTags,
  leadToUserTraits,
  type LeadTrackSource,
} from "@/lib/messaging/providers/interakt/mapping";
import { normalizeCourseKey } from "@/lib/messaging/providers/interakt/course-routing";
import type { SendResult } from "@/lib/messaging/types";
import type { AppEvent } from "@/types";

const TRACK_EVENT_NAMES = new Set([
  "lead/created",
  "lead.created",
  "lead/status.changed",
  "lead.status_changed",
  "lead/assigned",
  "lead.assigned",
  "payment/received",
  "payment.success",
  "payment.pending",
  "payment.failed",
  "course.enrolled",
  "whatsapp.opted_out",
  "whatsapp.replied",
]);

const LEAD_SELECT = {
  id: true,
  name: true,
  email: true,
  phone: true,
  courseInterest: true,
  status: true,
  tags: true,
  city: true,
  source: true,
  whatsappOptOut: true,
  landingPage: true,
  utmCampaign: true,
  utmSource: true,
  utmMedium: true,
  utmTerm: true,
  utmContent: true,
  createdAt: true,
  customFields: true,
} as const;

type TrackData = {
  orgId: string;
  leadId?: string;
  studentId?: string;
  admissionId?: string;
  [key: string]: unknown;
};

export type InteraktSyncStatus =
  | "skipped"
  | "failed"
  | "contact_synced"
  | "event_sent";

export interface InteraktSyncSnapshot {
  eventSent: boolean;
  contactSynced: boolean;
  status: string;
  skipReason?: string | null;
}

export interface InteraktTrackDeps {
  getWhatsAppProvider: () => ReturnType<typeof getProvider>;
  findLead: (d: TrackData) => Promise<LeadTrackSource | null>;
  findSync: (leadId: string, eventName: string) => Promise<InteraktSyncSnapshot | null>;
  saveSync: (input: {
    orgId: string;
    leadId: string;
    eventName: string;
    status: InteraktSyncStatus;
    contactSynced: boolean;
    eventSent: boolean;
    courseKey?: string | null;
    leadSource?: string | null;
    skipReason?: string | null;
    providerUserId?: string | null;
    providerEventId?: string | null;
    workflowRef?: string | null;
    errorMessage?: string | null;
    retryCount?: number;
    succeededAt?: Date | null;
  }) => Promise<void>;
  writeActivity: (input: {
    orgId: string;
    leadId: string;
    title: string;
    notes: string;
    outcome: "success" | "failed" | "skipped";
    metadata: Record<string, unknown>;
  }) => Promise<void>;
  resolveWorkflowRef?: (orgId: string, courseKey: string) => Promise<string | null>;
}

export function isRetryableTrackResult(result: SendResult): boolean {
  if (result.retryable === true) return true;
  const code = result.code ?? "";
  return code === "TIMEOUT" || code === "NETWORK" || code === "RATE_LIMITED" || code === "UNEXPECTED";
}

function activityTitle(parts: { contact: boolean; event: boolean; failed: boolean; skipped: boolean }): string {
  if (parts.skipped) return "Interakt: skipped";
  if (parts.failed) return "Interakt: failed";
  if (parts.event) return "Interakt: lead_created sent";
  if (parts.contact) return "Interakt: contact synced";
  return "Interakt: pending";
}

async function defaultFindLead(d: TrackData): Promise<LeadTrackSource | null> {
  if (typeof d.leadId === "string") {
    return prisma.lead.findFirst({
      where: { id: d.leadId, orgId: d.orgId },
      select: LEAD_SELECT,
    });
  }
  if (typeof d.studentId === "string") {
    const student = await prisma.student.findFirst({
      where: { id: d.studentId, orgId: d.orgId },
      select: { leadId: true },
    });
    if (student?.leadId) return defaultFindLead({ ...d, leadId: student.leadId });
  }
  if (typeof d.admissionId === "string") {
    const admission = await prisma.admission.findFirst({
      where: { id: d.admissionId, orgId: d.orgId },
      select: { leadId: true },
    });
    if (admission?.leadId) return defaultFindLead({ ...d, leadId: admission.leadId });
  }
  return null;
}

async function defaultFindSync(leadId: string, eventName: string): Promise<InteraktSyncSnapshot | null> {
  return prisma.interaktLeadSync.findUnique({
    where: { leadId_eventName: { leadId, eventName } },
    select: { eventSent: true, contactSynced: true, status: true, skipReason: true },
  });
}

async function defaultSaveSync(input: Parameters<InteraktTrackDeps["saveSync"]>[0]): Promise<void> {
  await prisma.interaktLeadSync.upsert({
    where: { leadId_eventName: { leadId: input.leadId, eventName: input.eventName } },
    create: {
      orgId: input.orgId,
      leadId: input.leadId,
      eventName: input.eventName,
      status: input.status,
      contactSynced: input.contactSynced,
      eventSent: input.eventSent,
      courseKey: input.courseKey ?? null,
      leadSource: input.leadSource ?? null,
      skipReason: input.skipReason ?? null,
      providerUserId: input.providerUserId ?? null,
      providerEventId: input.providerEventId ?? null,
      workflowRef: input.workflowRef ?? null,
      errorMessage: input.errorMessage ?? null,
      retryCount: input.retryCount ?? 0,
      lastAttemptAt: new Date(),
      succeededAt: input.succeededAt ?? null,
    },
    update: {
      status: input.status,
      contactSynced: input.contactSynced,
      eventSent: input.eventSent,
      courseKey: input.courseKey ?? undefined,
      leadSource: input.leadSource ?? undefined,
      skipReason: input.skipReason ?? null,
      providerUserId: input.providerUserId ?? undefined,
      providerEventId: input.providerEventId ?? undefined,
      workflowRef: input.workflowRef ?? undefined,
      errorMessage: input.errorMessage ?? null,
      retryCount: { increment: 1 },
      lastAttemptAt: new Date(),
      succeededAt: input.succeededAt === undefined ? undefined : input.succeededAt,
    },
  });
}

async function defaultWriteActivity(input: Parameters<InteraktTrackDeps["writeActivity"]>[0]): Promise<void> {
  await prisma.leadActivity.create({
    data: {
      leadId: input.leadId,
      orgId: input.orgId,
      activityType: "SYSTEM",
      title: input.title,
      notes: input.notes,
      outcome: input.outcome,
      completedAt: new Date(),
      metadata: { provider: "interakt", ...input.metadata },
    },
  });
  await prisma.lead.update({
    where: { id: input.leadId },
    data: { lastActivityAt: new Date() },
  });
}

async function defaultResolveWorkflowRef(orgId: string, courseKey: string): Promise<string | null> {
  const row = await prisma.interaktAutomation.findFirst({
    where: { orgId, isActive: true, courseKey, triggerEvent: INTERAKT_LEAD_CREATED_EVENT },
    select: { workflowRef: true },
  });
  return row?.workflowRef ?? null;
}

export function createDefaultInteraktTrackDeps(): InteraktTrackDeps {
  return {
    getWhatsAppProvider: () => getProvider("WHATSAPP"),
    findLead: defaultFindLead,
    findSync: defaultFindSync,
    saveSync: defaultSaveSync,
    writeActivity: defaultWriteActivity,
    resolveWorkflowRef: defaultResolveWorkflowRef,
  };
}

/**
 * Server-side Interakt User/Event Track — no Inngest. Retries live in
 * InteraktClient + InternalEvent. Never reports success without provider OK.
 */
export async function syncInteraktTrack(event: AppEvent, deps?: InteraktTrackDeps): Promise<void> {
  if (!TRACK_EVENT_NAMES.has(event.name)) return;

  const d = { ...(event.data as Record<string, unknown>), orgId: event.orgId } as TrackData;
  const resolved = deps ?? createDefaultInteraktTrackDeps();
  const provider = resolved.getWhatsAppProvider();
  const eventName = interaktEventName(event.name);
  if (!eventName) return;

  const lead = await resolved.findLead(d);

  if (isLeadCreatedEventName(event.name)) {
    await syncLeadCreated(event.orgId, eventName, lead, provider, resolved);
    return;
  }

  if (!(provider instanceof InteraktProvider) || !provider.isConfigured()) return;
  if (!lead?.phone) return;

  const userResult = await provider.trackUser({
    userId: lead.id,
    phone: lead.phone,
    traits: leadToUserTraits(lead),
    tags: leadToUserTags(lead),
  });
  assertTrackOk(userResult, "contact sync");

  const traits: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(d)) {
    if (key === "orgId" || value === undefined) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      traits[key] = value;
    }
  }

  const eventResult = await provider.trackEvent({
    userId: lead.id,
    phone: lead.phone,
    event: eventName,
    traits,
  });
  assertTrackOk(eventResult, eventName);
}

async function syncLeadCreated(
  orgId: string,
  eventName: string,
  lead: LeadTrackSource | null,
  provider: ReturnType<typeof getProvider>,
  deps: InteraktTrackDeps,
): Promise<void> {
  const leadId = lead?.id;
  if (!leadId) return;

  const existing = await deps.findSync(leadId, eventName);
  if (existing?.eventSent) return;

  const courseKey = normalizeCourseKey(lead.courseInterest);
  const workflowRef = deps.resolveWorkflowRef
    ? await deps.resolveWorkflowRef(orgId, courseKey)
    : null;

  const persist = async (
    status: InteraktSyncStatus,
    extra: Partial<Parameters<InteraktTrackDeps["saveSync"]>[0]> & {
      title: string;
      notes: string;
      outcome: "success" | "failed" | "skipped";
      metadata?: Record<string, unknown>;
    },
  ) => {
    await deps.saveSync({
      orgId,
      leadId,
      eventName,
      status,
      contactSynced: extra.contactSynced ?? existing?.contactSynced ?? false,
      eventSent: extra.eventSent ?? false,
      courseKey,
      leadSource: lead.source ?? null,
      skipReason: extra.skipReason ?? null,
      providerUserId: extra.providerUserId ?? null,
      providerEventId: extra.providerEventId ?? null,
      workflowRef,
      errorMessage: extra.errorMessage ?? null,
      succeededAt: extra.succeededAt ?? null,
    });
    await deps.writeActivity({
      orgId,
      leadId,
      title: extra.title,
      notes: extra.notes,
      outcome: extra.outcome,
      metadata: {
        event: eventName,
        course: courseKey,
        workflowRef,
        ...(extra.metadata ?? {}),
      },
    });
  };

  if (!(provider instanceof InteraktProvider) || !provider.isConfigured()) {
    await persist("skipped", {
      skipReason: "interakt_not_configured",
      title: activityTitle({ contact: false, event: false, failed: false, skipped: true }),
      notes: "Interakt is not configured. Lead kept. WhatsApp automation was not started.",
      outcome: "skipped",
      metadata: { reason: "interakt_not_configured" },
    });
    return;
  }

  if (!lead.phone?.trim()) {
    await persist("skipped", {
      skipReason: "missing_phone",
      title: activityTitle({ contact: false, event: false, failed: false, skipped: true }),
      notes: "No phone on lead. Interakt contact/event not sent.",
      outcome: "skipped",
      metadata: { reason: "missing_phone" },
    });
    return;
  }

  if (!splitIndianPhone(lead.phone)) {
    await persist("failed", {
      skipReason: "invalid_phone",
      errorMessage: `Invalid +91 phone: ${lead.phone}`,
      title: activityTitle({ contact: false, event: false, failed: true, skipped: false }),
      notes: `Invalid phone — Interakt User Track requires a +91 national number. Lead kept.`,
      outcome: "failed",
      metadata: { reason: "invalid_phone" },
    });
    return;
  }

  let contactSynced = existing?.contactSynced ?? false;
  let providerUserId: string | null = null;

  if (!contactSynced) {
    const userResult = await provider.trackUser({
      userId: lead.id,
      phone: lead.phone,
      traits: leadToUserTraits(lead),
      tags: leadToUserTags(lead),
    });
    if (userResult.status !== "SENT") {
      await persist("failed", {
        contactSynced: false,
        errorMessage: userResult.errorMsg ?? "Contact sync failed",
        title: activityTitle({ contact: false, event: false, failed: true, skipped: false }),
        notes: `Contact sync failed: ${userResult.errorMsg ?? "unknown error"}`,
        outcome: "failed",
        metadata: { step: "track_user", code: userResult.code ?? null },
      });
      assertTrackOk(userResult, "contact sync");
      return;
    }
    contactSynced = true;
    providerUserId = userResult.externalId ?? lead.id;
    await deps.saveSync({
      orgId,
      leadId,
      eventName,
      status: "contact_synced",
      contactSynced: true,
      eventSent: false,
      courseKey,
      leadSource: lead.source ?? null,
      providerUserId,
      workflowRef,
      errorMessage: null,
    });
  }

  const eventResult = await provider.trackEvent({
    userId: lead.id,
    phone: lead.phone,
    event: eventName,
    traits: leadToCreatedEventTraits(lead),
  });

  if (eventResult.status !== "SENT") {
    await persist("failed", {
      contactSynced: true,
      providerUserId,
      errorMessage: eventResult.errorMsg ?? "lead_created event failed",
      title: activityTitle({ contact: true, event: false, failed: true, skipped: false }),
      notes: `Contact synced. lead_created event failed: ${eventResult.errorMsg ?? "unknown error"}`,
      outcome: "failed",
      metadata: { step: "track_event", code: eventResult.code ?? null },
    });
    assertTrackOk(eventResult, "lead_created");
    return;
  }

  await persist("event_sent", {
    contactSynced: true,
    eventSent: true,
    providerUserId,
    providerEventId: eventResult.externalId ?? null,
    succeededAt: new Date(),
    title: activityTitle({ contact: true, event: true, failed: false, skipped: false }),
    notes: `Contact synced. lead_created sent. Course trait=${courseKey}. Interakt Advanced owns delays and WhatsApp templates.`,
    outcome: "success",
    metadata: {
      step: "track_event",
      providerEventId: eventResult.externalId ?? null,
    },
  });
}

function assertTrackOk(result: SendResult, label: string): void {
  if (result.status === "SENT") return;
  if (result.status === "NOT_CONFIGURED") return;
  const message = result.errorMsg ?? `Interakt ${label} failed`;
  const error = new Error(message);
  if (isRetryableTrackResult(result)) throw error;
  if (result.code === "INVALID_PHONE" || result.code === "BAD_REQUEST" || result.code === "UNAUTHORIZED") {
    return;
  }
  throw error;
}
