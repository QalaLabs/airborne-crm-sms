import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { consumeRateLimit, rateLimitHeaders } from "@/lib/utils/rate-limit";
import { resolveIntakeRateLimitIp } from "@/lib/utils/client-ip";
import { safeEqualString } from "@/lib/utils/crypto";
import { isHoneypotTripped } from "@/lib/utils/honeypot";
import { publicJobApplicationSchema } from "@/lib/validations/public-job-application.schema";
import { JobApplicationService } from "@/lib/services/job.service";
import { checkMaintenance } from "@/lib/middleware/maintenance";
import { handleError } from "@/lib/utils/response";

// POST /api/public/job-applications — called server-to-server by the marketing
// site's /api/job-application proxy, which holds PUBLIC_INTAKE_KEY.
export async function POST(req: NextRequest) {
  try {
    await checkMaintenance();
    const apiKey = req.headers.get("x-intake-key");
    if (!process.env.PUBLIC_INTAKE_KEY || !safeEqualString(apiKey, process.env.PUBLIC_INTAKE_KEY)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const ip = resolveIntakeRateLimitIp(req);
    const decision = await consumeRateLimit(`job-application:${ip}`, 5, 10 * 60_000);
    if (!decision.allowed) {
      return NextResponse.json(
        { error: "Too many applications. Please try again later." },
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
      console.warn(JSON.stringify({ event: "job_application_honeypot_triggered", timestamp: new Date().toISOString() }));
      return NextResponse.json({ success: true }, { status: 200 });
    }

    const parsed = publicJobApplicationSchema.safeParse(body);
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

    const application = await JobApplicationService.submitPublic(org.id, parsed.data, { ipAddress: ip });
    return NextResponse.json({ success: true, data: { id: application.id, status: application.status } }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
