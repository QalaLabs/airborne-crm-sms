import { type NextRequest } from "next/server";
import { TestimonialService } from "@/lib/services/testimonial.service";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, created, handleError } from "@/lib/utils/response";
import { createTestimonialSchema, testimonialFiltersSchema } from "@/lib/validations/testimonial.schema";
import { syncWebsiteContent } from "@/lib/website/revalidate";

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "testimonials");
    const params = Object.fromEntries(req.nextUrl.searchParams);
    const filters = testimonialFiltersSchema.parse(params);
    return ok(await TestimonialService.list(ctx, filters));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "testimonials");
    const body = await req.json() as unknown;
    const input = createTestimonialSchema.parse(body);
    const testimonial = await TestimonialService.create(ctx, input);
    return created({ ...testimonial, websiteSync: await syncWebsiteContent("testimonial", ctx.requestId) });
  } catch (err) {
    return handleError(err);
  }
}
