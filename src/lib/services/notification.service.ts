import { prisma } from "@/lib/db/client";
import type { NotificationChannel, NotificationEvent } from "@prisma/client";
import { getProvider } from "@/lib/messaging";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { validUuid } from "@/lib/events/actor";
import { getInteraktDefaultTemplate } from "@/lib/messaging/providers/interakt/config";

export { DEFAULT_FROM_EMAIL } from "@/lib/messaging/constants";

type DeliveryStatus = "SENT" | "FAILED" | "PENDING" | "NOT_CONFIGURED";

interface NotificationDispatchParams {
  orgId: string;
  event: NotificationEvent;
  channel: NotificationChannel;
  recipient: string;
  variables?: Record<string, string>;
  entityType?: string;
  entityId?: string;
  templateName?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string>;
}

/**
 * Resolves the active notification template for (org, event, channel),
 * composes the message, dispatches through the configured provider and
 * records the outcome in NotificationLog.
 *
 * - Never throws to callers (background event paths must not crash).
 * - Never reports SENT unless the provider accepted the message.
 * - Returns null when no active template exists (nothing to send).
 * - Returns the final delivery status otherwise.
 */
export class NotificationService {
  static async dispatch(params: NotificationDispatchParams): Promise<DeliveryStatus | null> {
    try {
      // Master switch: automated WhatsApp sends require an explicit opt-in on
      // the org's feature flags (WhatsApp → Settings). Campaign launches are
      // deliberate admin actions and go through the provider directly.
      if (params.channel === "WHATSAPP") {
        const org = await prisma.organization.findUnique({
          where: { id: params.orgId },
          select: { featureFlags: true },
        });
        const flags = org?.featureFlags;
        const enabled =
          !!flags && typeof flags === "object" && (flags as Record<string, unknown>).whatsappNotifications === true;
        if (!enabled) return "NOT_CONFIGURED";
      }

      const template = await prisma.notificationTemplate.findFirst({
        where: {
          orgId: params.orgId,
          event: params.event,
          channel: params.channel,
          isActive: true,
        },
      });
      if (!template) return null;

      // Provider template identity. `template.name` is a CRM display label and
      // is NEVER a valid provider template slug. Real identity comes from the
      // caller's explicit templateName (workflow override) or the provider's
      // configured default (INTERAKT_DEFAULT_TEMPLATE). Passing the display name
      // to Interakt produces a confusing "No approved template found" 400 — the
      // indexed history must say what was actually dispatched.
      const providerTemplateName =
        params.channel === "WHATSAPP"
          ? params.templateName ?? getInteraktDefaultTemplate()
          : params.templateName ?? template.name;

      const variables = params.variables ?? {};
      const subject = template.subject ? interpolate(template.subject, variables) : null;
      const body = interpolate(template.body, variables);

      if (params.channel === "WHATSAPP" && params.idempotencyKey) {
        const reserved = await WhatsAppService.reserveOutboundSend({
          orgId: params.orgId,
          phone: params.recipient,
          body,
          templateName: providerTemplateName,
          leadId: validUuid(
            params.entityType === "lead" ? params.entityId : params.metadata?.leadId,
          ),
          campaignId: validUuid(params.metadata?.campaignId),
          workflowRunId: validUuid(params.metadata?.workflowRunId),
          workflowStepKey: params.metadata?.workflowStepKey,
          idempotencyKey: params.idempotencyKey,
          metadata: { templateId: template.id },
        });
        if (reserved.skipSend) {
          return reserved.externalId ? "SENT" : "PENDING";
        }

        const log = await prisma.notificationLog.create({
          data: {
            orgId: params.orgId,
            templateId: template.id,
            event: params.event,
            channel: params.channel,
            recipient: params.recipient,
            subject,
            body,
            status: "PENDING",
            entityType: params.entityType,
            entityId: params.entityId,
          },
        });

        const result = await dispatchToProvider({
          channel: params.channel,
          recipient: params.recipient,
          subject,
          body,
          templateName: providerTemplateName,
          metadata: {
            ...(params.metadata ?? {}),
            ...(params.entityId ? { leadId: params.entityId } : {}),
            ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
            messageId: reserved.messageId,
          },
        });

        const waStatus =
          result.status === "SENT" ? "SENT" : result.status === "FAILED" ? "FAILED" : "QUEUED";
        await WhatsAppService.finalizeOutboundSend(reserved.messageId, {
          status: waStatus,
          externalId: result.externalId,
          errorMsg: result.errorMsg,
        });

        try {
          await prisma.notificationLog.update({
            where: { id: log.id },
            data: {
              status: result.status,
              errorMsg: result.errorMsg ?? null,
              externalId: result.externalId ?? null,
              sentAt: result.status === "SENT" ? new Date() : null,
            },
          });
        } catch (updateErr) {
          console.error("[NotificationService] status update failed", updateErr);
        }

        return result.status;
      }

      const log = await prisma.notificationLog.create({
        data: {
          orgId: params.orgId,
          templateId: template.id,
          event: params.event,
          channel: params.channel,
          recipient: params.recipient,
          subject,
          body,
          status: "PENDING",
          entityType: params.entityType,
          entityId: params.entityId,
        },
      });

      const result = await dispatchToProvider({
        channel: params.channel,
        recipient: params.recipient,
        subject,
        body,
        templateName: providerTemplateName,
        metadata: {
          ...(params.metadata ?? {}),
          ...(params.entityId ? { leadId: params.entityId } : {}),
          ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {}),
        },
      });

      if (params.channel === "WHATSAPP") {
        const waStatus =
          result.status === "SENT" ? "SENT" : result.status === "FAILED" ? "FAILED" : "QUEUED";
        await WhatsAppService.persistOutbound({
          orgId: params.orgId,
          phone: params.recipient,
          body,
          status: waStatus,
          externalId: result.externalId,
          errorMsg: result.errorMsg,
          templateName: providerTemplateName,
          leadId: validUuid(
            params.entityType === "lead" ? params.entityId : params.metadata?.leadId,
          ),
          campaignId: validUuid(params.metadata?.campaignId),
          workflowRunId: validUuid(params.metadata?.workflowRunId),
          workflowStepKey: params.metadata?.workflowStepKey,
          idempotencyKey: params.idempotencyKey,
          metadata: { notificationLogId: log.id, providerStatus: result.status },
        });
      }

      try {
        await prisma.notificationLog.update({
          where: { id: log.id },
          data: {
            status: result.status,
            errorMsg: result.errorMsg ?? null,
            externalId: result.externalId ?? null,
            sentAt: result.status === "SENT" ? new Date() : null,
          },
        });
      } catch (updateErr) {
        // Row stays PENDING if the status write fails — that is truthful.
        console.error("[NotificationService] status update failed", updateErr);
      }

      return result.status;
    } catch (err) {
      console.error("[NotificationService] dispatch failed", err);
      return null;
    }
  }
}

// ─── Provider dispatch ─────────────────────────────────────────────────────────
//
// Transport is delegated to the messaging provider registry
// (src/lib/messaging) — template resolution, NotificationLog bookkeeping and
// interpolation stay here.

async function dispatchToProvider(input: {
  channel: NotificationChannel;
  recipient: string;
  subject: string | null;
  body: string;
  templateName?: string;
  metadata?: Record<string, string>;
}): Promise<{ status: DeliveryStatus; errorMsg?: string; externalId?: string }> {
  if (input.channel !== "EMAIL" && input.channel !== "SMS" && input.channel !== "WHATSAPP") {
    return {
      status: "NOT_CONFIGURED",
      errorMsg: `${input.channel} channel has no configured provider.`,
    };
  }

  return getProvider(input.channel).send({
    to: input.recipient,
    subject: input.subject ?? undefined,
    body: input.body,
    templateName: input.templateName,
    metadata: input.metadata,
  });
}

// ─── Template interpolation ─────────────────────────────────────────────────────

function interpolate(text: string, variables: Record<string, string>): string {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] ?? match : match,
  );
}
