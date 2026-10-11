import { prisma } from "@/lib/db/client";
import { NotificationService } from "@/lib/services/notification.service";
import { RUN_STATUS } from "@/lib/workflow/types";
import type { AppEvent } from "@/types";

type EventData = Record<string, unknown> & { orgId?: string };

async function handleLeadCreated(event: AppEvent): Promise<void> {
  const d = event.data as EventData & { leadId?: string; leadName?: string };
  const leadId = typeof d.leadId === "string" ? d.leadId : undefined;
  if (!leadId) return;

  const alreadyScored = await prisma.leadScoreHistory.findFirst({
    where: { leadId, orgId: event.orgId, reason: "Initial score on creation" },
    select: { id: true },
  });
  if (!alreadyScored) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, orgId: event.orgId },
      select: { email: true, city: true, courseInterest: true, source: true, utmCampaign: true },
    });
    if (lead) {
      let score = 0;
      if (lead.email) score += 20;
      if (lead.city) score += 10;
      if (lead.courseInterest) score += 30;
      if (["GOOGLE_ADS", "FACEBOOK_ADS", "BROCHURE_DOWNLOAD", "COURSE_PAGE"].includes(lead.source)) score += 25;
      if (lead.utmCampaign) score += 15;
      score = Math.min(score, 100);

      await prisma.$transaction([
        prisma.lead.updateMany({ where: { id: leadId, orgId: event.orgId }, data: { score } }),
        prisma.leadScoreHistory.create({
          data: { leadId, orgId: event.orgId, score, reason: "Initial score on creation" },
        }),
      ]);

      // WhatsApp nurture is owned by Interakt Advanced (`lead_created` + traits).
      // Do not send a parallel NEW_LEAD template from Airborne.
    }
  }
}

async function handleLeadAssigned(event: AppEvent): Promise<void> {
  const d = event.data as EventData & {
    leadId?: string;
    leadName?: string;
    counselorId?: string;
  };
  if (typeof d.counselorId !== "string" || typeof d.leadId !== "string") return;

  const [counselor, lead] = await Promise.all([
    prisma.user.findFirst({ where: { id: d.counselorId, orgId: event.orgId }, select: { email: true, name: true } }),
    prisma.lead.findFirst({ where: { id: d.leadId, orgId: event.orgId }, select: { phone: true, courseInterest: true } }),
  ]);
  if (!counselor?.email) return;

  await NotificationService.dispatch({
    orgId: event.orgId,
    event: "LEAD_ASSIGNED",
    channel: "EMAIL",
    recipient: counselor.email,
    variables: {
      counselorName: counselor.name,
      leadName: String(d.leadName ?? ""),
      leadPhone: lead?.phone ?? "",
      courseInterest: lead?.courseInterest ?? "",
    },
    entityType: "lead",
    entityId: d.leadId,
  });
}

async function handleAdmissionCreated(event: AppEvent): Promise<void> {
  const d = event.data as EventData & {
    admissionId?: string;
    applicationNo?: string;
    leadId?: string;
  };
  if (typeof d.leadId !== "string" || typeof d.admissionId !== "string") return;

  const lead = await prisma.lead.findFirst({
    where: { id: d.leadId, orgId: event.orgId },
    select: { assignedTo: true, name: true },
  });
  if (!lead?.assignedTo) return;

  const counselor = await prisma.user.findFirst({
    where: { id: lead.assignedTo, orgId: event.orgId },
    select: { email: true, name: true },
  });
  if (!counselor?.email) return;

  await NotificationService.dispatch({
    orgId: event.orgId,
    event: "ADMISSION_STAGE_CHANGED",
    channel: "EMAIL",
    recipient: counselor.email,
    variables: {
      counselorName: counselor.name,
      leadName: lead.name,
      applicationNo: String(d.applicationNo ?? ""),
    },
    entityType: "admission",
    entityId: d.admissionId,
  });
}

async function handlePaymentReceived(event: AppEvent): Promise<void> {
  const d = event.data as EventData & {
    paymentId?: string;
    admissionId?: string;
    studentId?: string;
    amount?: string;
    method?: string;
    receiptNo?: string;
  };
  if (typeof d.paymentId !== "string") return;

  let recipientEmail: string | null = null;
  if (typeof d.studentId === "string") {
    const student = await prisma.student.findFirst({
      where: { id: d.studentId, orgId: event.orgId },
      select: { email: true },
    });
    recipientEmail = student?.email ?? null;
  }
  if (!recipientEmail && typeof d.admissionId === "string") {
    const admission = await prisma.admission.findFirst({
      where: { id: d.admissionId, orgId: event.orgId },
      select: { lead: { select: { email: true } } },
    });
    recipientEmail = admission?.lead?.email ?? null;
  }
  if (!recipientEmail) return;

  await NotificationService.dispatch({
    orgId: event.orgId,
    event: "PAYMENT_RECEIVED",
    channel: "EMAIL",
    recipient: recipientEmail,
    variables: {
      amount: String(d.amount ?? ""),
      method: String(d.method ?? ""),
      receiptNo: String(d.receiptNo ?? ""),
    },
    entityType: "payment",
    entityId: d.paymentId,
  });
}

/** Pause active marketing automations when a customer replies (human handover). */
export async function pauseMarketingRunsOnReply(orgId: string, leadId: string): Promise<number> {
  const now = new Date();
  const result = await prisma.workflowRun.updateMany({
    where: {
      orgId,
      entityType: "lead",
      entityId: leadId,
      status: RUN_STATUS.RUNNING,
    },
    data: {
      status: RUN_STATUS.PAUSED,
      pausedAt: now,
    },
  });
  return result.count;
}

const SIDE_EFFECT_HANDLERS: Record<string, (event: AppEvent) => Promise<void>> = {
  "lead/created": handleLeadCreated,
  "lead.created": handleLeadCreated,
  "lead/assigned": handleLeadAssigned,
  "lead.assigned": handleLeadAssigned,
  "admission/created": handleAdmissionCreated,
  "payment/received": handlePaymentReceived,
};

export async function runEventSideEffects(event: AppEvent): Promise<void> {
  if (event.name === "whatsapp.replied") {
    const leadId = event.data.leadId;
    if (typeof leadId === "string") {
      await pauseMarketingRunsOnReply(event.orgId, leadId);
    }
  }

  const handler = SIDE_EFFECT_HANDLERS[event.name];
  if (handler) {
    await handler(event);
  }
}
