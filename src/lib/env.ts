/**
 * env.ts — Runtime environment validation for Airborne Admin OS.
 *
 * REQUIRED vars crash the process with a clear message if absent.
 * OPTIONAL vars log a warning in dev; callers must handle undefined gracefully.
 *
 * Import this module early (e.g. in next.config.ts or a server-only bootstrap)
 * so misconfiguration surfaces at startup, not mid-request.
 */

// ─── Required ────────────────────────────────────────────────────────────────

const REQUIRED_VARS = [
  "DATABASE_URL",
  "AUTH_SECRET",
  "AUTH_URL",
  "PUBLIC_INTAKE_KEY",
] as const;

// ─── Optional with notes ─────────────────────────────────────────────────────

const OPTIONAL_VARS: Record<string, string> = {
  DIRECT_URL: "Prisma direct (non-pooled) URL - required for migrate deploy in CI",
  GEMINI_API_KEY: "Gemini AI study assistant - stub response returned when absent",
  GCS_BUCKET: "Google Cloud Storage bucket (default: airborne-aviation-media-prod)",
  R2_ACCOUNT_ID: "Cloudflare R2 (LEGACY - documents only)",
  R2_ACCESS_KEY_ID: "Cloudflare R2",
  R2_SECRET_ACCESS_KEY: "Cloudflare R2",
  R2_BUCKET_NAME: "Cloudflare R2 (default: airborne-media)",
  R2_BUCKET_DOCS: "Cloudflare R2 docs bucket",
  R2_PUBLIC_URL: "Cloudflare R2 public CDN URL",
  CRON_SECRET: "Cloud Scheduler auth secret for /api/cron/automation",
  LEAD_TRASH_RETENTION_DAYS: "Days deleted leads stay in the Recycle Bin before permanent deletion (default 30)",
  TWILIO_ACCOUNT_SID: "Twilio SMS - reserved, not yet active in code",
  TWILIO_AUTH_TOKEN: "Twilio SMS",
  TWILIO_PHONE_NUMBER: "Twilio SMS sender number",
  WATI_API_URL: "WATI WhatsApp - Sprint 5 notification worker",
  WATI_API_TOKEN: "WATI WhatsApp",
  RESEND_API_KEY: "Resend transactional email - reserved",
  RESEND_FROM_EMAIL: "Resend sender address",
  EMAIL_PROVIDER: "Email transport: resend | smtp (default resend)",
  SMTP_HOST: "SMTP host (e.g. smtp.gmail.com)",
  SMTP_PORT: "SMTP port (587 STARTTLS / 465 SSL)",
  SMTP_USER: "SMTP username / mailbox",
  SMTP_PASS: "SMTP password or Gmail app password",
  SMTP_FROM: "SMTP From address (defaults to SMTP_USER)",
  SMTP_SECURE: "true for port 465 SSL; leave unset for 587 STARTTLS",
  WHATSAPP_PROVIDER: "WhatsApp transport: mock | interakt (unset → noop)",
  INTERAKT_RATE_LIMIT_PER_MINUTE: "Interakt outbound rate cap per instance (default 480, max 600)",
  INTERAKT_API_KEY: "Interakt Developer Settings secret — server-side only, Basic auth",
  INTERAKT_API_BASE_URL: "Interakt API host (default https://api.interakt.ai)",
  INTERAKT_WEBHOOK_SECRET: "HMAC secret for Interakt-Signature (falls back to WHATSAPP_WEBHOOK_SECRET)",
  WHATSAPP_WEBHOOK_SECRET: "Shared secret / Interakt webhook HMAC key",
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: "Meta Cloud API hub.verify_token handshake",
  INTERAKT_TEMPLATE_LANGUAGE: "Default Interakt template languageCode (en)",
  INTERAKT_DEFAULT_TEMPLATE: "Fallback Interakt template code name when send has no templateName",
  INTERAKT_DEFAULT_TEMPLATE_VARIABLES:
    "Comma-separated inbox variable slots for default template (e.g. leadName,courseInterest)",
  INTERAKT_API_CAMPAIGN_ID: "Optional Interakt API campaign id attached to template sends",
  UPSTASH_REDIS_REST_URL: "Upstash Redis REST - ACTIVE: distributed rate-limit backend (with RATE_LIMIT_STORE=auto/upstash)",
  UPSTASH_REDIS_REST_TOKEN: "Upstash Redis REST token",
  RATE_LIMIT_STORE: "auto | memory | upstash - select rate-limit backend (default auto)",
  TRUSTED_PROXY: "none | cloud-run - client IP trust for rate-limit keys (default none)",
  PUBLIC_ORG_SLUG: "Org slug for public queries (default: airborne-aviation)",
  NEXT_PUBLIC_APP_URL: "Public URL of admin app",
  NEXT_PUBLIC_APP_NAME: "App display name",
  NEXT_PUBLIC_FACEBOOK_APP_ID: "Meta/Facebook CRM integration",
  FACEBOOK_APP_SECRET: "Meta webhook signature secret — required for leadgen webhooks",
  FACEBOOK_WEBHOOK_VERIFY_TOKEN: "Meta webhook hub.verify_token handshake",
  FACEBOOK_PAGE_ACCESS_TOKEN: "Meta Page access token (dat) for leadgen Graph API fetch (appsecret_proof enforced)",
};

