import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { NotFoundError } from "@/lib/utils/errors";

export interface StudentTimelineEntry {
  id: string;
  kind: "activity" | "notification" | "automation";
  at: string;
  title: string;
  detail?: string | null;
  status?: string | null;
  channel?: string | null;
  actorName?: string | null;
  activityType?: string | null;
}

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const ctx = await getRequestContext();
    const { id: studentId } = await params;
    guard(ctx.user, "read", "students");

    const student = await prisma.student.findFirst({
      where: { id: studentId, orgId: ctx.orgId, deletedAt: null },
      select: {
        id: true,
        leadId: true,
        admissions: { select: { id: true } },
      },
    });

    if (!student) {
      throw new NotFoundError("Student", studentId);
    }

    const admissionIds = student.admissions.map((a) => a.id);

    // 1. Fetch Lead Activities (if student originated from a lead)
    const leadActivitiesPromise = student.leadId
      ? prisma.leadActivity.findMany({
          where: { orgId: ctx.orgId, leadId: student.leadId },
          orderBy: { createdAt: "desc" },
          take: 50,
          select: {
            id: true,
            activityType: true,
            title: true,
            notes: true,
            createdAt: true,
            performer: { select: { name: true } },
          },
        })
      : Promise.resolve([]);

    // 2. Fetch Admission Stage Logs
    const stageLogsPromise = admissionIds.length > 0
      ? prisma.admissionStageLog.findMany({
          where: { orgId: ctx.orgId, admissionId: { in: admissionIds } },
          orderBy: { changedAt: "desc" },
          take: 50,
          select: {
            id: true,
            fromStage: true,
            toStage: true,
            notes: true,
            changedAt: true,
            actor: { select: { name: true } },
          },
        })
      : Promise.resolve([]);

    // 3. Fetch Payments
    const paymentsPromise = prisma.paymentTransaction.findMany({
      where: {
        orgId: ctx.orgId,
        OR: [
          { studentId },
          ...(admissionIds.length > 0 ? [{ admissionId: { in: admissionIds } }] : []),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        amount: true,
        method: true,
        status: true,
        receiptNo: true,
        feeType: true,
        createdAt: true,
      },
    });

    // 4. Fetch Notification Logs (email/SMS/WhatsApp dispatched to this student or lead)
    const notificationsPromise = prisma.notificationLog.findMany({
      where: {
        orgId: ctx.orgId,
        OR: [
          { entityType: "student", entityId: studentId },
          ...(student.leadId ? [{ entityType: "lead", entityId: student.leadId }] : []),
          ...(admissionIds.map((aId) => ({ entityType: "admission", entityId: aId }))),
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        channel: true,
        subject: true,
        body: true,
        status: true,
        event: true,
        createdAt: true,
      },
    });

    const [leadActivities, stageLogs, payments, notifications] = await Promise.all([
      leadActivitiesPromise,
      stageLogsPromise,
      paymentsPromise,
      notificationsPromise,
    ]);

    const items: StudentTimelineEntry[] = [];

    // Map lead activities
    for (const a of leadActivities) {
      items.push({
        id: `act-${a.id}`,
        kind: "activity",
        at: a.createdAt.toISOString(),
        title: a.title || a.activityType.replace(/_/g, " "),
        detail: a.notes,
        activityType: a.activityType,
        actorName: a.performer?.name,
      });
    }

    // Map stage logs
    for (const s of stageLogs) {
      items.push({
        id: `stage-${s.id}`,
        kind: "activity",
        at: s.changedAt.toISOString(),
        title: `Admission: ${s.fromStage ? `${s.fromStage} → ` : ""}${s.toStage}`,
        detail: s.notes || `Moved to ${s.toStage.replace(/_/g, " ")}`,
        activityType: "STATUS_CHANGE",
        actorName: s.actor?.name,
      });
    }

    // Map payments
    for (const p of payments) {
      items.push({
        id: `pay-${p.id}`,
        kind: "activity",
        at: p.createdAt.toISOString(),
        title: `Payment: ₹${Number(p.amount).toLocaleString("en-IN")}`,
        detail: `Receipt ${p.receiptNo ?? "—"} · ${p.method} (${p.feeType ?? "fee"})`,
        activityType: "PAYMENT",
        status: p.status,
      });
    }

    // Map notifications
    for (const n of notifications) {
      items.push({
        id: `notif-${n.id}`,
        kind: "notification",
        at: n.createdAt.toISOString(),
        title: n.subject || n.event || "Message Dispatched",
        detail: n.body,
        channel: n.channel,
        status: n.status,
      });
    }

    // Chronological sort: newest first
    items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

    return ok(items);
  } catch (err) {
    return handleError(err);
  }
}
