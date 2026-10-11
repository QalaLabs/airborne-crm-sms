import { prisma } from "@/lib/db/client";
import type { TimelineQuery } from "@/lib/validations/timeline.schema";

// ─── Unified timeline ────────────────────────────────────────────────────────
//
// One chronological stream per entity, merging the three write paths that
// already exist in the system:
//   * activity    — LeadActivity rows (manual + automation-written)
//   * notification— NotificationLog rows (email/WhatsApp/SMS dispatches)
//   * automation  — WorkflowRun lifecycle for the entity
//
// No new tables: this is a read-model over existing data. Storage casing
// conventions differ per source (feed/notification use lowercase object types,
// WorkflowRun stores uppercase) and are mapped here.

export type TimelineKind = "activity" | "notification" | "automation";

export interface TimelineEntry {
  id: string;
  kind: TimelineKind;
  at: string;
  title: string;
  detail?: string | null;
  status?: string | null;
  channel?: string | null;
  actorName?: string | null;
  workflowName?: string | null;
  /** activity entries only */
  activityType?: string | null;
}

// Feed/notification rows use lowercase singular object types.
const LOWERCASE_TYPE: Record<TimelineQuery["entityType"], string> = {
  LEAD: "lead",
  ADMISSION: "admission",
  PAYMENT: "payment",
  STUDENT: "student",
};

// Per-source fetch window. Clamped to the true per-source count so late pages
// never silently lose entries (Section 5 fix: `total` and the merged items must
// agree — the old implementation capped sources at 300 while reporting unbounded
// totals, which produced missing/out-of-order entries on deep pages).
const MAX_WINDOW = 1000;

export class TimelineService {
  static async getTimeline(orgId: string, query: TimelineQuery): Promise<{
    items: TimelineEntry[];
    total: number;
  }> {
    const lower = LOWERCASE_TYPE[query.entityType];
    const pageOffset = (query.page - 1) * query.limit;

    // LeadActivity rows are lead-scoped; other entity types have none.
    const activityWhere = query.entityType === "LEAD"
      ? { orgId, leadId: query.entityId }
      : { orgId, id: "00000000-0000-0000-0000-000000000000" };

    // Counts first — the merged stream may never exceed what we actually fetch.
    const [activityCount, notificationCount, runCount] = await Promise.all([
      prisma.leadActivity.count({ where: activityWhere }),
      prisma.notificationLog.count({ where: { orgId, entityType: lower, entityId: query.entityId } }),
      prisma.workflowRun.count({ where: { orgId, entityType: query.entityType, entityId: query.entityId } }),
    ]);

    const cap = (count: number) => Math.min(count, MAX_WINDOW);
    const available = pageOffset + query.limit;
    const takeActivity = Math.min(cap(activityCount), available);
    const takeNotification = Math.min(cap(notificationCount), available);
    const takeRun = Math.min(cap(runCount), available);

    const [activities, notifications, runs] = await Promise.all([
      prisma.leadActivity.findMany({
        where: activityWhere,
        orderBy: { createdAt: "desc" },
        take: takeActivity,
        select: {
          id: true,
          activityType: true,
          title: true,
          notes: true,
          outcome: true,
          dueAt: true,
          completedAt: true,
          createdAt: true,
          performer: { select: { name: true } },
        },
      }),
      prisma.notificationLog.findMany({
        where: { orgId, entityType: lower, entityId: query.entityId },
        orderBy: { createdAt: "desc" },
        take: takeNotification,
        select: {
          id: true,
          event: true,
          channel: true,
          subject: true,
          body: true,
          status: true,
          errorMsg: true,
          recipient: true,
          createdAt: true,
        },
      }),
      prisma.workflowRun.findMany({
        where: { orgId, entityType: query.entityType, entityId: query.entityId },
        orderBy: { startedAt: "desc" },
        take: takeRun,
        select: {
          id: true,
          status: true,
          error: true,
          stoppedReason: true,
          startedAt: true,
          workflow: { select: { name: true } },
          triggerer: { select: { name: true } },
        },
      }),
    ]);

    const entries: TimelineEntry[] = [
      ...activities.map((a): TimelineEntry => ({
        id: `activity:${a.id}`,
        kind: "activity",
        at: a.createdAt.toISOString(),
        title: a.title ?? a.activityType.replace(/_/g, " "),
        detail: a.notes,
        status:
          a.activityType === "TASK" ? (a.completedAt ? "DONE" : "OPEN") : (a.outcome ?? null),
        actorName: a.performer?.name ?? null,
        activityType: a.activityType,
      })),
      ...notifications.map((n): TimelineEntry => ({
        id: `notification:${n.id}`,
        kind: "notification",
        at: n.createdAt.toISOString(),
        title: n.event ? n.event.replace(/_/g, " ") : `${n.channel} message`,
        detail: n.subject ?? n.body ?? null,
        status: n.errorMsg ? `${n.status}: ${n.errorMsg}` : n.status,
        channel: n.channel,
        actorName: null,
      })),
      ...runs.map((r): TimelineEntry => ({
        id: `automation:${r.id}`,
        kind: "automation",
        at: r.startedAt.toISOString(),
        title: r.workflow.name,
        detail: r.stoppedReason ?? r.error ?? null,
        status: r.status,
        actorName: r.triggerer?.name ?? null,
        workflowName: r.workflow.name,
      })),
    ];

    // Deterministic order: newest first, ties broken by stable id so the merged
    // stream never shuffles between requests (Section 5 fix).
    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : a.id < b.id ? 1 : -1));

    return {
      items: entries.slice(pageOffset, pageOffset + query.limit),
      total: activityCount + notificationCount + runCount,
    };
  }
}
