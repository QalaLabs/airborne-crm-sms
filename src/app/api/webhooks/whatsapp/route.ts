import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { parseInboundWhatsApp } from "@/lib/messaging/inbound";
import {
  authorizeWhatsAppWebhookPost,
  isInteraktWebhookPayload,
  loadInteraktWebhookSecret,
  loadLegacyWhatsAppWebhookSecret,
} from "@/lib/messaging/providers/interakt/webhooks";
import { WhatsAppService } from "@/lib/services/whatsapp.service";
import { safeEqualString } from "@/lib/utils/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Inbound WhatsApp webhook ────────────────────────────────────────────────
//
// Public endpoint — matcher excludes /api/webhooks from session middleware so
// the raw body is not cloned/re-encoded before HMAC verification.
//
//   GET  → Meta Cloud API subscription handshake (hub.challenge).
//   POST → Interakt HMAC (Interakt-Signature) of the exact raw body;
//          otherwise the shared-secret x-webhook-secret / ?secret= check.
//
// Persistence (dedup, inbound thread, delivery status) happens in this
// handler before HTTP 200. Workflow fan-out is persisted to internal_events
// and processed by cron — no fire-and-forget after response.

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const expected = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
  if (mode === "subscribe" && expected && safeEqualString(token, expected) && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }
  return NextResponse.json({ error: "verification_failed" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  try {
    const interaktWebhookSecret = loadInteraktWebhookSecret();
    const legacyWebhookSecret = loadLegacyWhatsAppWebhookSecret();

    // Exact request bytes — HMAC must run before JSON.parse / re-stringify.
    const rawBuffer = Buffer.from(await req.arrayBuffer());
    const rawBody = rawBuffer.toString("utf8");
    const interaktSig = req.headers.get("interakt-signature");

    const auth = authorizeWhatsAppWebhookPost({
      rawBody: rawBuffer,
      interaktSignature: interaktSig,
      sharedSecretHeader: req.headers.get("x-webhook-secret"),
      querySecret: req.nextUrl.searchParams.get("secret"),
      interaktWebhookSecret,
      legacyWebhookSecret,
    });

    if (!auth.ok) {
      if (auth.error === "invalid_signature") {
        console.warn("[WhatsApp Webhook] Invalid Interakt-Signature", auth.diagnostics);
      } else if (auth.error === "not_configured") {
        console.warn("[WhatsApp Webhook] No webhook secret configured — rejecting", {
          secretConfigured: false,
          secretLength: 0,
          receivedPrefix: auth.diagnostics?.receivedPrefix ?? "none",
          receivedSignatureLength: auth.diagnostics?.receivedSignatureLength ?? 0,
          computedSignatureLength: 0,
          comparisonFailed: true,
        });
      } else {
        console.warn("[WhatsApp Webhook] Invalid secret provided");
      }
      return NextResponse.json({ received: false, error: auth.error }, { status: 403 });
    }

    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: { id: true },
    });
    if (!org) {
      console.error("[WhatsApp Webhook] Org not found");
      return NextResponse.json({ received: true, skipped: "org_not_found" }, { status: 200 });
    }

    let payload: unknown;
    try {
      payload = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return NextResponse.json({ received: true, skipped: "invalid_json" }, { status: 200 });
    }

    if (isInteraktWebhookPayload(payload)) {
      const result = await WhatsAppService.handleProviderWebhook(org.id, payload);
      return NextResponse.json({ received: true, ...result }, { status: 200 });
    }

    const msg = parseInboundWhatsApp(payload);
    if (!msg) {
      console.warn("[WhatsApp Webhook] Unrecognized payload shape", rawBody.slice(0, 500));
      return NextResponse.json({ received: true, skipped: "unrecognized_payload" }, { status: 200 });
    }

    const result = await WhatsAppService.ingestInboundMessage(org.id, msg);
    return NextResponse.json({ received: true, ...result }, { status: 200 });
  } catch (err) {
    console.error("[WhatsApp Webhook] Unhandled error", err);
    return NextResponse.json({ received: true, error: "internal" }, { status: 200 });
  }
}
