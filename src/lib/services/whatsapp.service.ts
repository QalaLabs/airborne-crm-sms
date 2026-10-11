import { prisma } from "@/lib/db/client";
import type { Prisma, NotificationEvent } from "@prisma/client";
import { getProvider } from "@/lib/messaging";
import {
  isOptInKeyword,
  isOptOutKeyword,
  normalizePhone,
  type InboundWhatsAppMessage,
} from "@/lib/messaging/inbound";
import { InteraktProvider, maskSecret } from "@/lib/messaging/providers/interakt.provider";
import { contactCandidates } from "@/lib/messaging/phone";
import {
  getDefaultInboxTemplateVariableNames,
  getInteraktDefaultTemplate,
} from "@/lib/messaging/providers/interakt/config";
import { buildInboxTemplatePayload } from "@/lib/messaging/providers/interakt/inbox-template";
import { MockWhatsAppProvider } from "@/lib/messaging/providers/mock.provider";
import {
  isInteraktWebhookPayload,
  parseInteraktWebhook,
  providerEventId,
  shouldUpgradeStatus,
  type NormalizedInteraktWebhook,
} from "@/lib/messaging/providers/interakt/webhooks";
import { persistEventForWebhook } from "@/lib/events/dispatch";
import { AuditService } from "@/lib/services/audit.service";
import { validUuid } from "@/lib/events/actor";
import { NotFoundError, ConflictError } from "@/lib/utils/errors";
import {
  extractTemplateVariables,
  type ConversationFilters,
  type ContactFilters,
  type CampaignFilters,
} from "@/lib/validations/whatsapp.schema";
import type { RequestContext } from "@/types";

// ─── WhatsApp service ────────────────────────────────────────────────────────
//
// Backend for the WhatsApp admin UI. All sends go through the messaging
// provider registry — when no provider is configured every send honestly
// reports NOT_CONFIGURED and nothing is ever faked as delivered.

const CONVERSATION_SELECT = {
  id: true,
  phone: true,
  leadId: true,
  lastMessageAt: true,
  lastMessagePreview: true,
  unreadCount: true,
  optedOut: true,
  archived: true,
  createdAt: true,
  updatedAt: true,
  lead: { select: { id: true, name: true, status: true } },
} satisfies Prisma.WhatsAppConversationSelect;

