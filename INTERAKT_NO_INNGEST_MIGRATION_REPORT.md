# Interakt — No-Inngest Migration Report

**Status:** Code migrated. **NOT production-ready** until Cloud Scheduler + `CRON_SECRET` are configured and a live Interakt send/webhook cycle is verified.

## Summary

Production automation no longer depends on Inngest. Events persist in PostgreSQL, workflow execution runs on Cloud Run via a database-backed dispatcher, and Interakt User/Event Track runs directly from server-side services.

Inngest has been **fully removed** from production paths. See `AUTOMATION_PRODUCTION_HARDENING_REPORT.md` for the hardened engine.

---

## Removed Inngest Dependencies

| Previous dependency | What it did | Replacement |
|---|---|---|
| `emitEvent()` → `inngest.send()` | Event bus | `dispatchEvent()` → `internal_events` table + inline handlers |
| `onEventMatchWorkflows` | Match triggers → create runs | `matchAndStartRuns()` called from `dispatchEvent()` |
| `onWorkflowRunRequested` | Execute `WorkflowRun` | `enqueueWorkflowRun()` / `processWorkflowRun()` |
| `onInteraktTrack` | Interakt user/event sync | `syncInteraktTrack()` in `interakt-track.service.ts` |
| `onLeadCreated` | Score + welcome WhatsApp | `event-handlers.ts` → `handleLeadCreated()` |
| `onLeadAssigned` | Counselor email | `event-handlers.ts` → `handleLeadAssigned()` |
| `onAdmissionCreated` | Team notification | `event-handlers.ts` → `handleAdmissionCreated()` |
| `onPaymentReceived` | Receipt email | `event-handlers.ts` → `handlePaymentReceived()` |
| `onUserInvited` | Invite email | `event-handlers.ts` → `handleUserInvited()` |
| `onLeadFallbackSync` cron | Fallback lead replay | `/api/cron/automation` → `LeadService.syncFallbackLeadsCron()` |
| `onCmsScheduledCheck` cron | Scheduled CMS publish | `/api/cron/automation` → `PageService` / `CourseService` |
| `onBusinessScheduledCheck` cron | Scheduled resources | `/api/cron/automation` → `ResourceService` |
| Inngest `step.sleep` for WAIT | Durable delays | `WorkflowRun.nextRunAt` + Cloud Scheduler reconciliation |
| Webhook `await emitEvent()` | Workflow fan-out | `dispatchEventAsync()` — non-blocking, returns 200 fast |

**Unchanged (already sync or no-op stubs):** CMS/media/document status handlers, admission stage changed, lead activity created, testimonial handlers — durable work already in services.

---

## New Architecture

```
Admin API / Webhook
    ↓
dispatchEvent() / dispatchEventAsync()
    ↓
internal_events (PostgreSQL dedup)
    ↓
├─ syncInteraktTrack()        → InteraktProvider (direct HTTP)
├─ runEventSideEffects()      → notifications, reply-pause
└─ matchAndStartRuns()        → workflow_runs row
         ↓
    enqueueWorkflowRun()
         ↓
    processWorkflowRun()        → executeRun() with DB step API
         ↓
    SEND_WHATSAPP → NotificationService → InteraktProvider
```

**Cloud Scheduler** hits `POST /api/cron/automation` every 1–5 minutes with `Authorization: Bearer $CRON_SECRET` to:
- Resume workflow runs where `nextRunAt <= now()`
- Replay unprocessed `internal_events`
- Sync fallback leads
- Publish scheduled CMS/business content

---

## Database Changes

Migration: `prisma/migrations/20260901120000_automation_no_inngest/migration.sql`

### `workflow_runs` (extended)

| Column | Type | Purpose |
|---|---|---|
| `nextRunAt` | `DateTime?` | WAIT step resume time |
| `retryCount` | `Int` | Executor retry counter (max 3) |
| `pausedAt` | `DateTime?` | When run was paused (reply / manual) |
| `stoppedAt` | `DateTime?` | When run was stopped/cancelled |

Existing columns still used: `currentStep`, `status`, `error` (last error), `startedAt`, `completedAt`, `dedupKey`.

**Note:** Active state is `RUNNING` (equivalent to requested `ACTIVE`).

### `internal_events` (new)

| Column | Purpose |
|---|---|
| `orgId`, `name`, `requestId` | Dedup key (unique) |
| `payload` | Full event data |
| `processedAt` | Null until side effects + workflow match complete |

---

## Changed Files

### New

| File | Role |
|---|---|
| `src/lib/events/dispatch.ts` | Primary event bus |
| `src/lib/automation/workflow-dispatcher.ts` | Run executor + cron reconciliation |
| `src/lib/automation/step-api.ts` | DB-backed step API (replaces Inngest steps) |
| `src/lib/automation/interakt-track.service.ts` | Direct Interakt track |
| `src/lib/automation/event-handlers.ts` | Migrated Inngest side effects + reply pause |
| `src/lib/automation/automation.test.ts` | Migration smoke tests |
| `src/app/api/cron/automation/route.ts` | Cloud Scheduler endpoint |

