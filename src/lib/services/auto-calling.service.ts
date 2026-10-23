import { prisma } from "@/lib/db/client";

export interface AutoCallResult {
  status: "dispatched" | "queued" | "skipped" | "failed";
  reason?: string;
  activityId?: string;
  error?: string;
}

export class AutoCallingService {
  /** Maximum number of simultaneous voice agent calls permitted at any moment */
  static readonly MAX_CONCURRENT_CALLS = 2;

  /** Maximum number of total call attempts permitted per candidate (initial attempt + up to 2 retries) */
  static readonly MAX_CALL_ATTEMPTS = 3;

  /** Minimum cool-off duration before retrying an unanswered lead (2 hours) */
  static readonly RETRY_COOL_OFF_MS = 2 * 60 * 60 * 1000;

  /** Safety expiration lease for active calls (15 mins) to prevent orphaned locks */
  static readonly ACTIVE_CALL_LEASE_MS = 15 * 60 * 1000;

  /**
   * Returns current number of active calls for the organization.
   * An active call is a CALL activity with no completedAt timestamp and an in-progress outcome.
   */
  static async getActiveCallsCount(orgId: string): Promise<number> {
    const activeThreshold = new Date(Date.now() - this.ACTIVE_CALL_LEASE_MS);
    return prisma.leadActivity.count({
      where: {
        orgId,
        activityType: "CALL",
        completedAt: null,
        outcome: { in: ["INITIATED", "IN_PROGRESS", "RINGING", "DISPATCHED"] },
        createdAt: { gte: activeThreshold },
      },
    });
  }

