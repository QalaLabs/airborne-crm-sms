import { LeadRepository } from "@/lib/repositories/lead.repository";
import { emitEvent } from "@/lib/events/inngest";
import { emitLeadCreated } from "@/lib/automation/emit-lead-created";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import type { Prisma } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from "@/lib/utils/errors";
import type { CreateLeadInput, UpdateLeadInput, LeadFilters, CreateActivityInput } from "@/lib/validations/lead.schema";
import type { RequestContext } from "@/types";
import { hasPermission } from "@/lib/utils/permissions";
import type { LeadStatus, LeadSource } from "@prisma/client";
import { isLostStatus, canTransitionLeadStatus, LOSS_REASON_DEFAULT_TEXT, LOCKED_LEAD_STATUSES, isInitialLeadStatus } from "@/lib/leads/lead-status";
import { withMeetingMode, type MeetingMode } from "@/lib/crm/meeting-mode";

export class LeadService {
  static resolveSource(raw: string = ""): LeadSource {
    const key = raw.toLowerCase();
    let slug = "homepage_cta";
    if (key.startsWith("resource gate")) {
      slug = "brochure_download";
    } else if (key.startsWith("course")) {
      slug = "course_page";
    } else {
      const mapping: Record<string, string> = {
        "homepage modal": "homepage_cta",
        "homepage final cta": "homepage_cta",
        "contact form": "contact_form",
        "contact page": "contact_form",
        "flagship featured banner": "course_page",
      };
      slug = mapping[key] ?? "homepage_cta";
    }
    const SOURCE_MAP: Record<string, LeadSource> = {
      homepage_cta: "HOMEPAGE_CTA",
      contact_form: "CONTACT_FORM",
      brochure_download: "BROCHURE_DOWNLOAD",
      course_page: "COURSE_PAGE",
    };
    return SOURCE_MAP[slug] ?? "HOMEPAGE_CTA";
  }