### Modified

| File | Change |
|---|---|
| `src/lib/events/inngest.ts` | `emitEvent()` → `dispatchEvent()`; `isInngestEnabled()` → `false` |
| `src/lib/workflow/engine.ts` | `enqueueWorkflowRun()` instead of Inngest event |
| `src/lib/workflow/runner.ts` | WAIT uses `nextRunAt` + `WorkflowRunYield` |
| `src/lib/workflow/actions.ts` | START_WORKFLOW uses dispatcher |
| `src/lib/services/workflow.service.ts` | runNow/resume uses dispatcher |
| `src/lib/services/whatsapp.service.ts` | Async dispatch; `stoppedAt` on opt-out |
| `src/app/health/ready/route.ts` | Reports `automation_engine: true` |
| `src/middleware.ts` | Public `/api/cron` |
| `src/lib/env.ts` | Documents `CRON_SECRET` |
| `prisma/schema.prisma` | Schema extensions |

### Retained (not deleted)

- `src/lib/events/functions/*.ts` — legacy Inngest handlers
- `src/app/api/inngest/route.ts` — legacy registration only

---

## Interakt (unchanged provider)

- `InteraktProvider` untouched
- Endpoints: track users/events, template send, get users, create campaign, assignment
- Server-only: `INTERAKT_API_KEY`, `INTERAKT_WEBHOOK_SECRET`, `WHATSAPP_PROVIDER`
- No `NEXT_PUBLIC_INTERAKT_*`

### Webhook path (`POST /api/webhooks/whatsapp`)

Sync (under 3s):
1. HMAC verify raw body
2. `WhatsAppProviderEvent` dedup
3. Persist message / conversation / LeadActivity
4. STOP → opt-out + stop runs + audit (sync)

Async (fire-and-forget):
5. `dispatchEventAsync(whatsapp.replied | whatsapp.opted_out | delivery status)`

---

## Verification Checklist

| # | Requirement | Status |
|---|---|---|
| 1 | No production WhatsApp path depends on Inngest | **PASS** — `SEND_WHATSAPP` → `executeRun` → `NotificationService` → `InteraktProvider` |
| 2 | No Interakt path depends on Inngest | **PASS** — track via `syncInteraktTrack()` |
| 3 | Automation state in PostgreSQL | **PASS** — `workflow_runs` + `internal_events` |
| 4 | Cloud Run restart safe | **PASS** — resumes from `currentStep` / `nextRunAt` |
| 5 | Duplicate webhook cannot duplicate messages/events | **PASS** — existing dedup tables unchanged |
| 6 | Duplicate workflow cannot duplicate WhatsApp | **PASS** — `idempotencyKey = runId:step` |
| 7 | STOP blocks marketing sends | **PASS** — opt-out flags + workflow stop |
| 8 | Customer reply pauses automation | **PASS** — `pauseMarketingRunsOnReply()` on `whatsapp.replied` |

---

## Tests

```
npm test        → 36/36 pass (includes 5 automation migration tests)
npm run typecheck → pass
npm run lint      → pass (pre-existing media warnings)
npm run build     → pass (migration applied)
```

---

## Production Setup Required

1. Set `CRON_SECRET` in Secret Manager
2. Create Cloud Scheduler job:
   - URL: `https://<admin-host>/api/cron/automation`
   - Schedule: `*/5 * * * *` (or `*/1` for faster WAIT resume)
   - Header: `Authorization: Bearer <CRON_SECRET>`
3. Remove or ignore `INNGEST_EVENT_KEY` in production env
4. Keep Interakt env vars as before
5. Run live Interakt verification (test connection, template send, delivery webhook)

---

## Remaining Limitations

1. **Cloud Scheduler required** — WAIT steps and cron jobs do nothing until scheduler is configured
2. **No Cloud Tasks yet** — sub-minute precise delays rely on scheduler frequency; Cloud Tasks not added (not required for current WAIT granularity)
3. **Inngest route still exists** — dead code; safe to remove in follow-up PR
4. **CRM integrations UI** still references Inngest status — cosmetic only
5. **Concurrent run execution** — two Cloud Run instances could process same due run; mitigated by idempotency keys on sends, not full distributed lock
6. **Human handover** — reply pauses all RUNNING lead workflows; no per-workflow-type filter yet
7. **NOT LIVE** — no real Interakt end-to-end verification in this migration session

---

## LIVE / NOT LIVE

**NOT LIVE** — automation engine code-complete; production requires `CRON_SECRET` + Cloud Scheduler + live Interakt verification per `INTERAKT_INTEGRATION.md`.
