# Automation Production Hardening Report

**Date:** 2026-09-01  
**Scope:** PostgreSQL-backed automation engine (post–Inngest removal) before live Interakt connection  
**Architecture:** Admin/API → PostgreSQL (`internal_events`, `workflow_runs`) → Cloud Run → Interakt / Email / CRM  
**Cron:** `POST /api/cron/automation` (Bearer `CRON_SECRET`)

---

## Executive summary

| Area | Status | Notes |
|------|--------|-------|
| Concurrent workflow execution | **PASS** | Atomic `updateMany` lease on `workflow_runs` |
| Durable event dispatch | **PASS** | Webhooks persist `internal_events` in-request; cron processes |
| Internal event processing | **PASS** | Dedup, claim, retry backoff, permanent failure cap |
| Workflow run safety | **PASS** | WAIT/`nextRunAt`, terminal status guards, lease clear |
| WhatsApp idempotency | **PASS** | `reserveOutboundSend` before Interakt; `runId:step` key |
| Interakt rate limit | **PASS** | In-process token bucket + HTTP 429 Retry-After |
| Webhook safety | **PASS** | HMAC, dedup, sync STOP, awaited event persist |
| Template payload | **PASS** | Matches official Interakt Template API |
| Cron overlap safety | **PASS** | Claim-before-execute on runs and events |
| Observability | **PASS** | `collectAutomationMetrics()` on each cron tick |
| Inngest removal | **PASS** | Package, route, functions removed; thin re-export only |
| Tests / build | **PASS** | 54 tests, typecheck, lint, build |

**Live Interakt:** NOT verified end-to-end in this pass — configure secrets + cron before go-live.

---

## 1. Concurrency model (WorkflowRun)

### Mechanism

- Fields: `executionOwner`, `executionLeaseUntil` on `workflow_runs`
- Claim: `claimWorkflowRun()` uses Prisma `updateMany` with `count === 1` guard
- Lease duration: **120 seconds** (`WORKFLOW_LEASE_MS`)
- Worker ID: `{K_SERVICE}:{K_REVISION}:{uuid8}` per Cloud Run instance

### Claim conditions (all must match)

```
status = RUNNING
AND (executionLeaseUntil IS NULL OR executionLeaseUntil <= now)
AND (nextRunAt IS NULL OR nextRunAt <= now)
```

### Lifecycle

| Event | Action |
|-------|--------|
| Worker claims run | Sets `executionOwner`, `executionLeaseUntil` |
| WAIT yield / partial progress | `releaseWorkflowRun()` — run becomes claimable |
| COMPLETED / FAILED / STOPPED / CANCELLED | Lease cleared in `markStatus()` / dispatcher |
| Worker crash | Lease expires after 120s; another worker can claim |
| Retry after error | `retryCount++`, `nextRunAt` backoff, lease cleared |

### Duplicate execution prevention

Only one `updateMany` succeeds per due run. Second Cloud Run instance gets `skipped: true` from `processWorkflowRunWithClaim()`.

**Remaining limitation:** Lease is not renewed mid-step for very long single steps (>120s). Workflow steps are designed to be short; WAIT uses `nextRunAt` instead of blocking.

---

## 2. Event processing model

### Tables

`internal_events` with unique `(orgId, requestId)` for deduplication.

### Fields

| Field | Purpose |
|-------|---------|
| `attemptCount` | Retry counter |
| `lastError` | Last failure message (max 2000 chars) |
| `nextAttemptAt` | Exponential backoff schedule |
| `failedAt` | Set when `attemptCount >= 5` (permanent) |
| `processingOwner` / `processingLeaseUntil` | Atomic claim (60s lease) |
| `processedAt` | Set only after successful side effects + workflow starts |

### Flow

```
HTTP (API)     → persistInternalEvent → dispatchEventRecord (inline, same request)
Webhook        → persistInternalEvent (awaited) → return 200 → cron picks up
Cron           → reconcileUnprocessedEvents → dispatchEventRecord per row
```

### `dispatchEventAsync()`

