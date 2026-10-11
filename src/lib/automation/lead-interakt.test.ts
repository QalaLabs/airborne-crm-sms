import test from "node:test";
import assert from "node:assert/strict";
import { leadCreatedRequestId } from "./emit-lead-created";
import {
  createDefaultInteraktTrackDeps,
  isRetryableTrackResult,
  syncInteraktTrack,
  type InteraktTrackDeps,
} from "./interakt-track.service";
import { InteraktClient } from "@/lib/messaging/providers/interakt/client";
import { InteraktProvider } from "@/lib/messaging/providers/interakt.provider";
import { leadToCreatedEventTraits } from "@/lib/messaging/providers/interakt/mapping";
import {
  leadSourceGroup,
  normalizeCourseKey,
} from "@/lib/messaging/providers/interakt/course-routing";
import { verifyInteraktSignature, signInteraktPayload, providerEventId, parseInteraktWebhook } from "@/lib/messaging/providers/interakt/webhooks";
import type { LeadTrackSource } from "@/lib/messaging/providers/interakt/mapping";
import type { SendResult } from "@/lib/messaging/types";
import type { AppEvent } from "@/types";

test("course routing uses CRM courseInterest, not WhatsApp text", () => {
  assert.equal(normalizeCourseKey("DGCA CPL Ground School"), "dgca_cpl");
  assert.equal(normalizeCourseKey("CPL (Commercial Pilot License)"), "dgca_cpl");
  assert.equal(normalizeCourseKey("Cabin Crew Training"), "cabin_crew");
  assert.equal(normalizeCourseKey("Cadet Prep"), "cadet_pilot");
  assert.equal(normalizeCourseKey("ATPL"), "unknown");
  assert.equal(normalizeCourseKey(""), "unknown");
  assert.equal(normalizeCourseKey(null), "unknown");
});

test("lead source groups map existing LeadSource enum", () => {
  assert.equal(leadSourceGroup("GOOGLE_ADS"), "google");
  assert.equal(leadSourceGroup("HOMEPAGE_CTA"), "website");
  assert.equal(leadSourceGroup("DIRECT"), "manual");
  assert.equal(leadSourceGroup("WHATSAPP"), "whatsapp");
});

test("lead created request id is stable per Airborne lead", () => {
  assert.equal(leadCreatedRequestId("abc"), "lead:abc");
});

test("google ads traits include ad_set and ad from customFields", () => {
  const traits = leadToCreatedEventTraits({
    id: "lead-g",
    name: "Ads Lead",
    phone: "9876543210",
    status: "NEW",
    source: "GOOGLE_ADS",
    courseInterest: "Cabin Crew",
    utmCampaign: "camp-9",
    customFields: {
      googleAdsAdgroupId: "adset-1",
      googleAdsCreativeId: "ad-2",
    },
  });
  assert.equal(traits.course, "cabin_crew");
  assert.equal(traits.lead_source, "GOOGLE_ADS");
  assert.equal(traits.lead_source_group, "google");
  assert.equal(traits.ad_set, "adset-1");
  assert.equal(traits.ad, "ad-2");
  assert.equal(traits.campaign, "camp-9");
});

test("retryable track results include timeout and network", () => {
  const timeout: SendResult = { status: "FAILED", code: "TIMEOUT", retryable: true };
  const bad: SendResult = { status: "FAILED", code: "INVALID_PHONE", retryable: false };
  assert.equal(isRetryableTrackResult(timeout), true);
  assert.equal(isRetryableTrackResult(bad), false);
});

interface MemorySync {
  eventSent: boolean;
  contactSynced: boolean;
  status: string;
  skipReason?: string | null;
  errorMessage?: string | null;
  eventName?: string;
}

function memoryDeps(opts: {
  lead: LeadTrackSource | null;
  provider: InteraktProvider;
  syncs?: Map<string, MemorySync>;
}): InteraktTrackDeps & { activities: unknown[]; syncs: Map<string, MemorySync> } {
  const syncs = opts.syncs ?? new Map<string, MemorySync>();
  const activities: unknown[] = [];
  return {
    activities,
    syncs,
    getWhatsAppProvider: () => opts.provider,
    findLead: async () => opts.lead,
    findSync: async (leadId, eventName) => syncs.get(`${leadId}:${eventName}`) ?? null,
    saveSync: async (input) => {
      syncs.set(`${input.leadId}:${input.eventName}`, {
        eventSent: input.eventSent,
        contactSynced: input.contactSynced,
        status: input.status,
        skipReason: input.skipReason,
        errorMessage: input.errorMessage,
        eventName: input.eventName,
      });
    },
    writeActivity: async (input) => {
      activities.push(input);
    },
    resolveWorkflowRef: async () => "CPL New Lead Nurture",
  };
}

function fakeProvider(handler: typeof fetch): InteraktProvider {
  return new InteraktProvider(
    () =>
      new InteraktClient({
        apiKey: "test-key",
        fetchImpl: handler,
        sleep: async () => undefined,
      }),
  );
}