  /**
   * Checks whether the current time falls inside India Standard Time calling hours (09:00 - 20:00 IST).
   */
  static isCallingWindowOpen(now = new Date()): boolean {
    const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);
    const hour = istDate.getHours();
    return hour >= 9 && hour < 20;
  }

  /**
   * Normalizes raw phone to E.164 (+91XXXXXXXXXX for 10-digit Indian numbers).
   */
  static normalizePhone(rawPhone: string): string {
    const cleaned = rawPhone.replace(/[\s-]/g, "");
    if (cleaned.startsWith("+")) return cleaned;
    const digits = cleaned.replace(/\D/g, "");
    if (digits.length === 10) return `+91${digits}`;
    if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
    return `+${digits}`;
  }

  /**
   * Evaluates whether an unanswered candidate qualifies for an automated retry call.
   * Pure business logic method for easy testing and predictable execution.
   */
  static isEligibleForRetry(params: {
    totalCalls: number;
    hasConnectedCall: boolean;
    lastCallOutcome: string | null;
    lastCallCompleted: boolean;
    lastCallCreatedAt: Date;
    hasManualIntervention: boolean;
    nextFollowUp?: Date | null;
    now?: Date;
  }): { eligible: boolean; reason?: string } {
    if (params.totalCalls >= this.MAX_CALL_ATTEMPTS) {
      return { eligible: false, reason: "max_attempts_reached" };
    }
    if (params.hasConnectedCall) {
      return { eligible: false, reason: "already_connected" };
    }
    if (!params.lastCallCompleted) {
      return { eligible: false, reason: "call_in_progress" };
    }
    const unanswered = ["NO_ANSWER", "BUSY", "MISSED", "REJECTED", "FAILED", "UNREACHABLE", "EARLY_HANGUP"];
    if (!unanswered.includes(params.lastCallOutcome || "")) {
      return { eligible: false, reason: "last_call_not_unanswered" };
    }
    if (params.hasManualIntervention) {
      return { eligible: false, reason: "manual_agent_active" };
    }
    const currentTime = params.now || new Date();
    const isPastDue = params.nextFollowUp ? new Date(params.nextFollowUp) <= currentTime : false;
    const isCoolOffElapsed =
      currentTime.getTime() - new Date(params.lastCallCreatedAt).getTime() >= this.RETRY_COOL_OFF_MS;
    if (!isPastDue && !isCoolOffElapsed) {
      return { eligible: false, reason: "cool_off_period" };
    }
    return { eligible: true };
  }

  /**
   * Automatically initiates an outbound call for a new lead.
   * Enforces lead qualification checks, calling window, duplicate prevention,
   * and the strict 2-call maximum concurrency limit.
   */
  static async handleNewLead(orgId: string, leadId: string): Promise<AutoCallResult> {
    if (process.env.AUTO_CALLING_ENABLED === "false") {
      return { status: "skipped", reason: "auto_calling_disabled" };
    }

    const lead = await prisma.lead.findFirst({
      where: { id: leadId, orgId, deletedAt: null },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        city: true,
        state: true,
        status: true,
        source: true,
        courseInterest: true,
        customFields: true,
      },
    });

    if (!lead) return { status: "skipped", reason: "lead_not_found" };
    if (!lead.phone) return { status: "skipped", reason: "no_phone" };

    const nonCallable = new Set([
      "TEST_LEAD",
      "OPTED_OUT",
      "DND",
      "LOST",
      "WON",
      "CONVERTED",
      "NOT_INTERESTED",
      "INVALID_NUMBER",
      "JOINED_OTHERS",
      "JOB_SEEKER",
    ]);
    if (nonCallable.has(lead.status)) {
      return { status: "skipped", reason: `non_callable_status_${lead.status}` };
    }

    // Duplicate check: skip if this lead already has an existing call activity
    const existingCall = await prisma.leadActivity.findFirst({
      where: {
        leadId: lead.id,
        orgId,
        activityType: "CALL",
      },
      select: { id: true, outcome: true },
    });
    if (existingCall) {
      return { status: "skipped", reason: "already_called_or_queued", activityId: existingCall.id };
    }

    const targetPhone = this.normalizePhone(lead.phone);

    // Calling hours check (09:00 - 20:00 IST)
    if (!this.isCallingWindowOpen()) {
      const queuedActivity = await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          orgId,
          activityType: "CALL",
          title: "AI Voice Agent Call Queued (Outside Calling Hours)",
          notes: `Enquiry received outside 09:00–20:00 IST calling window. Queued for automatic dialling at next window opening.`,
          outcome: "QUEUED",
          completedAt: null,
          metadata: {
            autoCall: true,
            phone: targetPhone,
            candidate: lead.name,
            course: lead.courseInterest,
            queuedReason: "outside_calling_hours",
            queuedAt: new Date().toISOString(),
          },
        },
      });
      return { status: "queued", reason: "outside_calling_hours", activityId: queuedActivity.id };
    }

    // Concurrency check: Agent must not be on more than 2 calls at any moment
    const activeCalls = await this.getActiveCallsCount(orgId);
    if (activeCalls >= this.MAX_CONCURRENT_CALLS) {
      const queuedActivity = await prisma.leadActivity.create({
        data: {
          leadId: lead.id,
          orgId,
          activityType: "CALL",
          title: "AI Voice Agent Call Queued (Concurrency Limit)",
          notes: `Voice agent is currently on ${activeCalls} calls (limit: ${this.MAX_CONCURRENT_CALLS}). Queued to dial automatically as soon as an ongoing call concludes.`,
          outcome: "QUEUED",
          completedAt: null,
          metadata: {
            autoCall: true,
            phone: targetPhone,
            candidate: lead.name,
            course: lead.courseInterest,
            queuedReason: "concurrency_limit_reached",
            activeCallsAtQueue: activeCalls,
            queuedAt: new Date().toISOString(),
          },
        },
      });
      return { status: "queued", reason: "concurrency_limit_reached", activityId: queuedActivity.id };
    }

    // Below concurrency limit (0 or 1 active call) -> dispatch outbound call
    return await this.dispatchCall(orgId, lead, targetPhone);
  }

  /**
   * Internal call dispatcher to the voice assistant microservice.
   */
  static async dispatchCall(
    orgId: string,
    lead: any,
    targetPhone: string,
    options?: { attemptNumber?: number; customNotes?: string }
  ): Promise<AutoCallResult> {
    const attempt = options?.attemptNumber || 1;
    const title =
      attempt > 1
        ? `AI Voice Agent Retry Call In Progress (Attempt ${attempt}/${this.MAX_CALL_ATTEMPTS})`
        : "AI Voice Agent Call In Progress";

    const activity = await prisma.leadActivity.create({
      data: {
        leadId: lead.id,
        orgId,
        activityType: "CALL",
        title,
        notes:
          options?.customNotes ||
          `Automated outbound AI voice call dispatched to ${targetPhone} for new enquiry (${
            lead.courseInterest || "Pilot Training"
          }).`,
        outcome: "IN_PROGRESS",
        completedAt: null, // Active call
        metadata: {
          autoCall: true,
          isRetry: attempt > 1,
          retryAttempt: attempt,
          maxAttempts: this.MAX_CALL_ATTEMPTS,
          phone: targetPhone,
          candidate: lead.name,
          course: lead.courseInterest,
          dispatchedAt: new Date().toISOString(),
        },
      },
    });

    const voiceAssistantUrl =
      process.env.VOICE_ASSISTANT_URL || "https://airborne-voice-assistant-368523757732.asia-south1.run.app";
    const apiKey =
      process.env.VOICE_ASSISTANT_API_KEY ||
      process.env.API_SHARED_SECRET ||
      "AbvgRHR33ZOCqBb2tLsslaCL69qc3UJvC4FDGFl9t2A";

    const callPayload = {
      phone: targetPhone,
      name: lead.name || "Candidate",
      course_interest: lead.courseInterest || "Commercial Pilot License (CPL)",
      city: lead.city || undefined,
      notes:
        options?.customNotes ||
        `Automated lead qualification call. Course: ${lead.courseInterest || "CPL"}. Candidate: ${lead.name}`,
      call_objective:
        attempt > 1 ? "Follow-up qualification and callback scheduling" : "Lead qualification and counseling booking",
      custom_instructions:
        attempt > 1
          ? `Candidate previously did not answer (attempt ${attempt} of ${this.MAX_CALL_ATTEMPTS}). Warmly re-introduce Captain Navrang from Airborne Aviation.`
          : undefined,
      source: attempt > 1 ? "AI_AUTO_RETRY" : "AI_AUTO_DIALER",
    };

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
          `Voice assistant dispatch failed (${response.status})`;
        throw new Error(errorMsg);
      }

      await prisma.leadActivity.update({
        where: { id: activity.id },
        data: {
          outcome: "IN_PROGRESS",
          metadata: {
            ...(activity.metadata as Record<string, unknown>),
            provider: resData?.provider || "telecmi",
            requestId: resData?.request_id || null,
            greeting: resData?.greeting || null,
          },
        },
      });

      await prisma.lead.update({
        where: { id: lead.id },
        data: { lastActivityAt: new Date() },
      });

      return { status: "dispatched", activityId: activity.id };
    } catch (err: unknown) {
      const error = err as Error;
      await prisma.leadActivity.update({
        where: { id: activity.id },
        data: {
          outcome: "FAILED",
          completedAt: new Date(),
          notes: `Call dispatch failure: ${error.message || String(err)}`,
        },
      });
      return { status: "failed", error: error.message, activityId: activity.id };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Identifies leads that did not pick up an agent call (NO_ANSWER, BUSY, MISSED, etc.),
   * where manual counselors are not currently calling, and triggers an automated retry.
   * Only triggers when there are NO waiting new leads to call on, up to a maximum of 3 total attempts.
   */
  static async processUnansweredRetries(orgId: string): Promise<number> {
    if (!this.isCallingWindowOpen()) return 0;

    let activeCalls = await this.getActiveCallsCount(orgId);
    if (activeCalls >= this.MAX_CONCURRENT_CALLS) return 0;

    const availableSlots = this.MAX_CONCURRENT_CALLS - activeCalls;
    if (availableSlots <= 0) return 0;

    const nonCallable = [
      "WON",
      "LOST",
      "DND",
      "OPTED_OUT",
      "CONVERTED",
      "NOT_INTERESTED",
      "INVALID_NUMBER",
      "JOINED_OTHERS",
      "JOB_SEEKER",
      "TEST_LEAD",
    ];

    const coolOffThreshold = new Date(Date.now() - this.RETRY_COOL_OFF_MS);

    // Query candidate leads with their call activities
    const candidateLeads = await prisma.lead.findMany({
      where: {
        orgId,
        deletedAt: null,
        phone: { not: "" },
        status: { notIn: nonCallable as any },
        activities: {
          some: {
            activityType: "CALL",
          },
        },
      },
      select: {
        id: true,
        name: true,
        phone: true,
        city: true,
        status: true,
        courseInterest: true,
        nextFollowUp: true,
        activities: {
          where: {
            activityType: "CALL",
          },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            outcome: true,
            performedBy: true,
            completedAt: true,
            createdAt: true,
          },
        },
      },
      take: 20,
    });

    let retriesDispatched = 0;

    for (const lead of candidateLeads) {
      if (retriesDispatched >= availableSlots) break;

      const callActivities = lead.activities;
      const totalCalls = callActivities.length;
      const lastCall = callActivities[0];
      if (!lastCall) continue;

      const hasConnectedCall = callActivities.some((c) =>
        ["CONNECTED", "COMPLETED"].includes(c.outcome || "")
      );

      // Verify no human counselor has logged activity recently
      const hasManualIntervention = !!(await prisma.leadActivity.findFirst({
        where: {
          leadId: lead.id,
          orgId,
          performedBy: { not: null },
          createdAt: { gte: coolOffThreshold },
        },
        select: { id: true },
      }));

      const eligibility = this.isEligibleForRetry({
        totalCalls,
        hasConnectedCall,
        lastCallOutcome: lastCall.outcome,
        lastCallCompleted: lastCall.completedAt !== null,
        lastCallCreatedAt: lastCall.createdAt,
        hasManualIntervention,
        nextFollowUp: lead.nextFollowUp,
      });

      if (!eligibility.eligible) {
        continue;
      }

      // Re-verify concurrency limit before dispatching
      const currentActive = await this.getActiveCallsCount(orgId);
      if (currentActive >= this.MAX_CONCURRENT_CALLS) break;

      const targetPhone = this.normalizePhone(lead.phone);
      const attemptNumber = totalCalls + 1;

      const res = await this.dispatchCall(orgId, lead, targetPhone, {
        attemptNumber,
        customNotes: `Automated retry call #${attemptNumber} (previous attempt was ${lastCall.outcome || "unanswered"}). Candidate: ${lead.name}`,
      });

      if (res.status === "dispatched") {
        retriesDispatched++;
      }
    }

    return retriesDispatched;
  }

  /**
   * Drains the auto-call queue when an ongoing call completes or via cron.
   * Priority:
   * 1. Waiting new leads in QUEUED state (strictly highest priority).
   * 2. Unanswered retry candidates (when no new leads remain, max 3 attempts per lead).
   * Dials sequentially while strictly adhering to MAX_CONCURRENT_CALLS (2).
   */
  static async processQueue(orgId: string): Promise<number> {
    if (!this.isCallingWindowOpen()) return 0;

    let activeCalls = await this.getActiveCallsCount(orgId);
    if (activeCalls >= this.MAX_CONCURRENT_CALLS) return 0;

    const availableSlots = this.MAX_CONCURRENT_CALLS - activeCalls;
    if (availableSlots <= 0) return 0;

    // Phase 1: Drain waiting new leads (strictly highest priority)
    const queuedActivities = await prisma.leadActivity.findMany({
      where: {
        orgId,
        activityType: "CALL",
        outcome: "QUEUED",
        completedAt: null,
      },
      orderBy: { createdAt: "asc" }, // FIFO
      take: availableSlots,
      include: {
        lead: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            city: true,
            status: true,
            source: true,
            courseInterest: true,
            deletedAt: true,
          },
        },
      },
    });

    let dispatchedCount = 0;

    for (const act of queuedActivities) {
      if (!act.lead || act.lead.deletedAt || !act.lead.phone) {
        await prisma.leadActivity.update({
          where: { id: act.id },
          data: { outcome: "CANCELLED", completedAt: new Date(), notes: "Lead deleted or missing phone." },
        });
        continue;
      }

      // Re-verify concurrency before each dispatch
      const currentActive = await this.getActiveCallsCount(orgId);
      if (currentActive >= this.MAX_CONCURRENT_CALLS) break;

      const targetPhone = this.normalizePhone(act.lead.phone);

      // Transition queued activity to in-progress
      await prisma.leadActivity.update({
        where: { id: act.id },
        data: {
          outcome: "IN_PROGRESS",
          title: "AI Voice Agent Call In Progress",
          notes: `Queued outbound AI voice call dispatched to ${targetPhone}.`,
        },
      });

      const res = await this.dispatchCall(orgId, act.lead, targetPhone);
      if (res.status === "dispatched") {
        dispatchedCount++;
      }
    }

    // Phase 2: If there are NO new leads waiting to be called, check for unanswered retry candidates
    // Condition: activeCalls < MAX_CONCURRENT_CALLS and zero queued new leads remaining
    const remainingQueuedCount = await prisma.leadActivity.count({
      where: {
        orgId,
        activityType: "CALL",
        outcome: "QUEUED",
        completedAt: null,
      },
    });

    if (remainingQueuedCount === 0) {
      const retriesDispatched = await this.processUnansweredRetries(orgId);
      dispatchedCount += retriesDispatched;
    }

    return dispatchedCount;
  }

  /**
   * Drains queues across all organizations in the workspace.
   */
  static async processAllQueues(): Promise<{ orgId: string; dispatched: number }[]> {
    try {
      const orgs = await prisma.organization.findMany({
        select: { id: true },
      });
      const results: { orgId: string; dispatched: number }[] = [];
      for (const org of orgs) {
        const count = await this.processQueue(org.id);
        if (count > 0) {
          results.push({ orgId: org.id, dispatched: count });
        }
      }
      return results;
    } catch (e) {
      console.error("[AutoCallingService.processAllQueues] Error:", e);
      return [];
    }
  }
}
