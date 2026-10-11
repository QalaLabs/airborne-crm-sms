import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { emitLeadCreated } from "@/lib/automation/emit-lead-created";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { env } from "@/lib/env";
import {
  verifyMetaSignature,
  hubChallengeMatches,
  defaultFetchGraph,
  processMetaLeadGenBatch,
  type MetaWebhookPayload,
} from "@/lib/webhooks/meta.service";

const ORG_SLUG = process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation";

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Meta/Facebook Lead Ads webhook.
 * GET  → subscription verification (echo hub.challenge).
 * POST → X-Hub-Signature-256 verified, then leadgen ingestion in
 *      lib/webhooks/meta.service.ts (dedup by leadgen_id, Graph fetch,
 *      lead.created emission). Fail-closed: without the app secret we return
 *      403 NOT_CONFIGURED and Meta keeps retrying until it is fixed.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (challenge != null && hubChallengeMatches(mode, token, env.FACEBOOK_WEBHOOK_VERIFY_TOKEN)) {
    return new NextResponse(challenge, { headers: { "content-type": "text/plain" } });
  }
  return json({ error: "verification_failed" }, 403);
}

export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return json({ received: false, error: "method_not_allowed" }, 405);
  }

  const raw = await req.text();
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ received: false, error: "invalid_json" }, 400);
  }

  // ── Signature verification (fail-closed) ──────────────────────────────────
  const signature = req.headers.get("x-hub-signature-256");
  if (!verifyMetaSignature(env.FACEBOOK_APP_SECRET, signature, raw)) {
    console.warn("[Facebook Webhook] Invalid signature");
    return json({ received: false, error: "invalid_signature" }, 401);
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ received: false, error: "invalid_json" }, 400);
  }
  const payload = body as MetaWebhookPayload;

  // ── Locate org ─────────────────────────────────────────────────────────────
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, settings: true },
  });
  if (!org) {
    console.error("[Facebook Webhook] Org not found", { slug: ORG_SLUG });
    return json({ received: false, error: "org_not_found" }, 500);
  }

  try {
    const { result } = await processMetaLeadGenBatch({
      orgId: org.id,
      orgSettings: org.settings,
      appSecret: env.FACEBOOK_APP_SECRET,
      pageAccessToken: env.FACEBOOK_PAGE_ACCESS_TOKEN,
      payload,
      deps: {
        db: prisma,
        emitLeadCreated,
        writeAudit: (input) => AuditService.write(input),
        writeActivityFeed: (input) => ActivityFeedService.write(input),
        fetchGraph: defaultFetchGraph,
        log: (line) => console.log(JSON.stringify(line)),
        now: () => new Date(),
      },
    });

    switch (result.kind) {
      case "bad_request":
        return json({ received: false, error: result.reason }, 400);
      case "not_configured":
        return json({ received: false, error: "not_configured" }, 403);
      case "provider_error":
        // Non-2xx → Meta retries the notification later (transient failure).
        return json({ received: false, error: result.reason }, 503);
      case "created":
        return json(
          { received: true, ...(result.test ? { meta: { test: true, persisted: true } } : {}) },
          200,
        );
      case "replayed":
        return json({ received: true, meta: { replayed: true } }, 200);
      case "duplicate":
        return json({ received: true, meta: { duplicate: true } }, 200);
      case "skipped_no_phone":
        return json({ received: true, skipped: "no_phone" }, 200);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[Facebook Webhook] Unhandled", message);
    return json({ received: false, error: "internal" }, 500);
  }
}