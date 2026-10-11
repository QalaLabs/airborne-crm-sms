import { prisma } from "@/lib/db/client";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";
import { orgWebhookKey } from "@/lib/webhooks/google-ads.service";
import { IntegrationKeyService } from "@/lib/services/integration-key.service";
import { checkStorageHealth, storageBucketName } from "@/lib/storage/gcs";

const ADMIN_URL =
  process.env.NEXT_PUBLIC_ADMIN_URL ??
  "https://airborne-admin-368523757732.asia-south1.run.app";

const FACEBOOK_ENV = [
  "NEXT_PUBLIC_FACEBOOK_APP_ID",
  "FACEBOOK_APP_SECRET",
  "FACEBOOK_WEBHOOK_VERIFY_TOKEN",
  "FACEBOOK_PAGE_ACCESS_TOKEN",
] as const;

function configured(...vals: (string | undefined)[]): boolean {
  return vals.every((v) => Boolean(v && v.trim().length > 0));
}

export async function GET() {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "leads");

    // Google Ads is connected when the env-var secret, the legacy org-settings
    // key, or at least one active per-form key exists. All are accepted by
    // /api/webhooks/google-ads.
    const org = await prisma.organization.findUnique({
      where: { id: ctx.orgId },
      select: { settings: true },
    });
    const envKey = (process.env.GOOGLE_ADS_WEBHOOK_SECRET ?? "").trim();
    const orgKey = org ? orgWebhookKey(org.settings) : null;

    const [mediaCount, docCount, activeFormKey, storage] = await Promise.all([
      prisma.mediaAsset.count({ where: { orgId: ctx.orgId, isActive: true } }),
      prisma.document.count({ where: { orgId: ctx.orgId } }),
      IntegrationKeyService.hasActiveKey(ctx.orgId, "GOOGLE_ADS"),
      checkStorageHealth(),
    ]);
    const googleAdsConfigured = Boolean(envKey || orgKey) || activeFormKey;

    const facebookMissing = FACEBOOK_ENV.filter((name) => !configured(process.env[name]));
    const facebookConfigured = facebookMissing.length === 0;
    const bucket = storageBucketName();

    return ok({
      crm: {
        leads: {
          status: "connected",
          provider: "Built-in CRM (PostgreSQL)",
          note: "Leads, activities, templates and logs are stored natively in the Airborne database.",
        },
      },
      facebook: {
        status: facebookConfigured ? "configured_not_verified" : "not_configured",
        provider: "Meta for Business",
        required: [...FACEBOOK_ENV],
        missing: facebookMissing,
        note: facebookConfigured
          ? "Credentials present. Leads arrive once the Page is subscribed to the leadgen webhook in Meta."
          : `Webhook endpoint is ready. Set ${facebookMissing.join(", ")} on the admin service to start receiving Facebook leads.`,
        webhookUrl: `${ADMIN_URL}/api/webhooks/facebook`,
      },
      googleAds: {
        status: googleAdsConfigured ? "connected" : "not_configured",
        provider: "Google Ads",
        required: ["Webhook key"],
        note: googleAdsConfigured
          ? "Google Ads Lead Form webhook is active. Leads are ingested automatically."
          : "Generate a webhook key from the Integrations page to connect Google Ads Lead Forms.",
        webhookUrl: `${ADMIN_URL}/api/webhooks/google-ads`,
      },
      frappe: {
        status: "removed",
        provider: "Frappe ERP",
        note: "The Frappe bridge was replaced by the native CRM. Inbound lead sync from Frappe is not enabled.",
      },
      media: {
        status: storage.ok ? "connected" : "error",
        provider: "Google Cloud Storage",
        bucket,
        assets: mediaCount,
        note: storage.ok
          ? `Media uploads are live (bucket ${bucket}).`
          : `Bucket ${bucket} is not reachable from the admin service: ${storage.error ?? "unknown error"}.`,
      },
      documents: {
        status: storage.ok ? "connected" : "error",
        provider: "Google Cloud Storage",
        assets: docCount,
      },
      automation: {
        status: configured(process.env.CRON_SECRET) ? "connected" : "not_configured",
        provider: "PostgreSQL + Cloud Scheduler",
        note: configured(process.env.CRON_SECRET)
          ? "Database-backed workflow engine active. Cron dispatches pending events and due runs."
          : "Set CRON_SECRET and configure Cloud Scheduler → /api/cron/automation.",
      },
      payments: {
        status: "not_configured",
        provider: "Payment gateway",
        required: ["STRIPE_SECRET_KEY"],
        note: "No payment provider credentials are set; payments are not processed.",
      },
      summary: {
        connected: [
          ...(["crm"] as const),
          ...(storage.ok ? (["media", "documents"] as const) : []),
          ...(googleAdsConfigured ? (["googleAds"] as const) : []),
          ...(configured(process.env.CRON_SECRET) ? (["automation"] as const) : []),
        ],
        notConfigured: Object.entries({
          facebook: !facebookConfigured,
          googleAds: !googleAdsConfigured,
          media: !storage.ok,
          documents: !storage.ok,
          payments: true,
        })
          .filter(([, missing]) => missing)
          .map(([name]) => name),
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