  static async syncFallbackLeads(ctx: RequestContext) {
    const targetSlug = process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation";
    const org = await prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { slug: true },
    });
    if (!org || org.slug !== targetSlug) return;
    await this.syncPendingFallbackLeads(ctx.orgId);
  }

  /**
   * Cron/Inngest-safe recovery entry point. Resolves the org by slug directly
   * (no user session), so it can run as a scheduled Inngest function.
   * Idempotent: concurrent runs converge on the same recovered rows and can
   * never create duplicate leads (unique(orgId, phone) + P2002 handling).
   */
  static async syncFallbackLeadsCron(): Promise<{
    synced: number;
    duplicates: number;
    failed: number;
  }> {
    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: { id: true },
    });
    if (!org) return { synced: 0, duplicates: 0, failed: 0 };
    return this.syncPendingFallbackLeads(org.id);
  }

  private static async syncPendingFallbackLeads(orgId: string) {
    const pending = await prisma.fallbackLead.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });

    const result = { synced: 0, duplicates: 0, failed: 0 };
    if (pending.length === 0) return result;

    console.log(
      JSON.stringify({
        event: "lead_fallback_sync_started",
        pending: pending.length,
        timestamp: new Date().toISOString(),
      }),
    );

    for (const fLead of pending) {
      try {
        const phone = fLead.phone.trim();
        const existing = await prisma.lead.findFirst({
          where: { orgId, phone },
        });

        if (existing) {
          await this.markFallbackRecovered(fLead.id);

          await prisma.leadActivity.create({
            data: {
              leadId: existing.id,
              orgId,
              activityType: "NOTE",
              title: "Duplicate fallback enquiry",
              notes: `Enquiry from fallback store recovered. Originally submitted at ${fLead.createdAt.toISOString()}`,
              completedAt: new Date(),
            },
          });

          result.duplicates++;
        } else {
          const sourceEnum = this.resolveSource(fLead.source || "");
          const lead = await prisma.lead.create({
            data: {
              orgId,
              createdBy: null,
              name: fLead.name,
              email: fLead.email || null,
              phone,
              courseInterest: fLead.course || null,
              source: sourceEnum,
              createdAt: fLead.createdAt,
              customFields: { fallbackLeadId: fLead.id },
            },
          });

          await prisma.leadActivity.create({
            data: {
              leadId: lead.id,
              orgId,
              activityType: "NOTE",
              title: "Web form submission (Recovered)",
              notes: `Enquiry recovered from Supabase fallback leads. Originally submitted at ${fLead.createdAt.toLocaleString("en-IN")}`,
              completedAt: new Date(),
            },
          });

          // Durable audit/activity for the successful conversion — exactly once,
          // owned by the sync recovery path. Null actor (system recovery action).
          await AuditService.write({
            orgId,
            action: "lead.created",
            entityType: "lead",
            entityId: lead.id,
            newValue: { name: lead.name, phone, source: sourceEnum, recoveredFromFallback: true },
          });

          await ActivityFeedService.write({
            orgId,
            verb: "created",
            objectType: "lead",
            objectId: lead.id,
            objectSnapshot: { name: lead.name, source: sourceEnum },
            context: { actorName: "Public form (recovered)", recoveredFromFallback: true },
          });

          await this.markFallbackRecovered(fLead.id);
          await emitLeadCreated({
            orgId,
            leadId: lead.id,
            leadName: lead.name,
            source: sourceEnum,
            courseInterest: lead.courseInterest,
            actorName: "Public form (recovered)",
          });
          result.synced++;
        }
      } catch (err) {
        const isP2002 =
          typeof err === "object" &&
          err !== null &&
          "code" in err &&
          (err as { code?: string }).code === "P2002";

        if (isP2002) {
          // A concurrent run created this lead first — converge on recovery.
          const raced = await prisma.lead.findFirst({
            where: { orgId, phone: fLead.phone.trim() },
            select: { id: true },
          });
          if (raced) {
            await this.markFallbackRecovered(fLead.id);
            await prisma.leadActivity
              .create({
                data: {
                  leadId: raced.id,
                  orgId,
                  activityType: "NOTE",
                  title: "Duplicate fallback enquiry",
                  notes: `Enquiry from fallback store recovered. Originally submitted at ${fLead.createdAt.toISOString()}`,
                  completedAt: new Date(),
                },
              })
              .catch(() => undefined);
            result.duplicates++;
            continue;
          }
        }

        result.failed++;
        // Keep the record pending so a later run retries it; bump retry_count
        // so stuck rows are visible in the fallback_leads table.
        await prisma.fallbackLead
          .update({
            where: { id: fLead.id },
            data: { retryCount: { increment: 1 } },
          })
          .catch(() => undefined);
        console.error(
          JSON.stringify({
            event: "lead_fallback_sync_failed",
            fallbackLeadId: fLead.id,
            reason: err instanceof Error ? err.message : String(err),
            timestamp: new Date().toISOString(),
          }),
        );
      }
    }

    console.log(
      JSON.stringify({
        event: "lead_fallback_sync_succeeded",
        synced: result.synced,
        duplicates: result.duplicates,
        failed: result.failed,
        timestamp: new Date().toISOString(),
      }),
    );
    return result;
  }

  private static async markFallbackRecovered(id: string) {
    await prisma.fallbackLead.update({
      where: { id },
      data: { status: "recovered" },
    });
  }

  static async list(ctx: RequestContext, filters: LeadFilters) {
    return LeadRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const lead = await LeadRepository.findById(ctx.orgId, id);
    if (!lead) throw new NotFoundError("Lead", id);
    return lead;
  }

  static async create(ctx: RequestContext, input: CreateLeadInput) {
    const { notes, status: initialStatus, ...data } = input;
    if (initialStatus && !isInitialLeadStatus(initialStatus)) {
      throw new ValidationError([{ path: ["status"], message: `${initialStatus} is not a valid initial lead status` }]);
    }

    if (!hasPermission(ctx.user, "assign", "leads")) {
      if (data.assignedTo && data.assignedTo !== ctx.user.id) {
        throw new ForbiddenError("assign", "leads");
      }
      // Without assign rights the creator owns the lead (counselor ABAC is own-records).
      data.assignedTo = ctx.user.id;
    }

    const rawDigits = data.phone.replace(/\D/g, "");
    if (rawDigits.length >= 10) {
      data.phone = rawDigits.slice(-10);
    }

    // Race-safe dedup: unique(orgId, phone) means a lead with this phone already
    // exists in the org — surface a clean 409 instead of a 500.
    let lead: Awaited<ReturnType<typeof LeadRepository.create>>;
    try {
      lead = await LeadRepository.create(ctx.orgId, ctx.user.id, data);
    } catch (err) {
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        const trashed = await prisma.lead.findFirst({
          where: { orgId: ctx.orgId, phone: data.phone, deletedAt: { not: null } },
          select: { id: true },
        });
        throw new ConflictError(
          trashed
            ? "A lead with this phone is in the Recycle Bin. Restore it from Leads → Recycle Bin instead."
            : "A lead with this phone already exists in this organization",
        );
      }
      throw err;
    }

    // Persist intake notes or initial lead creation so timeline is never empty
    await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        orgId: ctx.orgId,
        performedBy: ctx.user.id,
        activityType: "NOTE",
        title: notes ? "Intake note" : "Lead created",
        notes: notes || `Lead created via ${lead.source.replace(/_/g, " ")}${lead.courseInterest ? ` for ${lead.courseInterest}` : ""}`,
        completedAt: new Date(),
      },
    });
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastActivityAt: new Date() },
    });

    // Durable audit/activity owned by the sync path (Inngest-independent)
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "lead.created",
      entityType: "lead",
      entityId: lead.id,
      newValue: { name: lead.name, source: lead.source, phone: lead.phone },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "created",
      objectType: "lead",
      objectId: lead.id,
      objectSnapshot: { name: lead.name, source: lead.source },
      context: { actorName: ctx.user.name },
    });

    // Emit event — notification/automation only (durable audit is sync above)
    await emitLeadCreated({
      orgId: ctx.orgId,
      leadId: lead.id,
      leadName: lead.name,
      source: lead.source,
      courseInterest: lead.courseInterest,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      ipAddress: ctx.ipAddress,
    });

    // Leads are born NEW; a chosen initial status goes through the normal status
    // change path so it gets the same STATUS_CHANGE activity, audit and events.
    if (initialStatus && initialStatus !== "NEW") {
      return (await this.update(ctx, lead.id, { status: initialStatus })) ?? lead;
    }

    return lead;
  }

  static async update(ctx: RequestContext, id: string, input: UpdateLeadInput) {
    const existing = await this.getById(ctx, id);

    // E5 Assignment permission: Only Admin, SuperAdmin, Manager may assign/reassign leads.
    if (input.assignedTo !== undefined && input.assignedTo !== existing.assignedTo) {
      if (!hasPermission(ctx.user, "assign", "leads")) {
        throw new ForbiddenError("assign", "leads");
      }
    }

    // Detect status change for targeted event
    const statusChanged = input.status && input.status !== existing.status;

    if (statusChanged) {
      // Canonical validated transitions (Phase B/N): WON/CONVERTED are
      // system-only; lost moves persist a reason; PROSPECT ensures a deal.
      if (!canTransitionLeadStatus(existing.status as LeadStatus, input.status as LeadStatus)) {
        throw new ValidationError([
          {
            message: `Cannot transition lead from ${existing.status} to ${input.status}`,
          },
        ]);
      }

    }

    // Entering PROSPECT (or re-confirming Prospect terms) → ensure a Deal exists
    // and merge the decided course / batch / fee (idempotent, concurrency-safe).
    if (input.status === "PROSPECT" && (statusChanged || input.dealData)) {
      {
        const { DealService } = await import("@/lib/services/deal.service");
        const title =
          existing.name.length > 255 - (existing.courseInterest?.length ?? 0) - 2
            ? existing.name.slice(0, 240) + ` - ${(existing.courseInterest ?? "Prospect").slice(0, 12)}`
            : existing.courseInterest
              ? `${existing.name} - ${existing.courseInterest}`
              : `${existing.name} - Prospect`;
        await DealService.ensureDealForLead(ctx, id, {
          title,
          source: existing.source ?? undefined,
          assignedTo: existing.assignedTo ?? undefined,
          ...(input.dealData ?? {}),
        });
      }
    }

    if (statusChanged) {
      // Persist a loss reason when entering a lost status without one.
      if (isLostStatus(input.status as LeadStatus)) {
        input.lostReason =
          input.lostReason ?? LOSS_REASON_DEFAULT_TEXT[input.status as LeadStatus] ?? `Marked ${input.status}`;
      }
    }

    const updated = await LeadRepository.update(ctx.orgId, id, input);

    if (input.source !== undefined && input.source !== existing.source) {
      await prisma.leadActivity.create({
        data: {
          leadId: id,
          orgId: ctx.orgId,
          performedBy: ctx.user.id,
          activityType: "SYSTEM",
          title: "Source changed",
          notes: `Changed from ${existing.source} to ${input.source}`,
          completedAt: new Date(),
          metadata: { oldSource: existing.source, newSource: input.source },
        },
      });
      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        action: "lead.source_changed",
        entityType: "lead",
        entityId: id,
        oldValue: { source: existing.source },
        newValue: { source: input.source },
      });
    }

    if (statusChanged) {
      await prisma.leadActivity.create({
        data: {
          leadId: id,
          orgId: ctx.orgId,
          performedBy: ctx.user.id,
          activityType: "STATUS_CHANGE",
          title: `Status → ${input.status}`,
          notes: input.lostReason ?? `Changed from ${existing.status} to ${input.status}`,
          completedAt: new Date(),
          metadata: { oldStatus: existing.status, newStatus: input.status },
        },
      });

      // Durable audit/activity owned by the sync status path (Inngest-independent)
      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        action: "lead.status_changed",
        entityType: "lead",
        entityId: id,
        oldValue: { status: existing.status },
        newValue: { status: input.status as LeadStatus },
      });

      await ActivityFeedService.write({
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        verb: "status_changed",
        objectType: "lead",
        objectId: id,
        objectSnapshot: { name: updated.name },
        context: { from: existing.status, to: input.status as LeadStatus, actorName: ctx.user.name },
      });

      await emitEvent({
        name: "lead/status.changed",
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        actorName: ctx.user.name,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        timestamp: new Date().toISOString(),
        data: {
          leadId: id,
          leadName: updated.name,
          oldStatus: existing.status,
          newStatus: input.status as LeadStatus,
        },
      });

      await this.recalculateScore(ctx, id, `status:${input.status}`);
      return LeadRepository.findById(ctx.orgId, id);
    } else {
      // General update audit via event
      const { AuditService } = await import("@/lib/services/audit.service");
      await AuditService.write({
        orgId: ctx.orgId,
        userId: ctx.user.id,
        requestId: ctx.requestId,
        ipAddress: ctx.ipAddress,
        action: "lead.updated",
        entityType: "lead",
        entityId: id,
        oldValue: existing as unknown as Record<string, unknown>,
        newValue: updated as unknown as Record<string, unknown>,
      });

      await prisma.leadActivity
        .create({
          data: {
            leadId: id,
            orgId: ctx.orgId,
            performedBy: ctx.user.id,
            activityType: "NOTE",
            title: "Lead details updated",
            notes: `Profile updated by ${ctx.user.name || "Admin"}`,
            completedAt: new Date(),
          },
        })
        .catch(() => undefined);

      await ActivityFeedService.write({
        orgId: ctx.orgId,
        actorId: ctx.user.id,
        verb: "updated",
        objectType: "lead",
        objectId: id,
        objectSnapshot: { name: updated.name },
        context: { actorName: ctx.user.name },
      }).catch(() => undefined);
    }

    return updated;
  }

  static async assign(ctx: RequestContext, id: string, counselorId: string) {
    const lead = await this.getById(ctx, id);

    // Verify counselor exists in same org
    const counselor = await prisma.user.findFirst({
      where: { id: counselorId, orgId: ctx.orgId, isActive: true },
      select: { id: true, name: true },
    });
    if (!counselor) throw new NotFoundError("Counselor", counselorId);

    await LeadRepository.update(ctx.orgId, id, { assignedTo: counselorId });

    await prisma.leadActivity.create({
      data: {
        leadId: id,
        orgId: ctx.orgId,
        performedBy: ctx.user.id,
        activityType: "ASSIGNMENT",
        title: `Assigned to ${counselor.name}`,
        notes: `Counselor ${counselor.name} assigned`,
        completedAt: new Date(),
        metadata: { counselorId },
      },
    });

    // Durable audit/activity owned by the sync assignment path (Inngest-independent)
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "lead.assigned",
      entityType: "lead",
      entityId: id,
      newValue: { counselorId, counselorName: counselor.name },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "assigned",
      objectType: "lead",
      objectId: id,
      objectSnapshot: { name: lead.name },
      context: { counselorId, counselorName: counselor.name, actorName: ctx.user.name },
    });

    await emitEvent({
      name: "lead/assigned",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        leadId: id,
        leadName: lead.name,
        counselorId,
        counselorName: counselor.name,
      },
    });

    await this.recalculateScore(ctx, id, "assigned");

    return { ok: true };
  }

  /**
   * Canonical bulk assignment. Every lead gets the same ASSIGNMENT activity,
   * audit entry, feed item and event as the single-assign path — bulk must not
   * bypass the canonical assignment pipeline (Phase G — legacy PATCH bypass).
   */
  static async assignMany(
    ctx: RequestContext,
    leadIds: string[],
    counselorId: string,
    note?: string,
  ) {
    const counselor = await prisma.user.findFirst({
      where: { id: counselorId, orgId: ctx.orgId, isActive: true },
      select: { id: true, name: true },
    });
    if (!counselor) throw new NotFoundError("Counselor", counselorId);

    const existing = await prisma.lead.findMany({
      where: { id: { in: leadIds }, orgId: ctx.orgId, deletedAt: null },
      select: { id: true },
    });
    const foundIds = new Set(existing.map((l) => l.id));
    const missing = leadIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      throw new NotFoundError("Lead", missing[0]);
    }

    const noteText = note ?? `Bulk assignment to ${counselor.name}`;

    for (const leadId of leadIds) {
      await prisma.$transaction([
        prisma.lead.update({ where: { id: leadId }, data: { assignedTo: counselorId } }),
        prisma.leadActivity.create({
          data: {
            leadId,
            orgId: ctx.orgId,
            performedBy: ctx.user.id,
            activityType: "ASSIGNMENT",
            title: `Assigned to ${counselor.name}`,
            notes: noteText === `Bulk assignment to ${counselor.name}` ? `${noteText} (${leadId})` : noteText,
            completedAt: new Date(),
            metadata: { counselorId, bulk: true },
          },
        }),
      ]);
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "lead.bulk_assigned",
      entityType: "lead",
      entityId: leadIds.length === 1 ? leadIds[0] : undefined,
      newValue: { leadIds, count: leadIds.length, counselorId, counselorName: counselor.name },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "bulk_assigned",
      objectType: "lead",
      objectId: leadIds[0] ?? "",
      objectSnapshot: {},
      context: { count: leadIds.length, counselorId, counselorName: counselor.name, actorName: ctx.user.name },
    });

    await emitEvent({
      name: "lead/bulk.assigned",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        leadIds,
        count: leadIds.length,
        counselorId,
        counselorName: counselor.name,
      },
    });

    for (const leadId of leadIds) {
      await this.recalculateScore(ctx, leadId, "bulk_assigned").catch(() => undefined);
    }

    return { ok: true, count: leadIds.length };
  }

  static async delete(ctx: RequestContext, id: string) {
    await this.getById(ctx, id);
    await LeadRepository.softDelete(ctx.orgId, id, ctx.user.id);

    // Also soft-delete any linked student so they move into the Recycle Bin together
    await prisma.student.updateMany({
      where: { leadId: id, orgId: ctx.orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: ctx.user.id },
    });

    await prisma.admission.updateMany({
      where: { leadId: id, orgId: ctx.orgId, deletedAt: null },
      data: { deletedAt: new Date(), deletedBy: ctx.user.id },
    });

    const { AuditService } = await import("@/lib/services/audit.service");
    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "lead.deleted",
      entityType: "lead",
      entityId: id,
    });

    return { ok: true };
  }

  // ─── Lead Activities ───────────────────────────────────────────────────

  static async recordDisposition(
    ctx: RequestContext,
    leadId: string,
    input: {
      disposition: string;
      remarks?: string;
      nextFollowUp?: Date | string | null;
    },
  ) {
    const lead = await LeadRepository.findById(ctx.orgId, leadId);
    if (!lead) throw new NotFoundError("Lead", leadId);

    const now = new Date();
    const nextDate = input.nextFollowUp ? new Date(input.nextFollowUp) : undefined;

    const updated = await prisma.lead.update({
      where: { id: leadId, orgId: ctx.orgId },
      data: {
        lastDisposition: input.disposition,
        dispositionAt: now,
        lastActivityAt: now,
        ...(nextDate !== undefined ? { nextFollowUp: nextDate } : {}),
      },
    });

    await prisma.leadActivity.create({
      data: {
        orgId: ctx.orgId,
        leadId,
        activityType: "CALL",
        title: `Call Disposition: ${input.disposition}`,
        notes: input.remarks || `Disposition logged as ${input.disposition}`,
        performedBy: ctx.user.id,
        metadata: {
          disposition: input.disposition,
          ...(nextDate ? { nextFollowUp: nextDate.toISOString() } : {}),
        },
      },
    });

    return updated;
  }

  static async createActivity(
    ctx: RequestContext,
    leadId: string,
    input: CreateActivityInput,
  ) {
    await this.getById(ctx, leadId);

    const activity = await prisma.leadActivity.create({
      data: {
        leadId,
        orgId: ctx.orgId,
        performedBy: ctx.user.id,
        activityType: input.activityType,
        title: input.title,
        notes: input.notes,
        outcome: input.outcome,
        nextAction: input.nextAction,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        completedAt: input.completedAt
          ? new Date(input.completedAt)
          : input.activityType === "NOTE" || input.activityType === "CALL" || input.activityType === "EMAIL" || input.activityType === "WHATSAPP" || input.activityType === "SMS" || input.activityType === "MEETING"
            ? new Date()
            : null,
        durationMins: input.durationMins,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        performer: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    // Update lead touch + optional follow-up
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        lastActivityAt: new Date(),
        ...(input.dueAt ? { nextFollowUp: new Date(input.dueAt) } : {}),
      },
    });

    await this.recalculateScore(ctx, leadId, `activity:${input.activityType}`);

    // Durable audit/activity owned by the sync activity path (Inngest-independent)
    const leadName = (await LeadRepository.findById(ctx.orgId, leadId))?.name ?? "";

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "lead_activity.created",
      entityType: "lead_activity",
      entityId: activity.id,
      newValue: { leadId, type: activity.activityType },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "logged_activity",
      objectType: "lead",
      objectId: leadId,
      objectSnapshot: { name: leadName },
      context: { activityType: activity.activityType, actorName: ctx.user.name },
    });

    await emitEvent({
      name: "lead/activity.created",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        leadId,
        leadName,
        activityId: activity.id,
        activityType: activity.activityType,
      },
    });

    return activity;
  }

  static async completeActivity(
    ctx: RequestContext,
    leadId: string,
    activityId: string,
    input: { completedAt?: string; outcome?: string } = {},
  ) {
    await this.getById(ctx, leadId);
    const existing = await prisma.leadActivity.findFirst({
      where: { id: activityId, leadId, orgId: ctx.orgId },
    });
    if (!existing) throw new NotFoundError("LeadActivity", activityId);

    const activity = await prisma.leadActivity.update({
      where: { id: activityId },
      data: {
        completedAt: input.completedAt ? new Date(input.completedAt) : new Date(),
        ...(input.outcome !== undefined ? { outcome: input.outcome, completedAt: existing.completedAt ?? new Date() } : {}),
      },
      include: {
        performer: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { lastActivityAt: new Date() },
    });

    return activity;
  }

  static async updateFollowUp(ctx: RequestContext, leadId: string, nextFollowUp: string | null) {
    await this.getById(ctx, leadId);
    return prisma.lead.update({
      where: { id: leadId },
      data: { nextFollowUp: nextFollowUp ? new Date(nextFollowUp) : null },
      select: { id: true, nextFollowUp: true },
    });
  }

  /** Schedule a future MEETING activity (dueAt set, not yet completed). */
  static async scheduleMeeting(
    ctx: RequestContext,
    leadId: string,
    input: {
      title?: string;
      dueAt: string;
      durationMins?: number;
      mode?: MeetingMode;
      notes?: string;
      outcome?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.getById(ctx, leadId);

    const dueAt = new Date(input.dueAt);
    if (Number.isNaN(dueAt.getTime())) {
      const { ValidationError } = await import("@/lib/utils/errors");
      throw new ValidationError([{ message: "dueAt must be a valid datetime" }]);
    }

    const activity = await prisma.leadActivity.create({
      data: {
        leadId,
        orgId: ctx.orgId,
        performedBy: ctx.user.id,
        activityType: "MEETING",
        title: input.title ?? "Meeting scheduled",
        notes: input.notes,
        outcome: input.outcome,
        dueAt,
        completedAt: null,
        durationMins: input.durationMins,
        metadata: (withMeetingMode(input.metadata, input.mode) ?? {}) as Prisma.InputJsonValue,
      },
      include: {
        performer: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { lastActivityAt: new Date(), nextFollowUp: dueAt },
    });

    await this.recalculateScore(ctx, leadId, "activity:MEETING");

    // Durable audit/activity owned by the sync scheduling path (Inngest-independent)
    const leadName = (await LeadRepository.findById(ctx.orgId, leadId))?.name ?? "";

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "lead_activity.created",
      entityType: "lead_activity",
      entityId: activity.id,
      newValue: { leadId, type: "MEETING" },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "logged_activity",
      objectType: "lead",
      objectId: leadId,
      objectSnapshot: { name: leadName },
      context: { activityType: "MEETING", actorName: ctx.user.name },
    });

    await emitEvent({
      name: "lead/activity.created",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        leadId,
        leadName,
        activityId: activity.id,
        activityType: "MEETING",
      },
    });

    return activity;
  }

  /** Update (reschedule / edit) a persisted MEETING activity. */
  static async updateMeeting(
    ctx: RequestContext,
    leadId: string,
    meetingId: string,
    input: {
      title?: string;
      dueAt?: string;
      durationMins?: number;
      mode?: MeetingMode;
      notes?: string;
      outcome?: string;
      metadata?: Record<string, unknown>;
    },
  ) {
    await this.getById(ctx, leadId);
    const existing = await prisma.leadActivity.findFirst({
      where: { id: meetingId, leadId, orgId: ctx.orgId, activityType: "MEETING" },
    });
    if (!existing) throw new NotFoundError("Meeting", meetingId);

    const dueAt = input.dueAt ? new Date(input.dueAt) : undefined;
    if (dueAt && Number.isNaN(dueAt.getTime())) {
      const { ValidationError } = await import("@/lib/utils/errors");
      throw new ValidationError([{ message: "dueAt must be a valid datetime" }]);
    }

    const activity = await prisma.leadActivity.update({
      where: { id: meetingId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(dueAt ? { dueAt } : {}),
        ...(input.durationMins !== undefined ? { durationMins: input.durationMins } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
        ...(input.metadata !== undefined || input.mode !== undefined
          ? {
              metadata: withMeetingMode(
                input.metadata ?? ((existing.metadata ?? {}) as Record<string, unknown>),
                input.mode,
              ) as Prisma.InputJsonValue,
            }
          : {}),
      },
      include: {
        performer: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    if (dueAt) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { lastActivityAt: new Date(), nextFollowUp: dueAt },
      });
    } else {
      await prisma.lead.update({ where: { id: leadId }, data: { lastActivityAt: new Date() } });
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "lead_activity.updated",
      entityType: "lead_activity",
      entityId: meetingId,
      newValue: { leadId, type: "MEETING" },
    });

    return activity;
  }

  /** Cancel a scheduled MEETING: marks it done with a CANCELLED outcome (kept for audit). */
  static async cancelMeeting(ctx: RequestContext, leadId: string, meetingId: string) {
    await this.getById(ctx, leadId);
    const existing = await prisma.leadActivity.findFirst({
      where: { id: meetingId, leadId, orgId: ctx.orgId, activityType: "MEETING" },
    });
    if (!existing) throw new NotFoundError("Meeting", meetingId);

    const activity = await prisma.leadActivity.update({
      where: { id: meetingId },
      data: {
        completedAt: new Date(),
        outcome: "CANCELLED",
        metadata: {
          ...(existing.metadata as Record<string, unknown>),
          cancelledAt: new Date().toISOString(),
          cancelledBy: ctx.user.id,
        } as Prisma.InputJsonValue,
      },
      include: {
        performer: { select: { id: true, name: true, avatarUrl: true } },
      },
    });

    await prisma.lead.update({
      where: { id: leadId },
      data: { lastActivityAt: new Date() },
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      action: "lead_activity.cancelled",
      entityType: "lead_activity",
      entityId: meetingId,
      newValue: { leadId, type: "MEETING", outcome: "CANCELLED" },
    });

    return activity;
  }

  /** Simple deterministic score: base + status + activity counts. Caps at 100. */
  static async recalculateScore(ctx: RequestContext, leadId: string, reason?: string) {
    const lead = await this.getById(ctx, leadId);
    const counts = await prisma.leadActivity.groupBy({
      by: ["activityType"],
      where: { leadId, orgId: ctx.orgId },
      _count: { _all: true },
    });

    const byType = Object.fromEntries(counts.map((c) => [c.activityType, c._count._all]));
    let score = 10;
    const statusBoost: Record<string, number> = {
      NEW: 0,
      CONTACTED: 10,
      INTERESTED: 20,
      FOLLOW_UP: 15,
      COUNSELED: 30,
      APPLICATION_SUBMITTED: 40,
      CONVERTED: 90,
      LOST: 0,
      CONNECTED: 15,
      CALL_BACK: 20,
      PROSPECT: 45,
      WON: 90,
      NOT_CONNECTED: 0,
      RINGING: 0,
      NOT_REACHABLE: 0,
      SWITCHED_OFF: 0,
      VOICEMAIL: 0,
      INCOMING_BARD: 0,
      OUT_OF_SERVICE: 0,
      NOT_AWARE: 0,
      NOT_CONTACTABLE: 0,
      LOCATION_OUT_OF_SCOPE: 0,
      LANGUAGE_BARRIER: 0,
      PRICE_HIGH: 0,
      JOINED_OTHERS: 0,
      NOT_ELIGIBLE: 0,
      INVALID_NUMBER: 0,
      TEST_LEAD: 0,
    };
    score += statusBoost[lead.status] ?? 0;
    score += Math.min(15, (byType.CALL ?? 0) * 5);
    score += Math.min(10, (byType.EMAIL ?? 0) * 3);
    score += Math.min(10, (byType.WHATSAPP ?? 0) * 3);
    score += Math.min(10, (byType.MEETING ?? 0) * 5);
    score += Math.min(5, (byType.NOTE ?? 0) * 1);
    if (lead.assignedTo) score += 5;
    if (lead.email) score += 5;
    if (lead.courseInterest) score += 5;
    score = Math.max(0, Math.min(100, score));

    if (score === lead.score) return lead;

    await prisma.$transaction([
      prisma.lead.update({
        where: { id: leadId },
        data: { score },
      }),
      prisma.leadScoreHistory.create({
        data: {
          leadId,
          orgId: ctx.orgId,
          score,
          reason: reason ?? "recalculate",
        },
      }),
    ]);

    return LeadRepository.findById(ctx.orgId, leadId);
  }

  static async convertToAdmission(
    ctx: RequestContext,
    leadId: string,
    input: {
      courseName?: string;
      counselorId?: string;
      campusId?: string;
      feeAmount?: number;
      notes?: string;
      dealData?: { courseId?: string; batchId?: string; feePlanId?: string; value?: number };
    } = {},
  ) {
    const lead = await this.getById(ctx, leadId);
    if (isLostStatus(lead.status as LeadStatus)) {
      throw new ValidationError([{ message: "Cannot convert a lost lead" }]);
    }

    // Check if there is an existing valid admission to route to, even if the lead is already WON.
    const earlyExisting = await prisma.admission.findFirst({
      where: { leadId, orgId: ctx.orgId },
      orderBy: { createdAt: "desc" },
    });
    if (earlyExisting && earlyExisting.stage !== "CANCELLED" && earlyExisting.stage !== "DROPPED") {
      return { admission: earlyExisting, created: false };
    }

    if (LOCKED_LEAD_STATUSES.includes(lead.status as LeadStatus)) {
      throw new ValidationError([
        { message: "Lead is already converted/enrolled but no active admission was found." },
      ]);
    }

    // The lead must be a Prospect with an open Deal to convert; this is the
    // canonical path (PROSPECT → Deal → Admission). If the lead was never
    // marked PROSPECT, ensure the deal so the funnel stays consistent.
    const { DealService } = await import("@/lib/services/deal.service");
    const ensured = await DealService.ensureDealForLead(ctx, leadId, {
      title: lead.courseInterest ? `${lead.name} — ${lead.courseInterest}` : `${lead.name} — Prospect`,
      source: lead.source,
      assignedTo: lead.assignedTo ?? undefined,
      ...(input.dealData ?? {}),
    });
    const deal = ensured.deal;

    // Single conversion path: the deal service creates the admission, links it
    // race-safely, marks the deal won and the lead WON with a timeline entry.
    const result = await DealService.convertToAdmission(ctx, deal.id, {
      courseName: input.courseName,
      counselorId: input.counselorId,
      campusId: input.campusId,
      feeAmount: input.feeAmount,
      notes: input.notes,
    });
    if (result.created) {
      await this.recalculateScore(ctx, leadId, "converted_to_admission");
    }
    return result;
  }

  static async listActivities(ctx: RequestContext, leadId: string, page = 1, limit = 20) {
    await this.getById(ctx, leadId);

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      prisma.leadActivity.findMany({
        where: { leadId, orgId: ctx.orgId },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          performer: { select: { id: true, name: true, avatarUrl: true, role: true } },
        },
      }),
      prisma.leadActivity.count({ where: { leadId, orgId: ctx.orgId } }),
    ]);

    return { data, total };
  }

  static async getPipelineCounts(ctx: RequestContext) {
    return LeadRepository.getStatusCounts(ctx.orgId);
  }
}
