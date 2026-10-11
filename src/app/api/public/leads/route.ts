import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import type { LeadSource } from "@prisma/client";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/utils/rate-limit";
import { resolveIntakeRateLimitIp } from "@/lib/utils/client-ip";
import { safeEqualString } from "@/lib/utils/crypto";
import { generateResourceToken } from "@/lib/utils/resource-token";
import { publicLeadSchema } from "@/lib/validations/public-lead.schema";
import { emitLeadCreated } from "@/lib/automation/emit-lead-created";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { checkMaintenance } from "@/lib/middleware/maintenance";
import { handleError } from "@/lib/utils/response";
import { isHoneypotTripped } from "@/lib/utils/honeypot";
import { evaluateEligibility, type EvaluatedEligibility } from "@/lib/courses/eligibility";
import { getCourseEligibility } from "@/lib/services/course-eligibility.service";

const SOURCE_MAP: Record<string, LeadSource> = {
  homepage_cta: "HOMEPAGE_CTA",
  contact_form: "CONTACT_FORM",
  brochure_download: "BROCHURE_DOWNLOAD",
  course_page: "COURSE_PAGE",
};

export async function POST(req: NextRequest) {
  try {
    await checkMaintenance();
    const apiKey = req.headers.get("x-intake-key");
    if (!process.env.PUBLIC_INTAKE_KEY || !safeEqualString(apiKey, process.env.PUBLIC_INTAKE_KEY)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

  // Rate limit: 5 requests per minute per visitor IP
  const ip = resolveIntakeRateLimitIp(req);
  const decision = await consumeRateLimit(`lead:${ip}`, 5, 60_000);

  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: rateLimitHeaders(decision),
      },
    );
  }

  const body = (await req.json()) as unknown;
    if (isHoneypotTripped(body)) {
      console.warn(JSON.stringify({ event: "lead_honeypot_triggered", timestamp: new Date().toISOString() }));
      return NextResponse.json({ success: true }, { status: 200 });
    }
    const parsed = publicLeadSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      const field = first?.path[0] ?? "body";
      const reason = first?.message ?? "Invalid request body";
      return NextResponse.json(
        { error: `${field}: ${reason}` },
        { status: 400 },
      );
    }
    const input = parsed.data;
    const {
      name,
      email,
      phone,
      courseInterest,
      pincode,
      source,
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
      referrerUrl,
      landingPage,
      leadUuid,
    } = input;

    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: { id: true, settings: true },
    });

    if (!org) {
      console.error("[Public Lead] Org not found:", process.env.PUBLIC_ORG_SLUG);
      return NextResponse.json({ error: "Academy configuration missing" }, { status: 500 });
    }

    const settings = org.settings as Record<string, unknown> | null;
    if (settings && settings.applicationIntake === false) {
      return NextResponse.json({ error: "Application intake is closed" }, { status: 403 });
    }

    const normalizedPhone = String(phone).trim();
    const leadSource: LeadSource = SOURCE_MAP[source?.toLowerCase() ?? ""] ?? "HOMEPAGE_CTA";
    const requestUuid = leadUuid?.trim() || null;

    // Advisory course pre-check: validated against the selected course's questions
    // (400 on unknown questions/values) but never blocks a valid enquiry.
    const eligibility: EvaluatedEligibility | null =
      input.eligibility && Object.keys(input.eligibility).length > 0
        ? evaluateEligibility(await getCourseEligibility(org.id, courseInterest), input.eligibility)
        : null;
    const eligibilitySummary = eligibility ? { course: eligibility.course, result: eligibility.result } : null;

    // Idempotency: a retry of the same submission (same leadUuid) must not
    // create a second lead or a misleading 409 — return the original lead.
    if (requestUuid) {
      const replayed = await prisma.lead.findFirst({
        where: {
          orgId: org.id,
          customFields: { path: ["leadUuid"], equals: requestUuid },
        },
        select: { id: true, name: true, createdAt: true },
      });
      if (replayed) {
        await emitLeadCreated({
          orgId: org.id,
          leadId: replayed.id,
          leadName: replayed.name,
          source: leadSource,
          courseInterest: courseInterest,
          actorName: "Public form",
          ipAddress: ip,
        });
        const gateToken = generateResourceToken(normalizedPhone);
        console.log(JSON.stringify({
          event: "lead_replayed",
          leadId: replayed.id,
          timestamp: new Date().toISOString(),
        }));
        return NextResponse.json(
          { success: true, data: replayed, gateToken, eligibility: eligibilitySummary, meta: { replayed: true } },
          { status: 200 },
        );
      }
    }

    // Lead row + initial activity + lastActivityAt commit atomically. The 201 is
    // returned only after this transaction commits, so success can never mean
    // "partially persisted". External side effects (audit/feed/Inngest) stay
    // outside the transaction.
    let lead: { id: string; name: string; createdAt: Date } | null = null;
    try {
      lead = await prisma.$transaction(async (tx) => {
        const created = await tx.lead.create({
          data: {
            name,
            email: email ?? null,
            phone: normalizedPhone,
            courseInterest: courseInterest ?? null,
            pincode: pincode ?? null,
            source: leadSource,
            orgId: org.id,
            utmSource: utmSource ?? null,
            utmMedium: utmMedium ?? null,
            utmCampaign: utmCampaign ?? null,
            utmTerm: utmTerm ?? null,
            utmContent: utmContent ?? null,
            referrerUrl: referrerUrl ?? null,
            landingPage: landingPage ?? null,
            customFields: {
              webSource: source ?? "website",
              ...(requestUuid ? { leadUuid: requestUuid } : {}),
              ...(eligibility ? { eligibility: { ...eligibility, evaluatedAt: new Date().toISOString() } } : {}),
            },
          },
          select: { id: true, name: true, createdAt: true },
        });

        await tx.leadActivity.create({
          data: {
            leadId: created.id,
            orgId: org.id,
            activityType: "NOTE",
            title: "Web form submission",
            notes: `Enquiry received via ${leadSource.replace("_", " ")}`,
            completedAt: new Date(),
            metadata: { source: leadSource, webSource: source ?? "website" },
          },
        });

        await tx.lead.update({
          where: { id: created.id },
          data: { lastActivityAt: new Date() },
        });

        return created;
      });
    } catch (err) {
      // The org-scoped unique(orgId, phone) constraint makes a duplicate lead
      // insert impossible — surface it as a clean 409 instead of a 500.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code?: string }).code === "P2002"
      ) {
        // A concurrent request may have committed the same leadUuid first —
        // treat that race as an idempotent replay, not a duplicate rejection.
        if (requestUuid) {
          const raced = await prisma.lead.findFirst({
            where: {
              orgId: org.id,
              customFields: { path: ["leadUuid"], equals: requestUuid },
            },
            select: { id: true, name: true, createdAt: true },
          });
          if (raced) {
            await emitLeadCreated({
              orgId: org.id,
              leadId: raced.id,
              leadName: raced.name,
              source: leadSource,
              courseInterest: courseInterest,
              actorName: "Public form",
              ipAddress: ip,
            });
            const gateToken = generateResourceToken(normalizedPhone);
            console.log(JSON.stringify({
              event: "lead_replayed",
              leadId: raced.id,
              reason: "concurrent_race",
              timestamp: new Date().toISOString(),
            }));
            return NextResponse.json(
              { success: true, data: raced, gateToken, eligibility: eligibilitySummary, meta: { replayed: true } },
              { status: 200 },
            );
          }
        }
        const existingByPhone = await prisma.lead.findFirst({
          where: { orgId: org.id, phone: normalizedPhone },
          select: { id: true, name: true, createdAt: true, deletedAt: true },
        });
        // A lead sitting in the Recycle Bin still owns unique(orgId, phone).
        // A fresh enquiry from that person restores it instead of being lost.
        if (existingByPhone?.deletedAt) {
          await prisma.$transaction([
            prisma.lead.update({
              where: { id: existingByPhone.id },
              data: { deletedAt: null, lastActivityAt: new Date() },
            }),
            prisma.leadActivity.create({
              data: {
                leadId: existingByPhone.id,
                orgId: org.id,
                activityType: "NOTE",
                title: "Re-enquiry — restored from Recycle Bin",
                notes: `New enquiry received via ${leadSource.replace("_", " ")}${courseInterest ? ` for ${courseInterest}` : ""}.`,
                completedAt: new Date(),
                metadata: { source: leadSource, webSource: source ?? "website", restoredFromTrash: true },
              },
            }),
          ]);
          await AuditService.write({
            orgId: org.id,
            action: "lead.restored",
            entityType: "lead",
            entityId: existingByPhone.id,
            newValue: { reason: "public_re_enquiry", source: leadSource },
          });
          await emitLeadCreated({
            orgId: org.id,
            leadId: existingByPhone.id,
            leadName: existingByPhone.name,
            source: leadSource,
            courseInterest: courseInterest,
            actorName: "Public form",
            ipAddress: ip,
          });
          return NextResponse.json(
            {
              success: true,
              data: { id: existingByPhone.id, name: existingByPhone.name, createdAt: existingByPhone.createdAt },
              gateToken: generateResourceToken(normalizedPhone),
              eligibility: eligibilitySummary,
              meta: { restored: true },
            },
            { status: 200 },
          );
        }
        if (existingByPhone) {
          await emitLeadCreated({
            orgId: org.id,
            leadId: existingByPhone.id,
            leadName: existingByPhone.name,
            source: leadSource,
            courseInterest: courseInterest,
            actorName: "Public form",
            ipAddress: ip,
          });
        }
        console.log(JSON.stringify({
          event: "lead_duplicate",
          phone: normalizedPhone,
          timestamp: new Date().toISOString(),
        }));
        // The existing lead is not modified from an unauthenticated request; the
        // pre-check result is only echoed back to the visitor.
        return NextResponse.json(
          { error: "A lead with this phone already exists", eligibility: eligibilitySummary },
          { status: 409 },
        );
      }
      throw err;
    }

    console.log(JSON.stringify({
      event: "lead_saved",
      leadId: lead.id,
      timestamp: new Date().toISOString(),
    }));

    // Durable audit/activity owned by the sync path (Inngest-independent).
    // Public submission — no authenticated user, so actor is null and the
    // human-readable identity lives in the feed context.
    await AuditService.write({
      orgId: org.id,
      ipAddress: ip,
      action: "lead.created",
      entityType: "lead",
      entityId: lead.id,
      newValue: { name: lead.name, source: leadSource, phone: normalizedPhone },
    });

    await ActivityFeedService.write({
      orgId: org.id,
      verb: "created",
      objectType: "lead",
      objectId: lead.id,
      objectSnapshot: { name: lead.name, source: leadSource },
      context: { actorName: "Public form" },
    });

    // Emit after the lead row exists. Interakt track is inline + idempotent on lead id.
    await emitLeadCreated({
      orgId: org.id,
      leadId: lead.id,
      leadName: lead.name,
      source: leadSource,
      courseInterest: courseInterest,
      actorName: "Public form",
      ipAddress: ip,
    });

    // Issue a short-lived token granting access to gated resources
    const gateToken = generateResourceToken(normalizedPhone);

    return NextResponse.json(
      {
        success: true,
        data: lead,
        gateToken,
        eligibility: eligibilitySummary,
        meta: { "X-RateLimit-Remaining": String(decision.remaining) },
      },
      { status: 201 },
    );
  } catch (err) {
    return handleError(err);
  }
}
