import { TestimonialService } from "@/lib/services/testimonial.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "testimonials");
    const count = await TestimonialService.getPendingCount(ctx);
    return ok({ count });
  } catch (err) {
    return handleError(err);
  }
}