const CAMPAIGN_SELECT = {
  id: true,
  name: true,
  message: true,
  templateName: true,
  audienceFilter: true,
  status: true,
  totalRecipients: true,
  sentCount: true,
  failedCount: true,
  skippedCount: true,
  launchedBy: true,
  launchedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.WhatsAppCampaignSelect;

export class WhatsAppService {
  // ─── Overview ───────────────────────────────────────────────────────────────

  static async getOverview(orgId: string) {
    const since = new Date(Date.now() - 7 * 86_400_000);

    const [conversations, unread, optedOut, messages7d, inbound7d, failed7d, templates, automations] =
      await Promise.all([
        prisma.whatsAppConversation.count({ where: { orgId, archived: false } }),
        prisma.whatsAppConversation.count({ where: { orgId, unreadCount: { gt: 0 }, archived: false } }),
        prisma.lead.count({ where: { orgId, whatsappOptOut: true } }),
        prisma.whatsAppMessage.count({ where: { orgId, direction: "OUT", createdAt: { gte: since } } }),
        prisma.whatsAppMessage.count({ where: { orgId, direction: "IN", createdAt: { gte: since } } }),
        prisma.whatsAppMessage.count({ where: { orgId, direction: "OUT", status: "FAILED", createdAt: { gte: since } } }),
        prisma.notificationTemplate.count({ where: { orgId, channel: "WHATSAPP", isActive: true } }),
        prisma.interaktAutomation.count({ where: { orgId, isActive: true } }),
      ]);

    const provider = getProvider("WHATSAPP");

    return {
      providerConfigured: provider.isConfigured(),
      providerName: provider.name,
      conversations,
      unread,
      optedOutContacts: optedOut,
      messagesSent7d: messages7d,
      messagesReceived7d: inbound7d,
      messagesFailed7d: failed7d,
      activeTemplates: templates,
      activeAutomations: automations,
    };
  }

  // ─── Inbox ──────────────────────────────────────────────────────────────────

  static async listConversations(orgId: string, filters: ConversationFilters) {
    const where: Prisma.WhatsAppConversationWhereInput = {
      orgId,
      ...(filters.archived !== undefined && { archived: filters.archived }),
      ...(filters.search && {
        OR: [
          { phone: { contains: filters.search } },
          { lead: { name: { contains: filters.search, mode: "insensitive" as const } } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      prisma.whatsAppConversation.findMany({
        where,
        select: CONVERSATION_SELECT,
        orderBy: [{ lastMessageAt: "desc" }, { updatedAt: "desc" }],
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.whatsAppConversation.count({ where }),
    ]);

    return { data, total };
  }

  static async getMessages(orgId: string, conversationId: string) {
    const conversation = await prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, orgId },
      select: CONVERSATION_SELECT,
    });
    if (!conversation) throw new NotFoundError("Conversation", conversationId);

    const messages = await prisma.whatsAppMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: "asc" },
      take: 200,
      select: {
        id: true,
        direction: true,
        body: true,
        templateName: true,
        status: true,
        errorMsg: true,
        campaignId: true,
        createdAt: true,
        sender: { select: { name: true } },
      },
    });

    return { conversation, messages };
  }

  static async updateConversation(
    ctx: RequestContext,
    conversationId: string,
    input: { markRead?: boolean; archived?: boolean },
  ) {
    const existing = await prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, orgId: ctx.orgId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundError("Conversation", conversationId);

    return prisma.whatsAppConversation.update({
      where: { id: conversationId },
      data: {
        ...(input.markRead && { unreadCount: 0 }),
        ...(input.archived !== undefined && { archived: input.archived }),
      },
      select: CONVERSATION_SELECT,
    });
  }

  /** Manual inbox send — dispatches an approved Interakt template (not free-form text). */
  static async sendMessage(ctx: RequestContext, conversationId: string, body: string) {
    const conversation = await prisma.whatsAppConversation.findFirst({
      where: { id: conversationId, orgId: ctx.orgId },
      select: {
        id: true,
        phone: true,
        optedOut: true,
        leadId: true,
        lead: { select: { name: true, courseInterest: true } },
      },
    });
    if (!conversation) throw new NotFoundError("Conversation", conversationId);
    if (conversation.optedOut) throw new ConflictError("Contact has opted out of WhatsApp");

    const templateName = getInteraktDefaultTemplate();
    if (!templateName) {
      const errorMsg =
        "Interakt inbox send requires INTERAKT_DEFAULT_TEMPLATE (approved template code name). Free-form WhatsApp text is not supported by the public API.";
      return this.persistInboxSendFailure(ctx, conversation, body, errorMsg);
    }

    const templateRecord = await prisma.notificationTemplate.findFirst({
      where: { orgId: ctx.orgId, channel: "WHATSAPP", name: templateName, isActive: true },
      select: { variables: true },
    });

    const variableNames =
      templateRecord?.variables?.length ? templateRecord.variables : getDefaultInboxTemplateVariableNames();

    const built = buildInboxTemplatePayload(templateName, variableNames, {
      typedMessage: body,
      lead: conversation.lead,
    });

    if (!built.ok) {
      return this.persistInboxSendFailure(ctx, conversation, body, built.error, templateName);
    }

    const result = await getProvider("WHATSAPP").send({
      to: conversation.phone,
      body: built.displayBody,
      templateName: built.templateName,
      templateLanguage: built.templateLanguage,
      bodyValues: built.bodyValues,
      metadata: {
        conversationId,
        ...(conversation.leadId ? { leadId: conversation.leadId } : {}),
      },
    });

    const status = result.status === "SENT" ? "SENT" : "FAILED";
    const errorMsg =
      result.status === "SENT"
        ? null
        : result.errorMsg ??
          (result.status === "NOT_CONFIGURED"
            ? "WhatsApp provider is not configured."
            : "Interakt rejected the template send.");

    const [message] = await prisma.$transaction([
      prisma.whatsAppMessage.create({
        data: {
          orgId: ctx.orgId,
          conversationId,
          direction: "OUT",
          body: built.displayBody,
          templateName: built.templateName,
          status,
          externalId: result.externalId,
          errorMsg,
          sentBy: ctx.user.id,
          leadId: conversation.leadId,
          metadata: {
            provider: getProvider("WHATSAPP").name,
            sendStatus: result.status,
            inboxTypedMessage: body.trim() || null,
            templateVariables: built.bodyValues ?? [],
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      }),
      prisma.whatsAppConversation.update({
        where: { id: conversationId },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: built.displayBody.slice(0, 255),
        },
      }),
    ]);

    return { id: message.id, status: result.status, errorMsg };
  }

  private static async persistInboxSendFailure(
    ctx: RequestContext,
    conversation: { id: string; leadId: string | null },
    body: string,
    errorMsg: string,
    templateName?: string,
  ) {
    const [message] = await prisma.$transaction([
      prisma.whatsAppMessage.create({
        data: {
          orgId: ctx.orgId,
          conversationId: conversation.id,
          direction: "OUT",
          body: body.trim() || `[Template send failed: ${templateName ?? "unset"}]`,
          templateName: templateName ?? null,
          status: "FAILED",
          errorMsg,
          sentBy: ctx.user.id,
          leadId: conversation.leadId,
          metadata: {
            provider: getProvider("WHATSAPP").name,
            sendStatus: "FAILED",
            inboxTypedMessage: body.trim() || null,
          } as Prisma.InputJsonValue,
        },
        select: { id: true },
      }),
      prisma.whatsAppConversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: body.slice(0, 255) || errorMsg.slice(0, 255),
        },
      }),
    ]);
    return { id: message.id, status: "FAILED" as const, errorMsg };
  }

  // ─── Contacts ───────────────────────────────────────────────────────────────

  static async listContacts(orgId: string, filters: ContactFilters) {
    const where: Prisma.LeadWhereInput = {
      orgId,
      deletedAt: null,
      ...(filters.optOut !== undefined && { whatsappOptOut: filters.optOut }),
      ...(filters.search && {
        OR: [
          { name: { contains: filters.search, mode: "insensitive" as const } },
          { phone: { contains: filters.search } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        select: {
          id: true,
          name: true,
          phone: true,
          status: true,
          tags: true,
          whatsappOptOut: true,
          lastActivityAt: true,
          whatsappConversations: { select: { id: true, unreadCount: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.lead.count({ where }),
    ]);

    return { data, total };
  }

  static async updateContactOptOut(ctx: RequestContext, leadId: string, optOut: boolean) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, orgId: ctx.orgId, deletedAt: null },
      select: { id: true, phone: true },
    });
    if (!lead) throw new NotFoundError("Lead", leadId);

    await prisma.$transaction([
      prisma.lead.update({ where: { id: leadId }, data: { whatsappOptOut: optOut } }),
      // Mirror onto any existing conversation so inbox sends are blocked too.
      prisma.whatsAppConversation.updateMany({
        where: { orgId: ctx.orgId, phone: lead.phone },
        data: { optedOut: optOut },
      }),
    ]);

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: optOut ? "whatsapp.contact_opted_out" : "whatsapp.contact_opted_in",
      entityType: "lead",
      entityId: leadId,
      newValue: { whatsappOptOut: optOut },
    });

    return { id: leadId, whatsappOptOut: optOut };
  }

  // ─── Campaigns ──────────────────────────────────────────────────────────────

  static async listCampaigns(orgId: string, filters: CampaignFilters) {
    const where: Prisma.WhatsAppCampaignWhereInput = {
      orgId,
      ...(filters.status && { status: filters.status }),
    };

    const [data, total] = await Promise.all([
      prisma.whatsAppCampaign.findMany({
        where,
        select: CAMPAIGN_SELECT,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.whatsAppCampaign.count({ where }),
    ]);

    return { data, total };
  }

  static async getCampaign(orgId: string, id: string) {
    const campaign = await prisma.whatsAppCampaign.findFirst({ where: { id, orgId }, select: CAMPAIGN_SELECT });
    if (!campaign) throw new NotFoundError("Campaign", id);
    return campaign;
  }

  static async createCampaign(ctx: RequestContext, input: { name: string; message: string; templateName?: string; audienceFilter: unknown }) {
    const campaign = await prisma.whatsAppCampaign.create({
      data: {
        orgId: ctx.orgId,
        name: input.name,
        message: input.message,
        templateName: input.templateName,
        audienceFilter: input.audienceFilter as Prisma.InputJsonValue,
      },
      select: CAMPAIGN_SELECT,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "whatsapp.campaign_created",
      entityType: "whatsapp_campaign",
      entityId: campaign.id,
      newValue: { name: campaign.name },
    });

    return campaign;
  }

  static async updateCampaign(
    ctx: RequestContext,
    id: string,
    input: { name?: string; message?: string; templateName?: string | null; audienceFilter?: unknown },
  ) {
    const existing = await this.getCampaign(ctx.orgId, id);
    if (existing.status !== "DRAFT") throw new ConflictError("Only DRAFT campaigns can be edited");

    const campaign = await prisma.whatsAppCampaign.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.message !== undefined && { message: input.message }),
        ...(input.templateName !== undefined && { templateName: input.templateName }),
        ...(input.audienceFilter !== undefined && { audienceFilter: input.audienceFilter as Prisma.InputJsonValue }),
      },
      select: CAMPAIGN_SELECT,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "whatsapp.campaign_updated",
      entityType: "whatsapp_campaign",
      entityId: id,
      newValue: { name: campaign.name },
    });

    return campaign;
  }

  /**
   * Launch a DRAFT campaign: resolve the audience (leads with a phone, not
   * opted out, matching the filter), then send synchronously through the
   * provider with per-recipient outcome tracking. NOT_CONFIGURED counts as
   * skipped — nothing is reported delivered that was not.
   */
  static async launchCampaign(ctx: RequestContext, id: string) {
    const campaign = await this.getCampaign(ctx.orgId, id);
    if (campaign.status !== "DRAFT") throw new ConflictError(`Campaign is already ${campaign.status}`);

    const filter = (campaign.audienceFilter ?? {}) as { tags?: string[]; statuses?: string[] };
    const where: Prisma.LeadWhereInput = {
      orgId: ctx.orgId,
      deletedAt: null,
      whatsappOptOut: false,
      AND: [
        ...(filter.tags?.length ? [{ tags: { hasSome: filter.tags } }] : []),
        ...(filter.statuses?.length ? [{ status: { in: filter.statuses as never[] } }] : []),
      ],
    };

    const recipients = await prisma.lead.findMany({
      where,
      select: { id: true, name: true, phone: true },
      take: 500,
      orderBy: { createdAt: "asc" },
    });

    await prisma.whatsAppCampaign.update({
      where: { id },
      data: {
        status: "LAUNCHING",
        totalRecipients: recipients.length,
        launchedBy: ctx.user.id,
        launchedAt: new Date(),
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
      },
    });

    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const recipient of recipients) {
      const rendered = interpolate(campaign.message, {
        leadName: recipient.name,
        phone: recipient.phone,
      });

      try {
        const result = await getProvider("WHATSAPP").send({
          to: recipient.phone,
          body: rendered,
          templateName: campaign.templateName ?? undefined,
          metadata: { leadId: recipient.id, campaignId: campaign.id },
        });

        const conversation = await prisma.whatsAppConversation.upsert({
          where: { orgId_phone: { orgId: ctx.orgId, phone: recipient.phone } },
          update: { lastMessageAt: new Date(), lastMessagePreview: rendered.slice(0, 255), leadId: recipient.id },
          create: {
            orgId: ctx.orgId,
            phone: recipient.phone,
            leadId: recipient.id,
            lastMessageAt: new Date(),
            lastMessagePreview: rendered.slice(0, 255),
          },
          select: { id: true },
        });

        await prisma.whatsAppMessage.create({
          data: {
            orgId: ctx.orgId,
            conversationId: conversation.id,
            direction: "OUT",
            body: rendered,
            templateName: campaign.templateName,
            status:
              result.status === "SENT" ? "SENT" : result.status === "FAILED" ? "FAILED" : "SKIPPED",
            externalId: result.externalId,
            errorMsg: result.errorMsg,
            sentBy: ctx.user.id,
            campaignId: campaign.id,
            leadId: recipient.id,
            metadata: { provider: getProvider("WHATSAPP").name, sendStatus: result.status } as Prisma.InputJsonValue,
          },
          select: { id: true },
        });

        if (result.status === "SENT") sent += 1;
        else if (result.status === "FAILED") failed += 1;
        else skipped += 1;
      } catch {
        failed += 1;
      }
    }

    const completed = await prisma.whatsAppCampaign.update({
      where: { id },
      data: { status: "COMPLETED", sentCount: sent, failedCount: failed, skippedCount: skipped, completedAt: new Date() },
      select: CAMPAIGN_SELECT,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "whatsapp.campaign_launched",
      entityType: "whatsapp_campaign",
      entityId: id,
      newValue: { total: recipients.length, sent, failed, skipped },
    });

    return completed;
  }

  // ─── Automations & sequences (read views over Workflow) ────────────────────

  static async listAutomations(orgId: string) {
    const { listInteraktAutomations } = await import("@/lib/automation/interakt-automations");
    return listInteraktAutomations(orgId);
  }

  static async listSequences(orgId: string) {
    const workflows = await prisma.workflow.findMany({
      where: { orgId, isActive: true, code: { startsWith: "seq-" } },
      select: { id: true, name: true, code: true, description: true, triggerEvent: true, steps: true, updatedAt: true },
      orderBy: { code: "asc" },
    });

    return workflows.map((w) => ({
      id: w.id,
      name: w.name,
      code: w.code,
      description: w.description,
      triggerEvent: w.triggerEvent,
      stepCount: Array.isArray(w.steps) ? w.steps.length : 0,
      updatedAt: w.updatedAt.toISOString(),
    }));
  }

  // ─── Templates (NotificationTemplate, channel WHATSAPP) ────────────────────

  static async listTemplates(orgId: string) {
    return prisma.notificationTemplate.findMany({
      where: { orgId, channel: "WHATSAPP" },
      select: { id: true, event: true, name: true, body: true, variables: true, isActive: true, updatedAt: true },
      orderBy: { event: "asc" },
    });
  }

  static async upsertTemplate(
    ctx: RequestContext,
    input: { event: NotificationEvent; name: string; body: string; isActive: boolean },
  ) {
    const template = await prisma.notificationTemplate.upsert({
      where: { orgId_event_channel: { orgId: ctx.orgId, event: input.event, channel: "WHATSAPP" } },
      update: { name: input.name, body: input.body, variables: extractTemplateVariables(input.body), isActive: input.isActive },
      create: {
        orgId: ctx.orgId,
        event: input.event,
        channel: "WHATSAPP",
        name: input.name,
        body: input.body,
        variables: extractTemplateVariables(input.body),
        isActive: input.isActive,
      },
      select: { id: true, event: true, name: true, body: true, variables: true, isActive: true, updatedAt: true },
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "whatsapp.template_saved",
      entityType: "notification_template",
      entityId: template.id,
      newValue: { event: input.event, name: input.name },
    });

    return template;
  }

  static async deleteTemplate(ctx: RequestContext, id: string) {
    const existing = await prisma.notificationTemplate.findFirst({
      where: { id, orgId: ctx.orgId, channel: "WHATSAPP" },
      select: { id: true, event: true },
    });
    if (!existing) throw new NotFoundError("Template", id);

    await prisma.notificationTemplate.delete({ where: { id } });
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "whatsapp.template_deleted",
      entityType: "notification_template",
      entityId: id,
      oldValue: { event: existing.event },
    });
    return { id };
  }

  // ─── Analytics ──────────────────────────────────────────────────────────────

  static async getAnalytics(orgId: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);

    const messages = await prisma.whatsAppMessage.groupBy({
      by: ["direction", "status"],
      where: { orgId, createdAt: { gte: since } },
      _count: { _all: true },
    });

    const byDay = await prisma.$queryRaw<{ day: Date; direction: string; count: bigint }[]>`
      SELECT date_trunc('day', "createdAt") AS day, direction::text AS direction, COUNT(*) AS count
      FROM whatsapp_messages
      WHERE "orgId" = ${orgId}::uuid AND "createdAt" >= ${since}
      GROUP BY 1, 2
      ORDER BY 1 ASC
    `;

    const topTemplates = await prisma.whatsAppMessage.groupBy({
      by: ["templateName"],
      where: { orgId, direction: "OUT", createdAt: { gte: since }, templateName: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { templateName: "desc" } },
      take: 5,
    });

    const totals = { in: 0, out: 0, sent: 0, failed: 0 };
    for (const row of messages) {
      const count = row._count._all;
      if (row.direction === "IN") totals.in += count;
      else {
        totals.out += count;
        if (row.status === "SENT" || row.status === "DELIVERED" || row.status === "READ") totals.sent += count;
        if (row.status === "FAILED") totals.failed += count;
      }
    }

    // ── Engagement: conversations contacted vs. conversations that replied ──
    const [engagementRow] = await prisma.$queryRaw<{ replied: bigint; total: bigint }[]>`
      SELECT
        COUNT(DISTINCT CASE WHEN direction = 'IN' THEN "conversationId" END) AS replied,
        COUNT(DISTINCT "conversationId") AS total
      FROM whatsapp_messages
      WHERE "orgId" = ${orgId}::uuid AND "createdAt" >= ${since}
    `;

    // ── Sequence funnel: runs of workflows that send WhatsApp, by outcome ───
    const sequenceRows = await prisma.$queryRaw<{ code: string; name: string; status: string; count: bigint }[]>`
      SELECT w.code::text AS code, w.name::text AS name, r.status::text AS status, COUNT(*) AS count
      FROM workflow_runs r
      JOIN workflows w ON w.id = r."workflowId"
      WHERE r."orgId" = ${orgId}::uuid
        AND r."startedAt" >= ${since}
        AND w.steps::text LIKE '%SEND_WHATSAPP%'
      GROUP BY w.code, w.name, r.status
      ORDER BY w.code ASC
    `;
    const sequences = new Map<string, { code: string; name: string; started: number; completed: number; stopped: number; failed: number }>();
    for (const row of sequenceRows) {
      const entry = sequences.get(row.code) ?? { code: row.code, name: row.name, started: 0, completed: 0, stopped: 0, failed: 0 };
      entry.started += Number(row.count);
      if (row.status === "COMPLETED") entry.completed += Number(row.count);
      if (row.status === "STOPPED") entry.stopped += Number(row.count);
      if (row.status === "FAILED") entry.failed += Number(row.count);
      sequences.set(row.code, entry);
    }

    // ── Attribution: enrolled leads that have a WhatsApp conversation ────────
    const [enrolledAgg] = await prisma.$queryRaw<{ total: bigint; viaWhatsapp: bigint }[]>`
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM whatsapp_conversations c WHERE c."leadId" = l.id
        ) THEN 1 END) AS "viaWhatsapp"
      FROM leads l
      WHERE l."orgId" = ${orgId}::uuid
        AND l.status IN ('WON', 'CONVERTED')
        AND l."deletedAt" IS NULL
    `;
    const optedOutConversations = await prisma.whatsAppConversation.count({
      where: { orgId, optedOut: true },
    });

    const conversationsContacted = Number(engagementRow?.total ?? 0);
    const conversationsReplied = Number(engagementRow?.replied ?? 0);
    const enrolledTotal = Number(enrolledAgg?.total ?? 0);
    const enrolledWithWhatsApp = Number(enrolledAgg?.viaWhatsapp ?? 0);

    return {
      days,
      totals: {
        ...totals,
        deliveryRate: totals.out > 0 ? Math.round((totals.sent / totals.out) * 100) : null,
      },
      byDay: byDay.map((r) => ({ day: r.day.toISOString().slice(0, 10), direction: r.direction, count: Number(r.count) })),
      topTemplates: topTemplates.map((t) => ({ templateName: t.templateName, count: t._count._all })),
      engagement: {
        conversationsContacted,
        conversationsReplied,
        responseRate: conversationsContacted > 0 ? Math.round((conversationsReplied / conversationsContacted) * 100) : null,
        optedOutConversations,
      },
      sequences: Array.from(sequences.values()),
      attribution: {
        enrolledTotal,
        enrolledWithWhatsApp,
        whatsappShare: enrolledTotal > 0 ? Math.round((enrolledWithWhatsApp / enrolledTotal) * 100) : null,
      },
    };
  }

  // ─── Settings ───────────────────────────────────────────────────────────────

  static async getSettings(orgId: string) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { featureFlags: true },
    });
    const flags = (org?.featureFlags ?? {}) as Record<string, unknown>;
    const provider = getProvider("WHATSAPP");
    const envProvider = (process.env.WHATSAPP_PROVIDER ?? "").trim().toLowerCase() || null;
    const apiKey = process.env.INTERAKT_API_KEY?.trim();
    const webhookSecret = process.env.INTERAKT_WEBHOOK_SECRET || process.env.WHATSAPP_WEBHOOK_SECRET;
    const configured = provider.isConfigured();
    const configurationStatus = !envProvider
      ? "unset"
      : envProvider === "mock"
        ? "mock"
        : envProvider === "interakt" && !apiKey
          ? "missing_credentials"
          : configured
            ? "ready"
            : "not_registered";

    return {
      provider: envProvider === "interakt" || envProvider === "mock" ? envProvider : provider.name,
      providerConfigured: configured,
      providerName: provider.name,
      envProvider,
      connected: envProvider === "mock" && configured,
      configurationStatus,
      credentialsMasked: envProvider === "interakt" ? { apiKey: maskSecret(apiKey) } : null,
      whatsappNotifications: flags.whatsappNotifications === true,
      webhookUrl: `${process.env.NEXT_PUBLIC_ADMIN_URL ?? "https://airborne-admin-368523757732.asia-south1.run.app"}/api/webhooks/whatsapp`,
      webhookConfigured: Boolean(webhookSecret),
      webhookAuth: envProvider === "interakt" ? "interakt-signature" : "shared-secret",
      defaultTemplate: getInteraktDefaultTemplate() ?? null,
      inboxSendMode: "approved_template" as const,
    };
  }

  static async updateSettings(ctx: RequestContext, whatsappNotifications: boolean) {
    const org = await prisma.organization.findUnique({ where: { id: ctx.orgId }, select: { featureFlags: true } });
    const flags = { ...((org?.featureFlags ?? {}) as Record<string, unknown>), whatsappNotifications };

    await prisma.organization.update({ where: { id: ctx.orgId }, data: { featureFlags: flags as Prisma.InputJsonValue } });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "whatsapp.settings_updated",
      entityType: "organization",
      entityId: ctx.orgId,
      newValue: { whatsappNotifications },
    });

    return this.getSettings(ctx.orgId);
  }

  // ─── Inbound webhook ingestion ──────────────────────────────────────────────
  //
  // One entry point for every provider dialect (already normalized by
  // parseInboundWhatsApp). Records the message, threads the conversation,
  // handles opt-out/opt-in keywords, and emits canonical workflow events.

  static async ingestInboundMessage(orgId: string, msg: InboundWhatsAppMessage): Promise<IngestResult> {
    // Providers retry webhooks aggressively — dedupe on the external id.
    if (msg.externalId) {
      const dupe = await prisma.whatsAppMessage.findFirst({
        where: { orgId, externalId: msg.externalId, direction: "IN" },
        select: { id: true },
      });
      if (dupe) return { duplicate: true };
    }

    const phone = normalizePhone(msg.phone);
    if (!phone) return { skipped: "invalid_phone" };

    const leadIdHint = validUuid(msg.userIdTrait);
    let lead: { id: string; whatsappOptOut: boolean } | null = leadIdHint
      ? await prisma.lead.findFirst({
          where: { id: leadIdHint, orgId },
          select: { id: true, whatsappOptOut: true },
        })
      : null;
    if (!lead) {
      lead = await prisma.lead.findFirst({
        where: { orgId, phone },
        select: { id: true, whatsappOptOut: true },
      });
    }
    if (!lead) {
      lead = await prisma.lead.findFirst({
        where: { orgId, phone: { endsWith: phone.slice(-10) } },
        orderBy: { createdAt: "desc" },
        select: { id: true, whatsappOptOut: true },
      });
    }
    // Canonical candidate forms (raw / digits / +91 / national / last-10 suffix)
    // so resolution never depends on the exact shape the provider sent.
    if (!lead) {
      const candidates = contactCandidates(msg.phone);
      lead = await prisma.lead.findFirst({
        where: { orgId, phone: { in: candidates } },
        orderBy: { createdAt: "desc" },
        select: { id: true, whatsappOptOut: true },
      });
    }

    const optOut = isOptOutKeyword(msg.body);
    const optIn = !optOut && isOptInKeyword(msg.body);
    const now = new Date();

    const conversation = await prisma.whatsAppConversation.upsert({
      where: { orgId_phone: { orgId, phone } },
      update: {
        lastMessageAt: now,
        lastMessagePreview: msg.body.slice(0, 255),
        unreadCount: { increment: 1 },
        archived: false,
        ...(lead && { leadId: lead.id }),
        ...(optOut ? { optedOut: true } : optIn ? { optedOut: false } : {}),
      },
      create: {
        orgId,
        phone,
        ...(lead && { leadId: lead.id }),
        lastMessageAt: now,
        lastMessagePreview: msg.body.slice(0, 255),
        unreadCount: 1,
        optedOut: optOut,
      },
      select: { id: true },
    });

    const message = await prisma.whatsAppMessage.create({
      data: {
        orgId,
        conversationId: conversation.id,
        direction: "IN",
        body: msg.body,
        status: "RECEIVED",
        externalId: msg.externalId ?? null,
        leadId: lead?.id ?? null,
        metadata: {
          providerCustomerId: msg.providerCustomerId ?? null,
          userIdTrait: msg.userIdTrait ?? null,
        } as Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    if (lead) {
      await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          orgId,
          activityType: "WHATSAPP",
          title: optOut ? "WhatsApp STOP received" : "WhatsApp reply received",
          notes: msg.body.slice(0, 1000),
          completedAt: now,
          metadata: {
            conversationId: conversation.id,
            messageId: message.id,
            externalId: msg.externalId ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    }

    // Keyword side effects — flip the lead-level flag and leave an audit trail.
    // STOP also stops active runs synchronously (compliance); opted_out event
    // is persisted before HTTP 200 for downstream side effects via cron.
    if ((optOut || optIn) && lead) {
      await prisma.lead.update({ where: { id: lead.id }, data: { whatsappOptOut: optOut } });
      await AuditService.write({
        orgId,
        action: optOut ? "whatsapp.contact_opted_out" : "whatsapp.contact_opted_in",
        entityType: "lead",
        entityId: lead.id,
        newValue: { phone, keyword: msg.body.slice(0, 50) },
      });
    }
    if (optOut && lead) {
      await prisma.workflowRun.updateMany({
        where: {
          orgId,
          entityType: "lead",
          entityId: lead.id,
          status: { in: ["RUNNING", "PAUSED"] },
        },
        data: { status: "STOPPED", stoppedReason: "Contact opted out via WhatsApp", stoppedAt: new Date(), completedAt: new Date() },
      });
    }

    const baseEvent = {
      orgId,
      actorId: "system",
      actorName: "WhatsApp Webhook",
      requestId: msg.externalId ?? message.id,
      timestamp: now.toISOString(),
    } as const;

    if (optOut) {
      await persistEventForWebhook({
        ...baseEvent,
        name: "whatsapp.opted_out",
        data: { conversationId: conversation.id, ...(lead && { leadId: lead.id }), phone },
      });
    } else if (!optIn) {
      // Regular replies power reply automations. Opt-in confirmations stay
      // local — there is no opted-in trigger in the catalog by design.
      await persistEventForWebhook({
        ...baseEvent,
        name: "whatsapp.replied",
        data: {
          conversationId: conversation.id,
          ...(lead && { leadId: lead.id }),
          phone,
          body: msg.body,
          ...(msg.externalId && { externalId: msg.externalId }),
        },
      });
    }

    return {
      conversationId: conversation.id,
      messageId: message.id,
      ...(lead && { leadId: lead.id }),
      optOut,
      optIn,
    };
  }

  static async testConnection(): Promise<{
    ok: boolean;
    live: boolean;
    provider: string;
    status?: number;
    error?: string;
  }> {
    const provider = getProvider("WHATSAPP");
    if (provider instanceof InteraktProvider) {
      const result = await provider.testConnection();
      return { provider: provider.name, ...result };
    }
    if (provider instanceof MockWhatsAppProvider) {
      const result = await provider.testConnection();
      return { provider: provider.name, ...result };
    }
    return {
      ok: false,
      live: false,
      provider: provider.name,
      error: provider.isConfigured() ? "Provider does not support health checks" : "No WhatsApp provider configured",
    };
  }

  /**
   * Persist an outbound WhatsAppMessage after the provider accepted (or refused)
   * a send. Idempotent on (orgId, idempotencyKey).
   */
  static async persistOutbound(input: {
    orgId: string;
    phone: string;
    body: string;
    status: string;
    externalId?: string;
    errorMsg?: string;
    templateName?: string;
    leadId?: string;
    campaignId?: string;
    workflowRunId?: string;
    workflowStepKey?: string;
    idempotencyKey?: string;
    sentBy?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string; duplicate?: boolean }> {
    if (input.idempotencyKey) {
      const existing = await prisma.whatsAppMessage.findFirst({
        where: { orgId: input.orgId, idempotencyKey: input.idempotencyKey },
        select: { id: true },
      });
      if (existing) return { id: existing.id, duplicate: true };
    }

    const phone = normalizePhone(input.phone);
    const now = new Date();
    const conversation = await prisma.whatsAppConversation.upsert({
      where: { orgId_phone: { orgId: input.orgId, phone } },
      update: {
        lastMessageAt: now,
        lastMessagePreview: input.body.slice(0, 255),
        ...(input.leadId && { leadId: input.leadId }),
      },
      create: {
        orgId: input.orgId,
        phone,
        leadId: input.leadId,
        lastMessageAt: now,
        lastMessagePreview: input.body.slice(0, 255),
      },
      select: { id: true },
    });

    try {
      const message = await prisma.whatsAppMessage.create({
        data: {
          orgId: input.orgId,
          conversationId: conversation.id,
          direction: "OUT",
          body: input.body,
          templateName: input.templateName,
          status: input.status,
          externalId: input.externalId,
          errorMsg: input.errorMsg,
          sentBy: input.sentBy,
          campaignId: validUuid(input.campaignId),
          leadId: validUuid(input.leadId),
          workflowRunId: validUuid(input.workflowRunId),
          workflowStepKey: input.workflowStepKey,
          idempotencyKey: input.idempotencyKey,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return { id: message.id };
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "P2002" && input.idempotencyKey) {
        const existing = await prisma.whatsAppMessage.findFirst({
          where: { orgId: input.orgId, idempotencyKey: input.idempotencyKey },
          select: { id: true },
        });
        if (existing) return { id: existing.id, duplicate: true };
      }
      throw err;
    }
  }

  /**
   * Reserve an outbound row BEFORE calling Interakt — prevents duplicate sends
   * when a worker retries after crash/timeout.
   */
  static async reserveOutboundSend(input: {
    orgId: string;
    phone: string;
    body: string;
    templateName?: string;
    leadId?: string;
    campaignId?: string;
    workflowRunId?: string;
    workflowStepKey?: string;
    idempotencyKey?: string;
    sentBy?: string;
    metadata?: Record<string, unknown>;
  }): Promise<{ messageId: string; skipSend: boolean; externalId?: string | null }> {
    if (input.idempotencyKey) {
      const existing = await prisma.whatsAppMessage.findFirst({
        where: { orgId: input.orgId, idempotencyKey: input.idempotencyKey },
        select: { id: true, status: true, externalId: true },
      });
      if (existing && existing.status !== "FAILED") {
        return { messageId: existing.id, skipSend: true, externalId: existing.externalId };
      }
      if (existing) {
        await prisma.whatsAppMessage.update({
          where: { id: existing.id },
          data: { status: "QUEUED", errorMsg: null },
        });
        return { messageId: existing.id, skipSend: false, externalId: existing.externalId };
      }
    }

    const created = await this.persistOutbound({
      ...input,
      status: "QUEUED",
    });
    return { messageId: created.id, skipSend: created.duplicate === true };
  }

  static async finalizeOutboundSend(
    messageId: string,
    input: { status: string; externalId?: string; errorMsg?: string },
  ): Promise<void> {
    await prisma.whatsAppMessage.update({
      where: { id: messageId },
      data: {
        status: input.status,
        ...(input.externalId !== undefined && { externalId: input.externalId }),
        ...(input.errorMsg !== undefined && { errorMsg: input.errorMsg }),
      },
    });
  }

  static async handleProviderWebhook(orgId: string, payload: unknown): Promise<IngestResult & { kind?: string }> {
    if (isInteraktWebhookPayload(payload)) {
      const event = parseInteraktWebhook(payload);
      if (!event) return { skipped: "unrecognized_interakt_payload" };
      const claimed = await this.claimProviderEvent(orgId, "interakt", event);
      if (!claimed) return { duplicate: true, kind: event.kind };

      if (event.kind === "inbound") {
        const result = await this.ingestInboundMessage(orgId, {
          phone: event.phone,
          body: event.body,
          externalId: event.providerMessageId,
          profileName: event.profileName,
          providerCustomerId: event.providerCustomerId,
          userIdTrait: event.userIdTrait,
        });
        return { ...result, kind: "inbound" };
      }
      if (event.kind === "status") {
        await this.applyDeliveryStatus(orgId, event);
        return { kind: "status" };
      }
      return { skipped: event.kind, kind: event.kind };
    }

    return { skipped: "not_interakt" };
  }

  static async applyDeliveryStatus(orgId: string, event: NormalizedInteraktWebhook): Promise<void> {
    const next = event.internalStatus;
    if (!next) return;

    let message:
      | { id: string; status: string; conversationId: string; leadId: string | null; externalId: string | null }
      | null = null;

    const internalId = validUuid(event.callbackData?.m);
    if (internalId) {
      message = await prisma.whatsAppMessage.findFirst({
        where: { id: internalId, orgId },
        select: { id: true, status: true, conversationId: true, leadId: true, externalId: true },
      });
    }
    if (!message && event.callbackData?.i) {
      message = await prisma.whatsAppMessage.findFirst({
        where: { orgId, idempotencyKey: event.callbackData.i },
        select: { id: true, status: true, conversationId: true, leadId: true, externalId: true },
      });
    }
    if (!message && event.providerMessageId) {
      message = await prisma.whatsAppMessage.findFirst({
        where: { orgId, externalId: event.providerMessageId },
        select: { id: true, status: true, conversationId: true, leadId: true, externalId: true },
      });
    }
    if (!message) return;
    if (!shouldUpgradeStatus(message.status, next)) {
      if (!message.externalId && event.providerMessageId) {
        await prisma.whatsAppMessage.update({
          where: { id: message.id },
          data: { externalId: event.providerMessageId },
        });
      }
      return;
    }

    await prisma.whatsAppMessage.update({
      where: { id: message.id },
      data: {
        status: next,
        ...(event.providerMessageId && { externalId: event.providerMessageId }),
        ...(next === "FAILED" && {
          errorMsg: event.failureReason ?? event.channelErrorCode ?? "Interakt delivery failed",
        }),
      },
    });

    const name =
      next === "SENT"
        ? "whatsapp.sent"
        : next === "DELIVERED"
          ? "whatsapp.delivered"
          : next === "READ"
            ? "whatsapp.read"
            : "whatsapp.failed";
    await persistEventForWebhook({
      orgId,
      actorId: "system",
      actorName: "WhatsApp Webhook",
      requestId: event.providerMessageId ?? message.id,
      timestamp: new Date().toISOString(),
      name,
      data: {
        messageId: message.id,
        conversationId: message.conversationId,
        ...(message.leadId && { leadId: message.leadId }),
        ...(event.providerMessageId && { externalId: event.providerMessageId }),
      },
    });
  }

  private static async claimProviderEvent(
    orgId: string,
    provider: string,
    event: NormalizedInteraktWebhook,
  ): Promise<boolean> {
    try {
      await prisma.whatsAppProviderEvent.create({
        data: {
          orgId,
          provider,
          eventType: event.type,
          providerEventId: providerEventId(event),
          payload: {
            phone: event.phone,
            messageId: event.providerMessageId ?? null,
            status: event.internalStatus ?? event.providerStatus ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      return true;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "";
      if (code === "P2002") return false;
      throw err;
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export interface IngestResult {
  duplicate?: boolean;
  skipped?: string;
  conversationId?: string;
  messageId?: string;
  leadId?: string;
  optOut?: boolean;
  optIn?: boolean;
}

function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] ?? match : match,
  );
}
