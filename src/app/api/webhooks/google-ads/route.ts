import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { emitLeadCreated } from "@/lib/automation/emit-lead-created";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import {
  isGoogleAdsKeyValid,
  orgWebhookKey,
  processGoogleAdsLead,
  type GoogleAdsWebhookPayload,
} from "@/lib/webhooks/google-ads.service";
import { IntegrationKeyService } from "@/lib/services/integration-key.service";

const ORG_SLUG = process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation";

function json(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

// Google Ads → Lead Form → "Other data integrations" webhook.
// Everything after auth lives in lib/webhooks/google-ads.service.ts so the
// whole contract (mapping, idempotency, retries, test data) is testable.
// HTTP contract per Google docs: 200 success, 4XX client error (no retry),
// 5XX retryable — Google retries 5XX so transient failures are not lost.
export async function POST(req: NextRequest) {
  if (req.method !== "POST") {
    return json({ received: false, error: "method_not_allowed" }, 405);
  }

  // Malformed JSON is a client error — 4XX, Google will not retry it.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ received: false, error: "invalid_json" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ received: false, error: "invalid_json" }, 400);
  }
  const payload = body as GoogleAdsWebhookPayload;

  // ── Locate org ─────────────────────────────────────────────────────────────
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, settings: true },
  });

  if (!org) {
    console.error("[GoogleAds Webhook] Org not found", { slug: ORG_SLUG });
    // Server misconfiguration — 5XX so Google retries and the issue surfaces.
    return json({ received: false, error: "org_not_found" }, 500);
  }

  // ── Authentication: per-form DB keys, the org-settings key, or the env key ─
  const envKey = (process.env.GOOGLE_ADS_WEBHOOK_SECRET ?? "").trim();
  const orgKey = orgWebhookKey(org.settings);

  const legacyValid = isGoogleAdsKeyValid(payload.google_key, orgKey, envKey);
  const valid =
    legacyValid || (await IntegrationKeyService.verify(org.id, "GOOGLE_ADS", payload.google_key));

  if (!valid && !envKey && !orgKey && !(await IntegrationKeyService.hasActiveKey(org.id, "GOOGLE_ADS"))) {
    console.warn("[GoogleAds Webhook] No webhook key configured");
    return json({ received: false, error: "not_configured" }, 403);
  }

  if (!valid) {
    console.warn("[GoogleAds Webhook] Invalid google_key", {
      googleAdsLeadId: payload.lead_id,
    });
    return json({ received: false, error: "invalid_key" }, 403);
  }

  // ── Process (mapping, dedup, create, audit, event) ─────────────────────────
  try {
    const result = await processGoogleAdsLead({
      orgId: org.id,
      orgSettings: org.settings,
      payload,
      deps: {
        db: prisma,
        emitLeadCreated,
        writeAudit: (input) => AuditService.write(input),
        writeActivityFeed: (input) => ActivityFeedService.write(input),
        log: (line) => console.log(JSON.stringify(line)),
        now: () => new Date(),
      },
    });

    switch (result.kind) {
      case "bad_request":
        return json({ received: false, error: result.reason }, 400);
      case "created":
        return json(
          {
            received: true,
            ...(result.test ? { meta: { test: true, persisted: true } } : {}),
          },
          200,
        );
      case "replayed":
        return json({ received: true, meta: { replayed: true } }, 200);
      case "duplicate":
        return json({ received: true, meta: { duplicate: true } }, 200);
      case "skipped_no_phone":
        return json({ received: true, skipped: "no_phone" }, 200);
      case "skipped_intake_closed":
        return json({ received: true, skipped: "intake_closed" }, 200);
    }
  } catch (err) {
    // No PII / secrets in the log line — just the error class.
    const message = err instanceof Error ? err.message : "unknown error";
    console.error("[GoogleAds Webhook] Unhandled", message);
    // 5XX is retryable — a transient DB failure must not silently lose a lead.
    return json({ received: false, error: "internal" }, 500);
  }
}