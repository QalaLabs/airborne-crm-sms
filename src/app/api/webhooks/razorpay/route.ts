import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    // Verify signature if secret configured
    if (secret && signature) {
      const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      if (expected !== signature) {
        console.warn("[Razorpay Webhook] Invalid signature rejected.");
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
      }
    }

    const payload = JSON.parse(rawBody);
    const event = payload.event as string;

    if (event !== "payment.captured" && event !== "payment_link.paid" && event !== "order.paid") {
      return NextResponse.json({ status: "ignored", event }, { status: 200 });
    }

    const paymentEntity = payload.payload?.payment?.entity ?? payload.payload?.payment_link?.entity;
    if (!paymentEntity) {
      return NextResponse.json({ error: "Missing payment entity in payload" }, { status: 400 });
    }

    const paymentId = paymentEntity.id as string;
    const amountInPaise = Number(paymentEntity.amount ?? 0);
    const amount = amountInPaise / 100;
    const method = String(paymentEntity.method || "ONLINE").toUpperCase();
    const notes = (paymentEntity.notes ?? {}) as Record<string, string>;

    const admissionId = notes.admissionId || null;
    const leadId = notes.leadId || null;
    const orgId = notes.orgId || process.env.PUBLIC_ORG_ID;

    // Idempotency check: avoid duplicate ledger entries
    const existingTx = await prisma.paymentTransaction.findFirst({
      where: { referenceNo: paymentId },
    });

    if (existingTx) {
      return NextResponse.json({ status: "already_processed", id: existingTx.id }, { status: 200 });
    }

    // Resolve target Org
    let resolvedOrgId = orgId;
    if (!resolvedOrgId && admissionId) {
      const adm = await prisma.admission.findUnique({ where: { id: admissionId }, select: { orgId: true } });
      resolvedOrgId = adm?.orgId;
    }
    if (!resolvedOrgId && leadId) {
      const ld = await prisma.lead.findUnique({ where: { id: leadId }, select: { orgId: true } });
      resolvedOrgId = ld?.orgId;
    }
    if (!resolvedOrgId) {
      const defaultOrg = await prisma.organization.findFirst({ select: { id: true } });
      resolvedOrgId = defaultOrg?.id;
    }

    if (!resolvedOrgId) {
      return NextResponse.json({ error: "Organization could not be resolved" }, { status: 400 });
    }

    const receiptNo = `REC-RZP-${Date.now().toString().slice(-6)}`;

    await prisma.$transaction(async (tx) => {
      // 1. Create PaymentTransaction if linked to an admission
      if (admissionId) {
        await tx.paymentTransaction.create({
          data: {
            orgId: resolvedOrgId,
            admissionId,
            amount,
            currency: "INR",
            method: method as any,
            status: "COMPLETED",
            referenceNo: paymentId,
            receiptNo,
            feeType: "tuition",
            description: `Razorpay Online Payment (${event}). Payment ID: ${paymentId}`,
            paidAt: new Date(),
          },
        });
      }

      // 2. Update admission balances if linked
      if (admissionId) {
        const admission = await tx.admission.findUnique({
          where: { id: admissionId },
          select: { id: true, feePaid: true, feeBalance: true },
        });

        if (admission) {
          const currentPaid = Number(admission.feePaid ?? 0);
          const currentBalance = Number(admission.feeBalance ?? 0);
          const newPaid = currentPaid + amount;
          const newBalance = Math.max(0, currentBalance - amount);

          await tx.admission.update({
            where: { id: admissionId },
            data: {
              feePaid: newPaid,
              feeBalance: newBalance,
              stage: newBalance <= 0 ? "FEE_PAYMENT" : undefined,
            },
          });
        }
      }

      // 3. Persist timeline activity on lead if available
      if (leadId) {
        await tx.leadActivity.create({
          data: {
            orgId: resolvedOrgId,
            leadId,
            activityType: "NOTE",
            title: `Payment Received: ₹${amount.toLocaleString("en-IN")}`,
            notes: `Online transaction confirmed via Razorpay (${method}). Receipt: ${receiptNo}. Payment ID: ${paymentId}`,
            metadata: {
              paymentId,
              amount,
              method,
              receiptNo,
              event,
            },
          },
        });
      }
    });

    void AuditService.write({
      orgId: resolvedOrgId,
      action: "payment.razorpay_webhook_captured",
      entityType: "paymentTransaction",
      entityId: paymentId,
      newValue: { amount, paymentId, receiptNo, admissionId, leadId },
    });

    return NextResponse.json({ status: "success", receiptNo, paymentId }, { status: 200 });
  } catch (err) {
    console.error("[Razorpay Webhook Error]:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
}
