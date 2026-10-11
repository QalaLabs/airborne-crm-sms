import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { orgWebhookKey } from "@/lib/webhooks/google-ads.service";
import { IntegrationKeyService } from "@/lib/services/integration-key.service";

const ADMIN_URL =
  process.env.NEXT_PUBLIC_ADMIN_URL ??
  "https://airborne-admin-368523757732.asia-south1.run.app";

const WEBHOOK_URL = `${ADMIN_URL}/api/webhooks/google-ads`;

// ─── GET: return webhook URL + whether any key is configured ────────────────
// A key is "configured" when either the org-settings key (rotated from this
// page, effective immediately) OR the env-var key (Cloud Run / Secret Manager
// bootstrap) exists. The webhook endpoint accepts both.
export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");

    const envKey = (process.env.GOOGLE_ADS_WEBHOOK_SECRET ?? "").trim();
    const org = await prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { settings: true },
    });
    const orgKey = org ? orgWebhookKey(org.settings) : null;

    const legacyKeyConfigured = Boolean(envKey || orgKey);
    const keyConfigured =
      legacyKeyConfigured || (await IntegrationKeyService.hasActiveKey(ctx.orgId, "GOOGLE_ADS"));

    return ok({ webhookUrl: WEBHOOK_URL, keyConfigured, legacyKeyConfigured });
  } catch (err) {
    return handleError(err);
  }
}

// ─── POST: generate (or regenerate) a new webhook secret ────────────────────
// The new key is persisted to org settings and becomes valid immediately at
// the webhook endpoint. The env-var key (Secret Manager) remains valid as an
// additional accepted key until it is removed from the Cloud Run service env.
export async function POST() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "write", "leads");

    // Cryptographically random UUID v4 (122 bits of entropy).
    const newKey = crypto.randomUUID();

    // Merge into existing org settings (never clobber unrelated settings).
    const existingOrg = await prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { settings: true },
    });
    const existingSettings =
      (existingOrg?.settings as Record<string, unknown> | null) ?? {};

    await prisma.organization.update({
      where: { id: ctx.orgId },
      data: {
        settings: {
          ...existingSettings,
          googleAdsWebhookSecret: newKey,
        },
      },
    });

    // Return the full key exactly once — caller must copy it immediately.
    const keyPreview = `${newKey.slice(0, 8)}...${newKey.slice(-4)}`;

    console.log(JSON.stringify({
      event: "google_ads_webhook_key_rotated",
      orgId: ctx.orgId,
      actor: ctx.user.email ?? ctx.user.id,
      timestamp: new Date().toISOString(),
    }));

    return ok({
      webhookUrl: WEBHOOK_URL,
      key: newKey,
      keyPreview,
      keyConfigured: true,
    });
  } catch (err) {
    return handleError(err);
  }
}