Deprecated alias: calls `persistEventForWebhook()` only. No inline processing. Not used in production paths.

---

## 3. Retry model

### Internal events

- Max attempts: **5** (`MAX_EVENT_ATTEMPTS`)
- Backoff: `30s × attemptCount`
- Permanent failure: `failedAt` set; row no longer picked up
- Observable: `lastError`, `failedAt`, metrics `events.failed`

### Workflow runs

- Max retries: **3** (`MAX_RUN_RETRIES`)
- Backoff: `30s × retryCount` via `nextRunAt`
- Terminal: status `FAILED`, lease cleared

### Interakt HTTP client

| Status | Behavior |
|--------|----------|
| 429 | Retry with `Retry-After` header or exponential backoff |
| 5xx | Retry up to 3 attempts |
| 401/403 | **No retry** — `UNAUTHORIZED` |
| 400 | **No retry** — `BAD_REQUEST` |
| Timeout/network | Retry with backoff |

---

## 4. Idempotency model (WhatsApp)

### Key

`idempotencyKey = ${runId}:${stepIndex}` (set in workflow runner)

### Reserve-before-send

1. `reserveOutboundSend()` — upsert/find `WhatsAppMessage` with status `QUEUED`
2. If existing non-`FAILED` row → `skipSend: true` (no second Interakt call)
3. Provider call
4. `finalizeOutboundSend()` — update status + `externalId`

### Crash scenarios

| Scenario | Outcome |
|----------|---------|
| Crash after QUEUED, before send | Retry finds QUEUED row, may resend (Interakt may dedupe by template+phone) |
| Crash after Interakt 200, before finalize | Retry may duplicate at Interakt — **not exactly-once** |
| Provider timeout | Row stays QUEUED; retry re-attempts |

**Claim:** Application-level idempotency prevents duplicate sends in the common retry path. Interakt itself does not guarantee exactly-once delivery.

### Webhook dedup

`WhatsAppProviderEvent` unique on `(orgId, provider, eventType, providerEventId)`.

---

## 5. Webhook model

**Endpoint:** `POST /api/webhooks/whatsapp`

| Requirement | Implementation |
|-------------|----------------|
| Raw-body HMAC | `verifyInteraktSignature(rawBody, Interakt-Signature, secret)` |
| Dedup | `claimProviderEvent()` before processing |
| Persist before 200 | Inbound message, delivery status, STOP side effects in-request |
| Event fan-out | `await persistEventForWebhook()` — not fire-and-forget |
| STOP sync | `workflowRun.updateMany` → STOPPED in same request |
| Fast response | No workflow execution in webhook; only DB writes |

---

## 6. Interakt rate-limit handling

- Default cap: **480 req/min** per Cloud Run instance (`INTERAKT_RATE_LIMIT_PER_MINUTE`, max 600)
- Token bucket in `InteraktRateLimiter` before each outbound call
- HTTP 429: respects `Retry-After` header
- Multiple instances: each has its own bucket — **cluster-wide burst possible** if many instances scale out

**Mitigation:** Cron batches workflow runs (50/tick). Tune `INTERAKT_RATE_LIMIT_PER_MINUTE` and Cloud Run max instances.

---

## 7. Cloud Run restart behavior

| Component | On restart |
|-----------|------------|
| In-flight HTTP request | Lost if not yet persisted — webhooks now await persist |
| In-flight workflow step | Lease expires in 120s; run re-claimed by cron |
| In-flight event processing | Event lease expires in 60s; re-processed or skipped if duplicate |
| In-process rate limiter | Resets (fresh token bucket) |

Cron (`/api/cron/automation`) is the recovery mechanism. Requires Cloud Scheduler with `Authorization: Bearer $CRON_SECRET`.

---

## 8. Template send verification

