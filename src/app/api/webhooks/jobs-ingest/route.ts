import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { IntegrationKeyService } from "@/lib/services/integration-key.service";
import { ingestJobs } from "@/lib/services/job-ingestion.service";
import { enforceRateLimit } from "@/lib/utils/rate-limit";
import { resolveIntakeRateLimitIp } from "@/lib/utils/client-ip";
import { isAppError } from "@/lib/utils/errors";

const ORG_SLUG = process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation";
const MAX_BODY_BYTES = 2_000_000;

function json(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status });
}

function presentedKey(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim();
  return bearer || req.headers.get("x-api-key")?.trim() || null;
}

/**
 * Push endpoint for an external job scraper/feed:
 *   POST /api/webhooks/jobs-ingest
 *   Authorization: Bearer <Jobs feed API key>   (or x-api-key)
 *   { "source": "my-scraper", "jobs": [ { externalId, title, company, ... } ] }
 * Jobs are created as DRAFT; re-sending the same externalId is a no-op.
 */
export async function POST(req: NextRequest) {
  const ip = resolveIntakeRateLimitIp(req);
  const limited = await enforceRateLimit({ key: `jobs-ingest:ip:${ip}`, limit: 30, windowMs: 60_000 });
  if (!limited.ok) return limited.response;

  const length = Number(req.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return json({ success: false, error: "payload_too_large" }, 413);

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ success: false, error: "payload_too_large" }, 413);
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ success: false, error: "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ success: false, error: "invalid_json" }, 400);
  }

  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG }, select: { id: true } });
  if (!org) return json({ success: false, error: "org_not_found" }, 500);

  const key = await IntegrationKeyService.authenticate(org.id, "JOBS_FEED", presentedKey(req));
  if (!key) return json({ success: false, error: "invalid_key" }, 401);

  const perKey = await enforceRateLimit({ key: `jobs-ingest:key:${key.id}`, limit: 20, windowMs: 60_000 });
  if (!perKey.ok) return perKey.response;

  const { source, jobs } = body as { source?: unknown; jobs?: unknown };
  try {
    const report = await ingestJobs(
      { orgId: org.id, userId: key.createdBy, userName: `API key: ${key.name}`, via: "push", keyId: key.id, ipAddress: ip },
      typeof source === "string" ? source : "",
      { jobs },
    );
    return json({ success: true, ...report }, 200);
  } catch (err) {
    if (isAppError(err)) return json({ success: false, error: err.code, message: err.message }, err.statusCode);
    console.error("[JobsIngest] Unhandled", err instanceof Error ? err.message : "unknown error");
    return json({ success: false, error: "internal" }, 500);
  }
}
