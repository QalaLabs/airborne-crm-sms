import { type NextRequest } from "next/server";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { RazorpayService } from "@/lib/payments/razorpay.service";
import { z } from "zod";

const createPaymentLinkSchema = z.object({
  amount: z.number().positive("Amount must be greater than 0"),
  description: z.string().min(1, "Description is required").max(255),
  customer: z.object({
    name: z.string().min(1, "Customer name is required"),
    email: z.string().email().optional().nullable(),
    phone: z.string().min(10, "Valid 10-digit phone required"),
  }),
  leadId: z.string().uuid().optional().nullable(),
  admissionId: z.string().uuid().optional().nullable(),
  notes: z.record(z.string()).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "payments");

    const body = (await req.json()) as unknown;
    const input = createPaymentLinkSchema.parse(body);

    const link = await RazorpayService.createPaymentLink(ctx.orgId, ctx.user.id, input);
    return ok(link);
  } catch (err) {
    return handleError(err);
  }
}