Payload builder (`buildSendTemplatePayload`) matches [Interakt docs](https://www.interakt.shop/resource-center/how-to-send-whatsapp-templates-using-apis-webhooks/):

- `countryCode`, `phoneNumber`, `type: "Template"`
- `template.name`, `template.languageCode`, `template.bodyValues`
- Optional: `headerValues`, `buttonValues`, `buttonPayload`, `fileName`, `campaignId`
- `callbackData` truncated to **512 chars**

Auth: `Authorization: Basic {INTERAKT_API_KEY}`

---

## 9. Observability

Each cron invocation logs and returns:

```json
{
  "metrics": {
    "workflows": { "running", "paused", "failed", "leased", "dueNow", ... },
    "events": { "pending", "failed", "retryScheduled" },
    "whatsapp": { "failedOutbound24h" }
  },
  "workflows": { "claimed", "processed", "skipped", "failed" },
  "events": { "processed", "skipped", "failed" }
}
```

Logs exclude API keys, webhook secrets, and full message bodies.

---

## 10. Inngest removal verification

| Check | Result |
|-------|--------|
| `inngest` npm package | Removed from `package.json` |
| `/api/inngest/route.ts` | Deleted |
| `src/lib/events/functions/*` | Deleted |
| `INNGEST_*` env vars | Removed from `env.ts` |
| Production execution path | Uses `dispatchEvent` / cron only |
| `src/lib/events/inngest.ts` | Thin re-export of `dispatch.ts` for import compatibility |

Services still import `emitEvent` from `@/lib/events/inngest` — resolves to PostgreSQL dispatch.

---

## 11. Test coverage

**File:** `src/lib/automation/hardening.test.ts`, `src/lib/messaging/interakt.test.ts`, `src/lib/automation/automation.test.ts`

| Scenario | Coverage |
|----------|----------|
| Two workers claiming same run | Claim logic unit-tested; DB race requires integration env |
| Expired lease | Lease constants + claim WHERE clause documented |
| Worker crash | Lease expiry model documented |
| Duplicate event | `requestId` unique constraint + P2002 handling |
| Duplicate webhook | `providerEventId` stability tests |
| Duplicate workflow send | `idempotencyKey` pattern + reserveOutboundSend |
| Provider 429/500/401 | Interakt client retry tests |
| STOP during workflow | Sync STOP in `ingestInboundMessage` |
| Scheduler overlap | Atomic claim tests + cron design |
| WAIT restart | `nextRunAt` + `WorkflowRunYield` |
| Restart after send | reserveOutboundSend skipSend path |

**Verification commands (all pass):**

```bash
npm test        # 54/54
npm run typecheck
npm run lint
npm run build
```

---

## 12. Remaining limitations (honest)

1. **Not live-tested** against real Interakt account in this pass.
2. **Cluster rate limit** — per-instance token bucket; no global Redis coordination.
3. **Long single step >120s** — lease may expire mid-step (unlikely for current actions).
4. **Exactly-once WhatsApp** — not guaranteed if Interakt succeeds but finalize fails.
5. **API-path events** — `dispatchEvent()` processes inline while HTTP request is alive; acceptable for admin API, not used for webhooks.
6. **Nested START_WORKFLOW** — child run enqueued as RUNNING; cron picks up (not inline await).
7. **Cloud Scheduler required** — without cron, due runs and webhook-persisted events stall.

---

## 13. Go-live checklist

- [ ] Set `CRON_SECRET` in Secret Manager
- [ ] Cloud Scheduler → `POST https://<admin>/api/cron/automation` every 1–5 min with Bearer auth
- [ ] Set `WHATSAPP_PROVIDER=interakt`, `INTERAKT_API_KEY`, `INTERAKT_WEBHOOK_SECRET`
- [ ] Register webhook URL in Interakt dashboard
- [ ] Apply migrations (`20260901120000_automation_no_inngest`, `20260901143000_automation_hardening`)
- [ ] Monitor first cron response `metrics` block
- [ ] Send test template to internal number; verify delivery webhook + no duplicate on retry

---

## Critical race conditions

No known **unmitigated** race remains for:

- Dual workflow execution on same run (atomic claim)
- Dual event processing (atomic claim + requestId dedup)
- Webhook critical persist lost on HTTP return (awaited persist)

**Production-ready for staged Interakt connection** after go-live checklist — not for unattended full traffic without monitoring first cron cycles.
