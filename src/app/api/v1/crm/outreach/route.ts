import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { AppError } from "@/lib/utils/errors";
import {
  outreachTemplateSchema,
  toggleTemplateSchema,
} from "@/lib/validations/outreach.schema";
import { getProvider } from "@/lib/messaging";
import { isAutomationEngineEnabled } from "@/lib/events/dispatch";

// Provider status reflects the actual messaging registry (Section 5 — no fake
// configuration). `configured` = a transport exists and reports credentials;
// `verified` = a live provider round-trip succeeded (only Interakt exposes a
// live test today). A key in env is NOT enough to claim "connected".
function providerState(key: "email" | "sms" | "whatsapp") {
  const p = getProvider(key === "email" ? "EMAIL" : key === "sms" ? "SMS" : "WHATSAPP");
  const isConfigured = p.isConfigured();
  const configuredNow = isConfigured && p.name !== "noop";
  return {
    provider: p.name,
    configured: configuredNow,
    verified: false,
    status: configuredNow ? "configured_not_verified" : "not_configured",
    note: configuredNow
      ? "Transport has credentials. Live round-trip verification is available on the WhatsApp settings page for WhatsApp."
      : `${key} transport is not configured for this environment.`,
  };
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "notifications");

    const [templates, logs, statusCounts, whatsappReplies] = await Promise.all([
      prisma.notificationTemplate.findMany({
        where: { orgId: ctx.orgId },
        select: {
          id: true,
          event: true,
          channel: true,
          name: true,
          subject: true,
          body: true,
          variables: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.notificationLog.findMany({
        where: { orgId: ctx.orgId },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          event: true,
          channel: true,
          recipient: true,
          subject: true,
          status: true,
          errorMsg: true,
          externalId: true,
          entityType: true,
          entityId: true,
          sentAt: true,
          createdAt: true,
          template: { select: { id: true, name: true } },
        },
      }),
      prisma.notificationLog.groupBy({
        by: ["status"],
        where: { orgId: ctx.orgId },
        _count: { _all: true },
      }),
      // Real reply tracking: WhatsApp inbound replies persisted as WHATSAPP
      // activities by ingestInboundMessage. Emails have no read/reply tracking
      // yet — those rates are reported as null (never fake zeros).
      prisma.leadActivity.count({
        where: {
          orgId: ctx.orgId,
          activityType: "WHATSAPP",
          title: { startsWith: "WhatsApp reply" },
        },
      }),
    ]);

    const statusBreakdown: Record<string, number> = {};
    for (const row of statusCounts) {
      statusBreakdown[String(row.status).toUpperCase()] = row._count._all;
    }

    const sent = statusBreakdown.SENT ?? 0;
    const replyRate = sent > 0 && whatsappReplies > 0 ? whatsappReplies / sent : null;

    return ok({
      templates,
      logs,
      statusBreakdown,
      delivery: {
        total: logs.length,
        sent,
        failed: statusBreakdown.FAILED ?? 0,
        pending: statusBreakdown.PENDING ?? 0,
        whatsappReplies,
        // Honest rates: null means "not measurable with persisted data" —
        // never a fabricated 0.
        emailOpenRate: null,
        replyRate,
      },
      providers: {
        email: providerState("email"),
        sms: providerState("sms"),
        whatsapp: providerState("whatsapp"),
      },
      dispatchEngine: {
        automationEnabled: isAutomationEngineEnabled(),
        note: isAutomationEngineEnabled()
          ? "PostgreSQL internal_events + Cloud Scheduler cron dispatch workflow and notification side effects."
          : "Automation engine unavailable.",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "notifications");

    const body = (await req.json()) as unknown;
    const action = (body as { action?: string }).action;

    if (action === "toggle") {
      const input = toggleTemplateSchema.parse(body);
      const existing = await prisma.notificationTemplate.findFirst({
        where: { id: input.id, orgId: ctx.orgId },
      });
      if (!existing) {
        throw new AppError("NOT_FOUND", "Template not found", 404);
      }
      const updated = await prisma.notificationTemplate.update({
        where: { id: input.id },
        data: { isActive: input.isActive },
      });
      return ok(updated);
    }

    if (action === "create") {
      const input = outreachTemplateSchema.parse(body);
      const template = await prisma.notificationTemplate.create({
        data: {
          orgId: ctx.orgId,
          event: input.event,
          channel: input.channel,
          name: input.name,
          subject: input.subject ?? null,
          body: input.body,
          variables: input.variables,
          isActive: input.isActive ?? true,
        },
      });
      return created(template);
    }

    throw new AppError("BAD_REQUEST", "Unknown outreach action. Use action=toggle or action=create.", 400);
  } catch (err) {
    return handleError(err);
  }
}
