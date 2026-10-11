import test from "node:test";
import assert from "node:assert/strict";
import { revalidateWebsite, syncWebsiteContent, websiteResourcesFor, websiteRevalidateConfig } from "./revalidate";

const ENV = { WEBSITE_REVALIDATE_URL: "https://site.example/api/revalidate", WEBSITE_REVALIDATE_SECRET: "s3cret" };

test("websiteResourcesFor maps audited CMS entities to website cache tags", () => {
  assert.deepEqual(websiteResourcesFor("testimonial"), ["testimonials"]);
  assert.deepEqual(websiteResourcesFor("resource"), ["resources", "blogs"]);
  assert.deepEqual(websiteResourcesFor("nav_menu"), ["settings"]);
  assert.deepEqual(websiteResourcesFor("lead"), []);
  assert.deepEqual(websiteResourcesFor("payment"), []);
});

test("revalidation is skipped unless both URL and secret are configured", async () => {
  assert.equal(websiteRevalidateConfig({}), null);
  assert.equal(websiteRevalidateConfig({ WEBSITE_REVALIDATE_URL: ENV.WEBSITE_REVALIDATE_URL }), null);
  let called = false;
  const fake = (async () => {
    called = true;
    return new Response("{}");
  }) as typeof fetch;
  assert.deepEqual(await revalidateWebsite(["testimonials"], fake, {}), { status: "skipped" });
  assert.deepEqual(await revalidateWebsite([], fake, ENV), { status: "skipped" });
  assert.equal(called, false);
});

test("revalidation posts the deduped resources with the shared secret", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  assert.deepEqual(await revalidateWebsite(["testimonials", "testimonials", "pages"], fake, ENV), { status: "ok" });
  assert.equal(seen!.url, ENV.WEBSITE_REVALIDATE_URL);
  assert.equal(seen!.init.method, "POST");
  assert.equal((seen!.init.headers as Record<string, string>)["x-revalidate-secret"], "s3cret");
  assert.deepEqual(JSON.parse(String(seen!.init.body)), { resources: ["testimonials", "pages"] });
});

test("syncWebsiteContent reports ok / skipped / failed in words the admin UI can show", async () => {
  const calls: unknown[] = [];
  const okFetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  const ok = await syncWebsiteContent("testimonial", "req-1", okFetch, ENV);
  assert.equal(ok.status, "ok");
  assert.deepEqual(calls, [{ resources: ["testimonials"] }]);

  const page = await syncWebsiteContent("page", "req-2", okFetch, ENV);
  assert.equal(page.status, "ok");
  assert.deepEqual(calls[1], { resources: ["pages"] });

  const unconfigured = await syncWebsiteContent("testimonial", "req-3", okFetch, {});
  assert.equal(unconfigured.status, "skipped");
  assert.match(unconfigured.message, /60 seconds/);

  const notWebsite = await syncWebsiteContent("payment", "req-4", okFetch, ENV);
  assert.equal(notWebsite.status, "skipped");
  assert.equal(calls.length, 2);

  const down = (async () => new Response("nope", { status: 503 })) as typeof fetch;
  const failed = await syncWebsiteContent("testimonial", "req-5", down, ENV);
  assert.equal(failed.status, "failed");
  assert.match(failed.message, /Saved/);
  assert.equal(failed.message.includes("s3cret"), false);
});

test("website failures are reported, never thrown", async () => {
  const down = (async () => new Response("nope", { status: 401 })) as typeof fetch;
  assert.deepEqual(await revalidateWebsite(["courses"], down, ENV), { status: "failed", detail: "HTTP 401" });
  const offline = (async () => {
    throw new Error("ECONNREFUSED");
  }) as typeof fetch;
  assert.deepEqual(await revalidateWebsite(["courses"], offline, ENV), { status: "failed", detail: "ECONNREFUSED" });
});