function leadEvent(leadId: string, source = "HOMEPAGE_CTA"): AppEvent {
  return {
    name: "lead/created",
    orgId: "org-1",
    actorId: "system",
    actorName: "test",
    requestId: leadCreatedRequestId(leadId),
    timestamp: new Date().toISOString(),
    data: { leadId, leadName: "Airborne Test Lead", source },
  } as AppEvent;
}

const websiteCpl: LeadTrackSource = {
  id: "lead-web",
  name: "Airborne Test Lead",
  phone: "9876543210",
  email: "test@airborne.test",
  status: "NEW",
  source: "HOMEPAGE_CTA",
  courseInterest: "DGCA CPL Ground School",
  landingPage: "/",
  createdAt: new Date("2026-09-02T00:00:00.000Z"),
};

const googleCabin: LeadTrackSource = {
  id: "lead-google",
  name: "Google Cabin",
  phone: "9876543211",
  status: "NEW",
  source: "GOOGLE_ADS",
  courseInterest: "Cabin Crew Training",
  customFields: { googleAdsAdgroupId: "ag-1", googleAdsCreativeId: "cr-1" },
};

const adminManual: LeadTrackSource = {
  id: "lead-admin",
  name: "Admin Lead",
  phone: "9876543212",
  status: "NEW",
  source: "DIRECT",
  courseInterest: "Cadet Prep",
};

async function withKey<T>(fn: () => Promise<T>): Promise<T> {
  const prev = process.env.INTERAKT_API_KEY;
  process.env.INTERAKT_API_KEY = "test-key";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.INTERAKT_API_KEY;
    else process.env.INTERAKT_API_KEY = prev;
  }
}

test("website CPL lead tracks user then lead_created with dgca_cpl", async () => {
  await withKey(async () => {
    const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
    const provider = fakeProvider(async (url, init) => {
      calls.push({ path: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(JSON.stringify({ result: true, id: "ok-1" }), { status: 200 });
    });
    const deps = memoryDeps({ lead: websiteCpl, provider });
    await syncInteraktTrack(leadEvent(websiteCpl.id, "HOMEPAGE_CTA"), deps);
    assert.equal(calls.length, 2);
    const userCall = calls[0];
    const eventCall = calls[1];
    assert.ok(userCall && eventCall);
    assert.match(userCall.path, /track\/users/);
    assert.match(eventCall.path, /track\/events/);
    assert.equal(eventCall.body.event, "lead_created");
    const eventTraits = eventCall.body.traits as Record<string, unknown>;
    assert.equal(eventTraits.course, "dgca_cpl");
    assert.equal(eventTraits.lead_source, "HOMEPAGE_CTA");
    assert.equal(eventTraits.airborne_lead_id, "lead-web");
    const sync = deps.syncs.get("lead-web:lead_created");
    assert.equal(sync?.eventSent, true);
    assert.equal(sync?.contactSynced, true);
    assert.equal(sync?.status, "event_sent");
  });
});

test("google cabin crew lead routes to cabin_crew and not dgca_cpl", async () => {
  await withKey(async () => {
    const events: string[] = [];
    const courses: string[] = [];
    const provider = fakeProvider(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(url).includes("/track/events/")) {
        events.push(String(body.event));
        courses.push(String((body.traits as Record<string, unknown>).course));
      }
      return new Response(JSON.stringify({ result: true, id: "ok-2" }), { status: 200 });
    });
    const deps = memoryDeps({ lead: googleCabin, provider });
    await syncInteraktTrack(leadEvent(googleCabin.id, "GOOGLE_ADS"), deps);
    assert.deepEqual(events, ["lead_created"]);
    assert.deepEqual(courses, ["cabin_crew"]);
    assert.notEqual(courses[0], "dgca_cpl");
  });
});

test("admin-created cadet lead uses DIRECT / cadet_pilot", async () => {
  await withKey(async () => {
    let traits: Record<string, unknown> = {};
    const provider = fakeProvider(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(url).includes("/track/events/")) traits = body.traits as Record<string, unknown>;
      return new Response(JSON.stringify({ result: true }), { status: 200 });
    });
    await syncInteraktTrack(leadEvent(adminManual.id, "DIRECT"), memoryDeps({ lead: adminManual, provider }));
    assert.equal(traits.course, "cadet_pilot");
    assert.equal(traits.lead_source, "DIRECT");
    assert.equal(traits.lead_source_group, "manual");
  });
});

test("unknown course still sends one lead_created event", async () => {
  await withKey(async () => {
    let course: unknown;
    const provider = fakeProvider(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(url).includes("/track/events/")) course = (body.traits as Record<string, unknown>).course;
      return new Response(JSON.stringify({ result: true }), { status: 200 });
    });
    const lead = { ...websiteCpl, id: "lead-unknown", courseInterest: "ATPL Ground" };
    await syncInteraktTrack(leadEvent(lead.id), memoryDeps({ lead, provider }));
    assert.equal(course, "unknown");
  });
});

