import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import { INTERAKT_LEAD_CREATED_EVENT } from "@/lib/messaging/providers/interakt/mapping";

export interface InteraktTemplateRef {
  name: string;
  configuredIn: "interakt";
}

export interface InteraktAutomationDefault {
  code: string;
  name: string;
  triggerEvent: string;
  courseKey: string | null;
  leadSourceGroup: string | null;
  templates: InteraktTemplateRef[];
  notes: string;
}

/**
 * Control-plane catalog. Execution lives in Interakt Advanced.
 * Template names are references only — Airborne does not send these
 * templates or guess bodyValues.
 */
export const DEFAULT_INTERAKT_AUTOMATIONS: InteraktAutomationDefault[] = [
  {
    code: "cpl-new-lead-nurture",
    name: "CPL New Lead Nurture",
    triggerEvent: INTERAKT_LEAD_CREATED_EVENT,
    courseKey: "dgca_cpl",
    leadSourceGroup: null,
    templates: [
      { name: "cpl_nurture_d1_welcome_brochure", configuredIn: "interakt" },
      { name: "cpl_nurture_d3_founder_video", configuredIn: "interakt" },
      { name: "cpl_nurture_d5_success_story", configuredIn: "interakt" },
    ],
    notes:
      "Interakt Advanced branch: course = dgca_cpl. Welcome / wait / follow-up / success story run in Interakt. Paste the Interakt workflow name below. Airborne does not send these templates or map body variables.",
  },
  {
    code: "cabin-crew-new-lead-nurture",
    name: "Cabin Crew New Lead Nurture",
    triggerEvent: INTERAKT_LEAD_CREATED_EVENT,
    courseKey: "cabin_crew",
    leadSourceGroup: null,
    templates: [],
    notes:
      "Interakt Advanced branch: course = cabin_crew. Add approved template code names after they exist in Interakt. Do not guess variable slots.",
  },
  {
    code: "cadet-pilot-new-lead-nurture",
    name: "Cadet Pilot New Lead Nurture",
    triggerEvent: INTERAKT_LEAD_CREATED_EVENT,
    courseKey: "cadet_pilot",
    leadSourceGroup: null,
    templates: [],
    notes:
      "Interakt Advanced branch: course = cadet_pilot. Add approved template code names after they exist in Interakt.",
  },
];

export interface InteraktAutomationView {
  id: string;
  code: string;
  name: string;
  triggerEvent: string;
  triggerLabel: string;
  courseKey: string | null;
  leadSourceGroup: string | null;
  provider: string;
  workflowRef: string | null;
  campaignRef: string | null;
  templates: InteraktTemplateRef[];
  isActive: boolean;
  notes: string | null;
  executionPlatform: "interakt";
  controlsExecution: false;
  lastExecutionAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
  leadsProcessed: number;
  leadsFailed: number;
  updatedAt: string;
}

function parseTemplates(value: unknown): InteraktTemplateRef[] {
  if (!Array.isArray(value)) return [];
  const out: InteraktTemplateRef[] = [];
  for (const item of value) {
    if (item && typeof item === "object" && typeof (item as { name?: unknown }).name === "string") {
      out.push({ name: (item as { name: string }).name, configuredIn: "interakt" });
    } else if (typeof item === "string" && item.trim()) {
      out.push({ name: item.trim(), configuredIn: "interakt" });
    }
  }
  return out;
}

export async function ensureDefaultInteraktAutomations(orgId: string): Promise<void> {
  for (const def of DEFAULT_INTERAKT_AUTOMATIONS) {
    await prisma.interaktAutomation.upsert({
      where: { orgId_code: { orgId, code: def.code } },
      create: {
        orgId,
        code: def.code,
        name: def.name,
        triggerEvent: def.triggerEvent,
        courseKey: def.courseKey,
        leadSourceGroup: def.leadSourceGroup,
        templates: def.templates as unknown as Prisma.InputJsonValue,
        notes: def.notes,
        isActive: true,
        provider: "interakt",
      },
      update: {},
    });
  }
}

