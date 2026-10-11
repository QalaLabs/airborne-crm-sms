# Interakt integration

Server-side WhatsApp transport for Airborne Admin. Browser never talks to Interakt. Credentials stay in server env (`INTERAKT_*`, never `NEXT_PUBLIC_*`).

**Live status:** not claimed. A real API key has not been used successfully in this change. Until `WHATSAPP_PROVIDER=interakt` + `INTERAKT_API_KEY` are set and a request against `https://api.interakt.ai` returns 200, keep `WHATSAPP_PROVIDER=mock`. Mock reports `SENT` with a `mock-` id and never calls Interakt.

Sources of truth:

- [APIs and webhooks overview](https://www.interakt.shop/resource-center/interakt-apis-and-webhooks-an-overview/)
- [User & Event Track](https://www.interakt.shop/resource-center/user-and-event-track-api/)
- [Template Send](https://www.interakt.shop/resource-center/how-to-send-whatsapp-templates-using-apis-webhooks/)
- [Webhooks](https://www.interakt.shop/resource-center/interakts-webhooks/)
- [Chat Assignment](https://www.interakt.shop/resource-center/interakt-chat-assignment-api/)
- [API Campaigns](https://www.interakt.shop/resource-center/api-campaign-on-whatsapp/)
- [Postman collection](https://documenter.getpostman.com/view/14760594/2sA2r7zibM)
- [Python SDK](https://github.com/hellohaptik/track-python)

## Endpoints used

Auth on every call: `Authorization: Basic <INTERAKT_API_KEY>` (key from Interakt → Settings → Developer Setting, passed as-is with the `Basic` prefix). `Content-Type: application/json`. Base URL `https://api.interakt.ai` (override with `INTERAKT_API_BASE_URL`).

| Method | Path | Use |
| --- | --- | --- |
| POST | `/v1/public/track/users/` | Create/update Interakt user from a Lead |
| POST | `/v1/public/track/events/` | Record CRM events on that user |
| POST | `/v1/public/message/` | Send an approved WhatsApp template |
| POST | `/v1/public/apis/users/?offset=&limit=` | Get Users — health/test connection |
| POST | `/v1/public/create-campaign/` | Create Interakt API campaign (analytics id) |
| POST | `/v1/public/assignment/` | Assign chat to an agent email |

Timeout 10s. Retries (429 / 5xx / network / abort) with backoff, max 3. 4xx other than 429 are not retried.

## Payload mapping

### User Track (Lead → Interakt)

```json
{
  "userId": "<Lead.id>",
  "phoneNumber": "9876543210",
  "countryCode": "+91",
  "traits": {
    "airborne_lead_id": "<Lead.id>",
    "name": "<Lead.name>",
    "email": "<Lead.email>",
    "course": "dgca_cpl | cabin_crew | cadet_pilot | unknown",
    "course_interest": "<Lead.courseInterest>",
    "lead_source": "<Lead.source enum>",
    "lead_source_group": "google | website | manual | …",
    "landing_page": "<Lead.landingPage>",
    "campaign": "<Lead.utmCampaign>",
    "ad_set": "<customFields.googleAdsAdgroupId>",
    "ad": "<customFields.googleAdsCreativeId>",
    "lead_created_at": "<Lead.createdAt ISO>",
    "leadStatus": "<Lead.status>",
    "city": "<Lead.city>",
    "whatsappOptOut": false
  },
  "tags": ["<lead.tags>", "status:NEW", "course:CPL"]
}
```

Phone is always split to `+91` + 10-digit national number. Stored conversation phone stays digits-only.

### Event Track

| Internal event | Interakt `event` |
| --- | --- |
| `lead/created` / `lead.created` | `lead_created` |
| `lead/status.changed` | `lead.status_changed` |
| `lead/assigned` | `lead.assigned` |
| `payment/received` | `payment.success` |
| `payment.pending` | `payment.pending` |
| `payment.failed` | `payment.failed` |
| `course.enrolled` | `course.enrolled` |
| `whatsapp.opted_out` | `whatsapp.opted_out` |
| `whatsapp.replied` | `whatsapp.replied` |

Tracking runs via `internal_events` **inline after lead persist** (`emitLeadCreated` → `syncInteraktTrack`). Cron only retries unprocessed/failed InternalEvent rows — it does not poll for new leads. One Interakt custom event (`lead_created`) plus traits (`course`, `lead_source`, …) so Interakt Advanced branches per course.

### Template Send

Interakt public API **only** sends approved templates (`type: "Template"`). Free-form session messages are not documented.

```json
{
  "countryCode": "+91",
  "phoneNumber": "9876543210",
  "type": "Template",
  "callbackData": "{\"v\":1,\"l\":\"<leadId>\",\"c\":\"<conversationId>\",\"m\":\"<messageId>\",\"w\":\"<runId>\",\"s\":\"<step>\",\"k\":\"<campaignId>\",\"i\":\"<idempotencyKey>\"}",
  "template": {
    "name": "<Interakt template code name>",
    "languageCode": "en",
    "bodyValues": ["…"]
  }
}
```

`callbackData` max 512 chars. Returned on status webhooks under `data.message.meta_data.source_data.callback_data`.

`NotificationTemplate.name` (WHATSAPP channel) must be the Interakt **code name** (`https://app.interakt.ai/template/<codename>/view`). Workflow `SEND_WHATSAPP.templateName` overrides. Else `INTERAKT_DEFAULT_TEMPLATE`. Inbox free-form send uses the default template with the typed body as `{{1}}`, or fails with TEMPLATE_REQUIRED.

Optional `INTERAKT_API_CAMPAIGN_ID` is sent as `campaignId` so Interakt dashboard analytics record the send.

## Persistence

`WhatsAppMessage` stores: internal id, Interakt message id (`externalId`), lead id, conversation id, campaign id, workflow run/step, `idempotencyKey`, provider metadata JSON.

Outbound workflow sends use `idempotencyKey = ${runId}:${stepIndex}` — a retry does not send twice.

Webhook deliveries are deduped on `WhatsAppProviderEvent` unique `(orgId, provider, eventType, providerEventId)` where `providerEventId = ${type}:${message.id}`.

## Webhook setup

1. Admin URL: `https://<admin-host>/api/webhooks/whatsapp`
2. Interakt → Settings → Developer Setting → Webhook URL + Secret Key
3. Set the same secret as `INTERAKT_WEBHOOK_SECRET` (or `WHATSAPP_WEBHOOK_SECRET`)
4. Interakt signs the **raw body** with HMAC-SHA256; header `Interakt-Signature: sha256=<hex>`
5. Handler must return HTTP 200 within 3 seconds — inbound/status rows and `internal_events` are persisted in-request; workflow execution is cron-driven

Handled types:

- `message_received` → inbound `WhatsAppMessage`, conversation bump, `LeadActivity`, `whatsapp.replied`
- `STOP` / `UNSUBSCRIBE` / … → `Lead.whatsappOptOut`, conversation `optedOut`, stop RUNNING/PAUSED workflow runs, audit, `whatsapp.opted_out`
- `message_api_sent|delivered|read|failed` and `message_campaign_*` → internal `SENT|DELIVERED|READ|FAILED` (never downgrade READ)

Account/template alert types (`account_alerts`, `message_template_status_update`, …) are acknowledged and ignored.

## Environment variables

Server-only. Do not prefix with `NEXT_PUBLIC_`.

| Var | Required for live | Purpose |
| --- | --- | --- |
| `WHATSAPP_PROVIDER` | yes (`interakt`) | `mock` locally, `interakt` in prod, unset → noop |
| `INTERAKT_API_KEY` | yes | Developer Setting secret |
| `INTERAKT_WEBHOOK_SECRET` | yes for HMAC | Same secret entered in Interakt webhook config |
| `WHATSAPP_WEBHOOK_SECRET` | fallback | Used if `INTERAKT_WEBHOOK_SECRET` unset |
| `INTERAKT_API_BASE_URL` | no | default `https://api.interakt.ai` |
| `INTERAKT_TEMPLATE_LANGUAGE` | no | default `en` |
| `INTERAKT_DEFAULT_TEMPLATE` | recommended | fallback template code name |
| `INTERAKT_API_CAMPAIGN_ID` | no | Interakt API campaign analytics id |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta only | `hub.verify_token` handshake |

Org master switch remains WhatsApp → Settings → “WhatsApp notifications” (`featureFlags.whatsappNotifications`). Automated `SEND_WHATSAPP` still no-ops until that is on.

## Provider capabilities (documented)

- User Track, Event Track, Get Users, Template Send, API Campaign create, Chat Assignment
- Webhooks: template/campaign delivery, inbound customer messages, button clicks (clicks stored as ignored kind for now)

## Unsupported / unverified

Do **not** invent these. They are either undocumented or only UI-side in Interakt:

- Free-form / session WhatsApp messages via public API (Template only)
- List/create WhatsApp message templates via API (templates are created in Interakt / synced from Meta)
- Delete user / delete traits
- Delete tags (Track API can only add tags)
- Inbox agent replies from our UI into an Interakt session thread
- n8n, Supabase extra queues — not used; Workflow + PostgreSQL `internal_events` + Cloud Scheduler cron
- HMAC algorithm variants other than the documented `Interakt-Signature: sha256=<hex>`
- Exact Postman collection field names for Get Users response pagination (`has_next_page` is documented; extra fields were not frozen here)
- Chat Assignment `wc_id` semantics beyond “include when you have it”
- `payment.pending` / `payment.failed` Interakt events only fire if those canonical events are actually emitted (today `PaymentService` emits `payment/received`)

## Test procedure (local, no live key)

```bash
cd admin
# WHATSAPP_PROVIDER=mock  (default local)
npm test
npm run typecheck
npm run lint
npm run build
```

Webhook unit coverage: HMAC, inbound `message_received`, STOP keyword, delivery mapping, duplicate `providerEventId`, template/user/event payloads, 429 retry, 401 no-retry, SENT only when Interakt returns `id`.

## Interakt Advanced (manual dashboard)

Airborne cannot create Interakt workflows via API. In Interakt:

1. Create **one** custom event named exactly `lead_created` (underscore).
2. Create an Advanced workflow/ongoing campaign triggered by that event.
3. Branch on user/event trait `course`:
   - `dgca_cpl` → CPL templates (`cpl_nurture_d1_welcome_brochure`, `cpl_nurture_d3_founder_video`, `cpl_nurture_d5_success_story`)
   - `cabin_crew` → Cabin Crew sequence
   - `cadet_pilot` → Cadet sequence
   - optional else → unknown course
4. Map WhatsApp template variables **in Interakt** (Airborne does not send nurture `bodyValues`).
5. Point the Interakt webhook at `/api/webhooks/whatsapp`.
6. Paste the Interakt workflow name into Admin → WhatsApp → Automations (`workflowRef`).

Do not create a separate custom event per course.

## Production setup

1. Interakt Growth+ (public APIs are not on Starter). Advanced+ for inbound `message_received` webhooks.
2. Create/sync WhatsApp templates; copy **code names** into `NotificationTemplate.name` / `INTERAKT_DEFAULT_TEMPLATE`.
3. Secret Manager: `INTERAKT_API_KEY`, `INTERAKT_WEBHOOK_SECRET`. Cloud Run env: `WHATSAPP_PROVIDER=interakt`.
4. WhatsApp → Settings → Test connection. **Connected** means Get Users returned HTTP 200. Until then the UI must not say live.
5. Enable the master switch.
6. Configure `CRON_SECRET` and Cloud Scheduler → `POST /api/cron/automation` every minute for **retry of failed InternalEvents**, Airborne workflow WAIT steps that are not lead-nurture, and CMS publish. New-lead WhatsApp sequences must be built in **Interakt Advanced** on event `lead_created`. Do not add a lead-polling cron.
7. Send one template to a test number; confirm `WhatsAppMessage.externalId` and a later `message_api_delivered` webhook upgrades status to `DELIVERED`.
