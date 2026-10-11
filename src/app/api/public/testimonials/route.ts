import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { checkMaintenance } from "@/lib/middleware/maintenance";
import { handleError } from "@/lib/utils/response";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/utils/rate-limit";
import { resolveIntakeRateLimitIp } from "@/lib/utils/client-ip";
import { safeEqualString } from "@/lib/utils/crypto";
import { isHoneypotTripped } from "@/lib/utils/honeypot";
import { publicTestimonialSchema } from "@/lib/validations/public-testimonial.schema";
import { TestimonialService } from "@/lib/services/testimonial.service";

// POST /api/public/testimonials — server-to-server from the marketing site's
// /api/testimonial proxy (holds PUBLIC_INTAKE_KEY). Always creates PENDING.
export async function POST(req: NextRequest) {
  try {
    await checkMaintenance();
    const apiKey = req.headers.get("x-intake-key");
    if (!process.env.PUBLIC_INTAKE_KEY || !safeEqualString(apiKey, process.env.PUBLIC_INTAKE_KEY)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = resolveIntakeRateLimitIp(req);
    const decision = await consumeRateLimit(`testimonial:${ip}`, 3, 60 * 60_000);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "Too many submissions. Please try again later." },
        { status: 429, headers: rateLimitHeaders(decision) },
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
    }
    if (isHoneypotTripped(body)) {
      console.warn(JSON.stringify({ event: "testimonial_honeypot_triggered", timestamp: new Date().toISOString() }));
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const parsed = publicTestimonialSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        { error: `${first?.path[0] ?? "body"}: ${first?.message ?? "Invalid request body"}` },
        { status: 400 },
      );
    }

    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: { id: true },
    });
    if (!org) return NextResponse.json({ error: "Academy configuration missing" }, { status: 500 });

    const t = await TestimonialService.submitPublic(org.id, parsed.data, { ipAddress: ip });
    return NextResponse.json({ success: true, data: { id: t.id, status: t.status } }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    await checkMaintenance();
    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: { id: true },
    });

    if (!org) return NextResponse.json({ data: [] });

    const url = new URL(req.url);
    const requested = parseInt(url.searchParams.get("limit") ?? "6", 10);
    const limit = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 20) : 6;

    const testimonials = await prisma.testimonial.findMany({
      where: { orgId: org.id, status: "APPROVED" },
      orderBy: [{ isFeatured: "desc" }, { order: "asc" }, { createdAt: "desc" }],
      take: limit,
      select: {
        id: true,
        authorName: true,
        authorTitle: true,
        content: true,
        rating: true,
        batchYear: true,
        isFeatured: true,
        order: true,
        metadata: true,
        avatarId: true,
      },
    });

    const avatarIds = testimonials.map((t) => t.avatarId).filter((id): id is string => !!id);
    const avatars = avatarIds.length
      ? await prisma.mediaAsset.findMany({
          where: { orgId: org.id, id: { in: avatarIds } },
          select: { id: true, fileUrl: true },
        })
      : [];
    const avatarUrl = new Map(avatars.map((a) => [a.id, a.fileUrl]));

    return NextResponse.json({
      data: testimonials.map(({ avatarId, ...t }) => ({
        ...t,
        avatarUrl: avatarId ? avatarUrl.get(avatarId) ?? null : null,
      })),
    });
  } catch (err) {
    return handleError(err);
  }
}