export async function listInteraktAutomations(orgId: string): Promise<InteraktAutomationView[]> {
  await ensureDefaultInteraktAutomations(orgId);

  const rows = await prisma.interaktAutomation.findMany({
    where: { orgId },
    orderBy: { name: "asc" },
  });

  const views: InteraktAutomationView[] = [];
  for (const row of rows) {
    const courseKey = row.courseKey;
    const [last, processed, failed] = await Promise.all([
      prisma.interaktLeadSync.findFirst({
        where: {
          orgId,
          eventName: INTERAKT_LEAD_CREATED_EVENT,
          ...(courseKey ? { courseKey } : {}),
        },
        orderBy: { lastAttemptAt: "desc" },
        select: { lastAttemptAt: true, status: true, errorMessage: true },
      }),
      prisma.interaktLeadSync.count({
        where: {
          orgId,
          eventName: INTERAKT_LEAD_CREATED_EVENT,
          eventSent: true,
          ...(courseKey ? { courseKey } : {}),
        },
      }),
      prisma.interaktLeadSync.count({
        where: {
          orgId,
          eventName: INTERAKT_LEAD_CREATED_EVENT,
          status: "failed",
          ...(courseKey ? { courseKey } : {}),
        },
      }),
    ]);

    views.push({
      id: row.id,
      code: row.code,
      name: row.name,
      triggerEvent: row.triggerEvent,
      triggerLabel: "Lead Created",
      courseKey: row.courseKey,
      leadSourceGroup: row.leadSourceGroup,
      provider: row.provider,
      workflowRef: row.workflowRef,
      campaignRef: row.campaignRef,
      templates: parseTemplates(row.templates),
      isActive: row.isActive,
      notes: row.notes,
      executionPlatform: "interakt",
      controlsExecution: false,
      lastExecutionAt: last?.lastAttemptAt?.toISOString() ?? null,
      lastStatus: last?.status ?? null,
      lastError: last?.errorMessage ?? null,
      leadsProcessed: processed,
      leadsFailed: failed,
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  return views;
}

export async function updateInteraktAutomation(
  orgId: string,
  id: string,
  input: {
    workflowRef?: string | null;
    campaignRef?: string | null;
    isActive?: boolean;
    templates?: InteraktTemplateRef[];
    notes?: string | null;
  },
) {
  const existing = await prisma.interaktAutomation.findFirst({
    where: { id, orgId },
    select: { id: true },
  });
  if (!existing) return null;

  return prisma.interaktAutomation.update({
    where: { id },
    data: {
      ...(input.workflowRef !== undefined ? { workflowRef: input.workflowRef } : {}),
      ...(input.campaignRef !== undefined ? { campaignRef: input.campaignRef } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.templates !== undefined
        ? { templates: input.templates as unknown as Prisma.InputJsonValue }
        : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    },
  });
}

export async function getLeadInteraktStatus(orgId: string, leadId: string) {
  const [sync, automations, recentMessages] = await Promise.all([
    prisma.interaktLeadSync.findUnique({
      where: { leadId_eventName: { leadId, eventName: INTERAKT_LEAD_CREATED_EVENT } },
    }),
    prisma.interaktAutomation.findMany({
      where: { orgId, isActive: true, triggerEvent: INTERAKT_LEAD_CREATED_EVENT },
      select: { name: true, courseKey: true, workflowRef: true, isActive: true },
    }),
    prisma.whatsAppMessage.findMany({
      where: { orgId, conversation: { leadId } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        direction: true,
        status: true,
        templateName: true,
        externalId: true,
        createdAt: true,
        errorMsg: true,
      },
    }),
  ]);

  return {
    provider: "interakt",
    eventName: INTERAKT_LEAD_CREATED_EVENT,
    sync: sync
      ? {
          status: sync.status,
          contactSynced: sync.contactSynced,
          eventSent: sync.eventSent,
          courseKey: sync.courseKey,
          leadSource: sync.leadSource,
          providerUserId: sync.providerUserId,
          providerEventId: sync.providerEventId,
          workflowRef: sync.workflowRef,
          errorMessage: sync.errorMessage,
          retryCount: sync.retryCount,
          lastAttemptAt: sync.lastAttemptAt?.toISOString() ?? null,
          succeededAt: sync.succeededAt?.toISOString() ?? null,
        }
      : null,
    automations,
    recentMessages: recentMessages.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}