// ─── Validation ──────────────────────────────────────────────────────────────

function validateEnv(): void {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `[env] Missing required environment variables:\n  ${missing.join("\n  ")}\n\nSee admin/.env.example for setup instructions.`,
    );
  }

  if (process.env.NODE_ENV === "development") {
    const missingOptional = Object.keys(OPTIONAL_VARS).filter(
      (key) => !process.env[key],
    );
    if (missingOptional.length > 0) {
      console.warn(
        `[env] Optional vars not set (features may be degraded):\n${missingOptional.map((k) => `  ${k}: ${OPTIONAL_VARS[k]}`).join("\n")}`,
      );
    }
  }
}

// ─── Typed accessors ─────────────────────────────────────────────────────────

export const env = {
  // Required
  DATABASE_URL: process.env.DATABASE_URL!,
  AUTH_SECRET: process.env.AUTH_SECRET!,
  AUTH_URL: process.env.AUTH_URL!,
  PUBLIC_INTAKE_KEY: process.env.PUBLIC_INTAKE_KEY!,

  // Optional — storage (GCS for media; R2 legacy for documents)
  GCS_BUCKET: process.env.GCS_BUCKET ?? "airborne-aviation-media-prod",
  R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
  R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME: process.env.R2_BUCKET_NAME ?? "airborne-media",
  R2_BUCKET_DOCS: process.env.R2_BUCKET_DOCS ?? "airborne-docs",
  R2_PUBLIC_URL: process.env.R2_PUBLIC_URL ?? "",

  // Optional — automation / cron
  CRON_SECRET: process.env.CRON_SECRET,
  INTERAKT_RATE_LIMIT_PER_MINUTE: process.env.INTERAKT_RATE_LIMIT_PER_MINUTE,

  // Optional — AI
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,

  // Optional — notifications (not yet active)
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER,
  WATI_API_URL: process.env.WATI_API_URL,
  WATI_API_TOKEN: process.env.WATI_API_TOKEN,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL ?? "noreply@airborneaviation.in",
  EMAIL_PROVIDER: process.env.EMAIL_PROVIDER ?? "resend",
  SMTP_HOST: process.env.SMTP_HOST,
  SMTP_PORT: process.env.SMTP_PORT,
  SMTP_USER: process.env.SMTP_USER,
  SMTP_PASS: process.env.SMTP_PASS,
  SMTP_FROM: process.env.SMTP_FROM,
  SMTP_SECURE: process.env.SMTP_SECURE,

  // Optional — Meta/Facebook lead-Gen CRM integration
  FACEBOOK_APP_SECRET: process.env.FACEBOOK_APP_SECRET,
  FACEBOOK_WEBHOOK_VERIFY_TOKEN: process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN,
  FACEBOOK_PAGE_ACCESS_TOKEN: process.env.FACEBOOK_PAGE_ACCESS_TOKEN,

  WHATSAPP_PROVIDER: process.env.WHATSAPP_PROVIDER,
  INTERAKT_API_KEY: process.env.INTERAKT_API_KEY,
  INTERAKT_API_BASE_URL: process.env.INTERAKT_API_BASE_URL ?? "https://api.interakt.ai",
  INTERAKT_WEBHOOK_SECRET: process.env.INTERAKT_WEBHOOK_SECRET,
  WHATSAPP_WEBHOOK_SECRET: process.env.WHATSAPP_WEBHOOK_SECRET,
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN,
  INTERAKT_TEMPLATE_LANGUAGE: process.env.INTERAKT_TEMPLATE_LANGUAGE ?? "en",
  INTERAKT_DEFAULT_TEMPLATE: process.env.INTERAKT_DEFAULT_TEMPLATE,
  INTERAKT_DEFAULT_TEMPLATE_VARIABLES: process.env.INTERAKT_DEFAULT_TEMPLATE_VARIABLES,
  INTERAKT_API_CAMPAIGN_ID: process.env.INTERAKT_API_CAMPAIGN_ID,

  // Optional — org
  PUBLIC_ORG_SLUG: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation",

  NODE_ENV: process.env.NODE_ENV ?? "development",
} as const;

// Run validation once at import time (server-side only).
// In Edge runtime this runs per-request; ensure env is valid before serving.
if (typeof window === "undefined") {
  validateEnv();
}

export { validateEnv };
