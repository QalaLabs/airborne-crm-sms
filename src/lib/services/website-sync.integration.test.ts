/**
 * Website sync chain against a disposable PostgreSQL database: testimonial and
 * CMS page mutations reach a (local, fake) website revalidate endpoint only
 * after they succeed; failed or rolled-back writes never do. Also covers the
 * public CMS pages API (published only, own org only). Gated by SECTION5_INTEGRATION=1.
 *
 *   npm run test:local
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { TestimonialService } from "@/lib/services/testimonial.service";
import { PageService } from "@/lib/services/page.service";
import { AuditService } from "@/lib/services/audit.service";
import { scheduleWebsiteRevalidation, syncWebsiteContent } from "@/lib/website/revalidate";
import { NotFoundError, ValidationError } from "@/lib/utils/errors";
import { GET as publicPages } from "@/app/api/public/pages/route";
import type { RequestContext } from "@/types";

const ENABLED = process.env.SECTION5_INTEGRATION === "1";
const SECRET = "integration-revalidate-secret";

type Hit = { resources: string[]; secret: string | undefined };

function ctx(orgId: string, userId: string): RequestContext {
  return {
    orgId,
    user: { id: userId, orgId, campusId: null, name: "Sync Admin", email: `${userId}@example.com`, role: "ADMIN", avatarUrl: null },
    requestId: randomUUID(),
    ipAddress: "127.0.0.1",
    userAgent: "node:test",
  };
}

test("website sync: mutations revalidate only after success; public pages API scope", { skip: !ENABLED }, async (t) => {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      hits.push({ resources: JSON.parse(body).resources, secret: req.headers["x-revalidate-secret"] as string | undefined });
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const prevEnv = { url: process.env.WEBSITE_REVALIDATE_URL, secret: process.env.WEBSITE_REVALIDATE_SECRET, slug: process.env.PUBLIC_ORG_SLUG };
  process.env.WEBSITE_REVALIDATE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/revalidate`;
  process.env.WEBSITE_REVALIDATE_SECRET = SECRET;

  const settle = () => new Promise((r) => setTimeout(r, 250));
  /** Hits produced by `fn` (audit hook + any explicit sync). */
  const during = async (fn: () => Promise<unknown>) => {
    const before = hits.length;
    await fn();
    await settle();
    return hits.slice(before);
  };

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const org = await prisma.organization.create({ data: { name: `Sync-${suffix}`, slug: `sync-${suffix}` } });
  const otherOrg = await prisma.organization.create({ data: { name: `SyncOther-${suffix}`, slug: `sync-other-${suffix}` } });
  const admin = await prisma.user.create({ data: { orgId: org.id, name: "Sync Admin", email: `sync-${suffix}@example.com`, role: "ADMIN", passwordHash: null } });
  const otherAdmin = await prisma.user.create({ data: { orgId: otherOrg.id, name: "Other", email: `sync-o-${suffix}@example.com`, role: "ADMIN", passwordHash: null } });

  try {
    await t.test("testimonial create / update / publish / unpublish / delete each revalidate testimonials", async () => {
      let id = "";
      const steps: [string, () => Promise<unknown>][] = [
        ["create", async () => (id = (await TestimonialService.create(ctx(org.id, admin.id), { authorName: "Sync A", content: "Great academy experience overall.", rating: 5 } as never)).id)],
        ["update", () => TestimonialService.update(ctx(org.id, admin.id), id, { content: "Updated testimonial content here." } as never)],
        ["publish", () => TestimonialService.review(ctx(org.id, admin.id), id, { status: "APPROVED" })],
        ["unpublish", () => TestimonialService.review(ctx(org.id, admin.id), id, { status: "REJECTED" })],
        ["delete", () => TestimonialService.delete(ctx(org.id, admin.id), id)],
      ];
      for (const [label, step] of steps) {
        const got = await during(step);
        assert.ok(got.length >= 1, `${label} revalidated`);
        for (const h of got) {
          assert.deepEqual(h.resources, ["testimonials"], label);
          assert.equal(h.secret, SECRET, label);
        }
      }
    });

    await t.test("the after-response hook skips what the route already synced, and retries a failed sync", async () => {
      // In a request the route's explicit sync completes before after() callbacks run.
      const requestId = randomUUID();
      const okHits = await during(async () => {
        assert.equal((await syncWebsiteContent("testimonial", requestId)).status, "ok");
        scheduleWebsiteRevalidation("testimonial", requestId);
      });
      assert.equal(okHits.length, 1);

      const failedId = randomUUID();
      const down = (async () => new Response("down", { status: 503 })) as typeof fetch;
      const retryHits = await during(async () => {
        assert.equal((await syncWebsiteContent("testimonial", failedId, down)).status, "failed");
        scheduleWebsiteRevalidation("testimonial", failedId);
      });
      assert.deepEqual(retryHits.map((h) => h.resources), [["testimonials"]]);
    });

    await t.test("failed DB mutations never revalidate the website", async () => {
      const created = await TestimonialService.create(ctx(org.id, admin.id), { authorName: "Sync C", content: "Third testimonial body text.", rating: 3 } as never);
      await settle();
      const got = await during(async () => {
        await assert.rejects(TestimonialService.review(ctx(org.id, admin.id), created.id, { status: "PENDING" as never }), ValidationError);
        await assert.rejects(TestimonialService.update(ctx(org.id, admin.id), randomUUID(), { content: "x".repeat(20) } as never), NotFoundError);
        await assert.rejects(TestimonialService.delete(ctx(otherOrg.id, otherAdmin.id), created.id), NotFoundError);
      });
      assert.deepEqual(got, []);
    });

    await t.test("an audit row written inside a rolled-back transaction does not revalidate", async () => {
      const got = await during(async () => {
        await assert.rejects(
          prisma.$transaction(async (tx) => {
            await AuditService.write({ orgId: org.id, action: "testimonial.updated", entityType: "testimonial" }, tx);
            throw new Error("rollback");
          }),
          /rollback/,
        );
      });
      assert.deepEqual(got, []);
    });

    await t.test("CMS page create / publish / unpublish revalidate pages; public API serves published pages of its own org only", async () => {
      process.env.PUBLIC_ORG_SLUG = org.slug;
      const c = ctx(org.id, admin.id);
      const slug = `sync-page-${suffix}`;
      const read = async (s: string) => (await (await publicPages(new NextRequest(`http://admin.test/api/public/pages?slug=${s}`))).json()).data;

      let pageId = "";
      const createHits = await during(async () => (pageId = (await PageService.create(c, { title: "Sync Page", slug, seoKeywords: [], metadata: {} })).id));
      assert.deepEqual(createHits.map((h) => h.resources), [["pages"]]);
      assert.equal(await read(slug), null, "draft is not public");

      const publishHits = await during(() => PageService.publish(ctx(org.id, admin.id), pageId, { status: "PUBLISHED" }));
      assert.deepEqual(publishHits.map((h) => h.resources), [["pages"]]);
      assert.equal((await read(slug))?.title, "Sync Page");

      const otherSlug = `sync-other-page-${suffix}`;
      const other = await PageService.create(ctx(otherOrg.id, otherAdmin.id), { title: "Other Org Page", slug: otherSlug, seoKeywords: [], metadata: {} });
      await PageService.publish(ctx(otherOrg.id, otherAdmin.id), other.id, { status: "PUBLISHED" });
      assert.equal(await read(otherSlug), null, "another organization's published page is not served");

      const archiveHits = await during(() => PageService.publish(ctx(org.id, admin.id), pageId, { status: "ARCHIVED" }));
      assert.deepEqual(archiveHits.map((h) => h.resources), [["pages"]]);
      assert.equal(await read(slug), null, "unpublished page is no longer public");
    });
  } finally {
    process.env.WEBSITE_REVALIDATE_URL = prevEnv.url;
    process.env.WEBSITE_REVALIDATE_SECRET = prevEnv.secret;
    if (prevEnv.slug === undefined) delete process.env.PUBLIC_ORG_SLUG;
    else process.env.PUBLIC_ORG_SLUG = prevEnv.slug;
    if (prevEnv.url === undefined) delete process.env.WEBSITE_REVALIDATE_URL;
    if (prevEnv.secret === undefined) delete process.env.WEBSITE_REVALIDATE_SECRET;
    server.close();
    await prisma.testimonial.deleteMany({ where: { orgId: { in: [org.id, otherOrg.id] } } });
  }
});
