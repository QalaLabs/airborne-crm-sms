import { type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { LeadService } from "@/lib/services/lead.service";
import { AuditService } from "@/lib/services/audit.service";
import { AutoCallingService } from "@/lib/services/auto-calling.service";
import { guard, getCounselorCondition, guardRecord } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { ValidationError } from "@/lib/utils/errors";

const agentCallSchema = z.object({
  objective: z.string().max(2000).optional(),
  customInstructions: z.string().max(2000).optional(),
});

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/leads/[id]/agent-call
 * Returns agent calling readiness & recent voice activities for this lead.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "read", "leads");

    const lead = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "read", "leads", lead as unknown as Record<string, unknown>, condition);

    // Fetch call activities for this lead
    const callActivities = await prisma.leadActivity.findMany({
      where: {
        leadId: lead.id,
        orgId: ctx.orgId,
        activityType: "CALL",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });

    const voiceAssistantUrl =
      process.env.VOICE_ASSISTANT_URL || "https://airborne-voice-assistant-368523757732.asia-south1.run.app";

    const activeCallsCount = await AutoCallingService.getActiveCallsCount(ctx.orgId);

    return ok({
      leadId: lead.id,
      phone: lead.phone,
      hasPhone: !!lead.phone,
      voiceAssistantConfigured: !!voiceAssistantUrl,
      activeCallsCount,
      maxConcurrentCalls: AutoCallingService.MAX_CONCURRENT_CALLS,
      recentCalls: callActivities.map((a) => ({
        id: a.id,
        title: a.title,
        outcome: a.outcome,
        durationMins: a.durationMins,
        createdAt: a.createdAt,
        metadata: a.metadata,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * POST /api/v1/leads/[id]/agent-call
 * Initiates an outbound call from the AI Voice Assistant to the lead's phone number.
 */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id } = await params;
    guard(ctx.user, "write", "leads");

    const lead = await LeadService.getById(ctx, id);
    const condition = getCounselorCondition(ctx.user);
    guardRecord(ctx.user, "write", "leads", lead as unknown as Record<string, unknown>, condition);

    if (!lead.phone) {
      throw new ValidationError([{ path: ["phone"], message: "Lead does not have a phone number" }]);
    }

    // Strict concurrency check: max 2 active calls permitted simultaneously
    const activeCalls = await AutoCallingService.getActiveCallsCount(ctx.orgId);
    if (activeCalls >= AutoCallingService.MAX_CONCURRENT_CALLS) {
      throw new ValidationError([
        {
          path: ["agent_concurrency"],
          message: `AI Voice Agent is currently on ${activeCalls} calls (maximum capacity: ${AutoCallingService.MAX_CONCURRENT_CALLS}). Please wait for an active call to conclude before initiating another.`,
        },
      ]);
    }

    const body = (await req.json().catch(() => ({}))) as unknown;
    const parsed = agentCallSchema.parse(body ?? {});

    const voiceAssistantUrl =
      process.env.VOICE_ASSISTANT_URL || "https://airborne-voice-assistant-368523757732.asia-south1.run.app";
    const apiKey =
      process.env.VOICE_ASSISTANT_API_KEY ||
      process.env.API_SHARED_SECRET ||
      "AbvgRHR33ZOCqBb2tLsslaCL69qc3UJvC4FDGFl9t2A";

    // Format phone to E.164-compatible format for Indian carrier (+91...)
    let targetPhone = lead.phone.replace(/[\s-]/g, "");
    if (!targetPhone.startsWith("+")) {
      const digitsOnly = targetPhone.replace(/\D/g, "");
      if (digitsOnly.length === 10) {
        targetPhone = `+91${digitsOnly}`;
      } else if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
        targetPhone = `+${digitsOnly}`;
      } else {
        targetPhone = `+${digitsOnly}`;
      }
    }

    const callPayload = {
      phone: targetPhone,
      name: lead.name || "Candidate",
      course_interest: lead.courseInterest || "Commercial Pilot License (CPL)",
      city: lead.city || undefined,
      notes: parsed.objective || parsed.customInstructions || undefined,
      call_objective: parsed.objective || "Lead qualification and counseling booking",
      custom_instructions: parsed.customInstructions || undefined,
      source: "CRM_AGENT_DISPATCH",
    };

    let dispatchResult: Record<string, unknown> = {};
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(`${voiceAssistantUrl.replace(/\/$/, "")}/api/calls/dispatch`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
        },
        body: JSON.stringify(callPayload),
        signal: controller.signal,
      });

      const resData = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const errorMsg =
          (typeof resData?.message === "string" && resData.message) ||
          (typeof resData?.error === "string" && resData.error) ||
          (typeof resData?.detail === "string" && resData.detail) ||
          `Voice assistant dispatch failed (${response.status})`;
        throw new Error(errorMsg);
      }

      dispatchResult = resData;
    } catch (err: unknown) {
      const error = err as Error;
      if (error.name === "AbortError") {
        throw new ValidationError([
          { path: ["voice_assistant"], message: "Call dispatch timed out connecting to Voice Assistant." },
        ]);
      }
      throw new ValidationError([
        { path: ["voice_assistant"], message: error.message || "Failed to trigger AI agent call" },
      ]);
    } finally {
      clearTimeout(timeoutId);
    }

    // Persist call initiation in CRM timeline as active (completedAt: null)
    const activity = await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        orgId: ctx.orgId,
        performedBy: ctx.user.id,
        activityType: "CALL",
        title: "AI Voice Agent Call In Progress",
        notes: `Outbound AI agent call dispatched to ${targetPhone} by counsellor ${ctx.user.name}.${
          parsed.objective ? ` Objective: ${parsed.objective}` : ""
        }`,
        outcome: "IN_PROGRESS",
        completedAt: null, // Active call until carrier completion webhook
        metadata: {
          phone: targetPhone,
          provider: dispatchResult?.provider || "telecmi",
          requestId: dispatchResult?.request_id || null,
          greeting: dispatchResult?.greeting || null,
          dispatchedBy: ctx.user.name,
          dispatchedById: ctx.user.id,
          dispatchedAt: new Date().toISOString(),
          objective: parsed.objective || null,
        },
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data: { lastActivityAt: new Date() },
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      action: "CALL_INITIATED",
      entityType: "lead",
      entityId: lead.id,
      newValue: {
        phone: targetPhone,
        activityId: activity.id,
        provider: dispatchResult?.provider,
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });

    return ok({
      success: true,
      message: `AI Voice Agent call initiated to ${targetPhone}.`,
      dispatch: dispatchResult,
      activityId: activity.id,
    });
  } catch (err) {
    return handleError(err);
  }
}
