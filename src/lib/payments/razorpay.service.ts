import { prisma } from "@/lib/db/client";

export interface CreatePaymentLinkInput {
  amount: number; // in INR
  description: string;
  customer: {
    name: string;
    email?: string | null;
    phone: string;
  };
  leadId?: string | null;
  admissionId?: string | null;
  notes?: Record<string, string>;
}

export interface PaymentLinkResult {
  id: string;
  short_url: string;
  status: string;
  amount: number; // in paise
  mock?: boolean;
}

export class RazorpayService {
  private static getKeyId(): string | undefined {
    return process.env.RAZORPAY_KEY_ID;
  }

  private static getKeySecret(): string | undefined {
    return process.env.RAZORPAY_KEY_SECRET;
  }

  static async createPaymentLink(
    orgId: string,
    userId: string,
    input: CreatePaymentLinkInput,
  ): Promise<PaymentLinkResult> {
    const keyId = this.getKeyId();
    const keySecret = this.getKeySecret();
    const amountInPaise = Math.round(input.amount * 100);

    let result: PaymentLinkResult;

    if (!keyId || !keySecret) {
      console.warn("[Razorpay] Keys not configured, generating mock payment link.");
      result = {
        id: `plink_mock_${Date.now()}`,
        short_url: `https://pages.razorpay.com/pl_mock_${Date.now()}`,
        status: "created",
        amount: amountInPaise,
        mock: true,
      };
    } else {
      const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
      const res = await fetch("https://api.razorpay.com/v1/payment_links/", {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: amountInPaise,
          currency: "INR",
          accept_partial: false,
          description: input.description,
          customer: {
            name: input.customer.name,
            ...(input.customer.email ? { email: input.customer.email } : {}),
            contact: input.customer.phone.replace(/\D/g, "").slice(-10),
          },
          notify: {
            sms: true,
            email: Boolean(input.customer.email),
          },
          reminder_enable: true,
          notes: {
            orgId,
            ...(input.leadId ? { leadId: input.leadId } : {}),
            ...(input.admissionId ? { admissionId: input.admissionId } : {}),
            ...(input.notes ?? {}),
          },
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.error("[Razorpay] Failed to create payment link:", errorText);
        throw new Error(`Razorpay API error (${res.status}): ${errorText}`);
      }

      const data = (await res.json()) as { id: string; short_url: string; status: string; amount: number };
      result = {
        id: data.id,
        short_url: data.short_url,
        status: data.status,
        amount: data.amount,
      };
    }

    // Persist timeline activity on lead if available
    if (input.leadId) {
      await prisma.leadActivity.create({
        data: {
          orgId,
          leadId: input.leadId,
          activityType: "TASK",
          title: `Razorpay Payment Link: ₹${input.amount.toLocaleString("en-IN")}`,
          notes: `Generated payment link for ${input.description}. Link: ${result.short_url}`,
          performedBy: userId,
          metadata: {
            paymentLinkId: result.id,
            shortUrl: result.short_url,
            amount: input.amount,
            mock: Boolean(result.mock),
          },
        },
      });
    }

    return result;
  }
}