test("missing phone records skip and does not call Interakt", async () => {
  await withKey(async () => {
    let calls = 0;
    const provider = fakeProvider(async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    });
    const lead = { ...websiteCpl, id: "lead-nophone", phone: "" };
    const deps = memoryDeps({ lead, provider });
    await syncInteraktTrack(leadEvent(lead.id), deps);
    assert.equal(calls, 0);
    assert.equal(deps.syncs.get("lead-nophone:lead_created")?.status, "skipped");
    assert.equal(deps.syncs.get("lead-nophone:lead_created")?.skipReason, "missing_phone");
  });
});

test("duplicate lead_created does not call Interakt again", async () => {
  await withKey(async () => {
    let calls = 0;
    const provider = fakeProvider(async () => {
      calls += 1;
      return new Response(JSON.stringify({ result: true, id: "x" }), { status: 200 });
    });
    const syncs = new Map<string, MemorySync>([
      ["lead-web:lead_created", { eventSent: true, contactSynced: true, status: "event_sent" }],
    ]);
    const deps = memoryDeps({ lead: websiteCpl, provider, syncs });
    await syncInteraktTrack(leadEvent(websiteCpl.id), deps);
    assert.equal(calls, 0);
  });
});

test("Interakt API failure is recorded and thrown for retry", async () => {
  await withKey(async () => {
    const provider = fakeProvider(async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }));
    const deps = memoryDeps({ lead: websiteCpl, provider });
    await assert.rejects(() => syncInteraktTrack(leadEvent(websiteCpl.id), deps));
    assert.equal(deps.syncs.get("lead-web:lead_created")?.status, "failed");
    assert.match(deps.syncs.get("lead-web:lead_created")?.errorMessage ?? "", /boom|500|UNEXPECTED/);
  });
});

test("Interakt timeout is retryable failure, not success", async () => {
  await withKey(async () => {
    const provider = fakeProvider(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });
    const deps = memoryDeps({ lead: { ...websiteCpl, id: "lead-timeout" }, provider });
    await assert.rejects(() => syncInteraktTrack(leadEvent("lead-timeout"), deps));
    const row = deps.syncs.get("lead-timeout:lead_created");
    assert.equal(row?.eventSent, false);
    assert.equal(row?.status, "failed");
  });
});

test("successful contact sync then event failure keeps contactSynced", async () => {
  await withKey(async () => {
    let n = 0;
    const provider = fakeProvider(async () => {
      n += 1;
      if (n === 1) return new Response(JSON.stringify({ result: true, id: "user-1" }), { status: 200 });
      return new Response(JSON.stringify({ message: "timeout" }), { status: 500 });
    });
    const deps = memoryDeps({ lead: { ...websiteCpl, id: "lead-partial" }, provider });
    await assert.rejects(() => syncInteraktTrack(leadEvent("lead-partial"), deps));
    const row = deps.syncs.get("lead-partial:lead_created");
    assert.equal(row?.contactSynced, true);
    assert.equal(row?.eventSent, false);
    assert.equal(row?.status, "failed");
  });
});

test("unconfigured provider records skip, never success", async () => {
  const prev = process.env.INTERAKT_API_KEY;
  delete process.env.INTERAKT_API_KEY;
  try {
    const provider = new InteraktProvider();
    const deps = memoryDeps({ lead: websiteCpl, provider });
    await syncInteraktTrack(leadEvent(websiteCpl.id), deps);
    assert.equal(deps.syncs.get("lead-web:lead_created")?.status, "skipped");
    assert.equal(deps.syncs.get("lead-web:lead_created")?.skipReason, "interakt_not_configured");
    assert.equal(deps.syncs.get("lead-web:lead_created")?.eventSent, false);
  } finally {
    if (prev) process.env.INTERAKT_API_KEY = prev;
  }
});

test("invalid webhook signature is rejected", () => {
  const body = '{"type":"message_api_delivered"}';
  const header = signInteraktPayload(body, "secret");
  assert.equal(verifyInteraktSignature(body, header, "secret"), true);
  assert.equal(verifyInteraktSignature(body, header, "other"), false);
});

test("duplicate webhook event id is stable", () => {
  const parsed = parseInteraktWebhook({
    type: "message_api_delivered",
    data: { message: { id: "m-9", message_status: "Delivered" }, customer: { channel_phone_number: "919876543210" } },
  });
  assert.ok(parsed);
  assert.equal(providerEventId(parsed!), "message_api_delivered:m-9");
  assert.equal(providerEventId(parsed!), providerEventId(parsed!));
});

test("default track deps expose prisma-backed functions", () => {
  const deps = createDefaultInteraktTrackDeps();
  assert.equal(typeof deps.findLead, "function");
  assert.equal(typeof deps.saveSync, "function");
});
