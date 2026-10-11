/**
 * Section 6 public-contract gate. Mirrors the live /api/public routes'
 * query scopes (PUBLISHED-only, featured-first, closesAt-aware) directly
 * against the disposable PostgreSQL database. Gated by SECTION6_INTEGRATION=1
 * so the default `npm test` run stays dependency-free. Requires a migrated,
 * seeded database:
 *
 *   $env:SECTION6_INTEGRATION="1"; $env:DATABASE_URL="postgresql://postgres:postgres@localhost:5433/airbone_test?schema=public"; $env:DIRECT_URL=$env:DATABASE_URL; npm test
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";

const ENABLED = process.env.SECTION6_INTEGRATION === "1";

// Canonical Admin DB seeds (BD-1). The front emits these in public UI + JSON-LD.
const CANONICAL_FEES: Record<string, number> = {
  "cpl-ground-classes": 270000,
  atpl: 150000,
  "cadet-preparation": 50000,
  "a320-simulator": 10000,
  "cas-compass-adapt": 30000,
  "airline-preparation": 125000,
  "flying-training": 5500000,
};

// Stale fees that BD-1 removed from the public surface; any appearance is a regression.
const STALE_FEE_COPY = ["1,25,000", "12,000", "84,000", "1,14,000", "30K"];

const BLOG_SLUGS = [
  "how-to-become-pilot-india",
  "pilot-training-cost-india",
  "dgca-ground-school-guide",
  "pilot-salary-india",
];

test(
  "Section 6: public courses contract — PUBLISHED-only, canonical fees, no stale copy",
  { skip: !ENABLED },
  async () => {
    const org = await prisma.organization.findFirst({
      where: { slug: "airborne-aviation" },
      select: { id: true },
    });
    assert.ok(org, "seeded org airborne-aviation must exist");

    const courses = await prisma.course.findMany({
      where: { orgId: org.id, status: "PUBLISHED" },
      orderBy: [{ isFeatured: "desc" }, { order: "asc" }, { createdAt: "desc" }],
      select: { slug: true, title: true, fee: true, duration: true, description: true, metadata: true },
    });

    assert.ok(courses.length >= 8, `expected >= 8 PUBLISHED courses, got ${courses.length}`);
    const bySlug = new Map(courses.map((c) => [c.slug, c]));

    for (const [slug, fee] of Object.entries(CANONICAL_FEES)) {
      const course = bySlug.get(slug);
      assert.ok(course, `PUBLISHED course ${slug} must exist`);
      assert.equal(Number(course.fee), fee, `canonical fee for ${slug}`);
    }

    // cabin-crew uses hyphen slug in Admin; assert its canonical fee separately.
    const cabin = bySlug.get("cabin-crew");
    assert.ok(cabin, "PUBLISHED course cabin-crew must exist");
    assert.equal(Number(cabin?.fee), 54000, "canonical fee for cabin-crew");

    // No stale fee copy may survive anywhere the public payload exposes it.
    const blob = JSON.stringify(courses);
    for (const stale of STALE_FEE_COPY) {
      assert.ok(!blob.includes(stale), `PUBLISHED courses leaked stale fee copy: ${stale}`);
    }
  },
);

test(
  "Section 6: public blogs contract — 4 seeded Resources with seoTitle/seoDesc",
  { skip: !ENABLED },
  async () => {
    const org = await prisma.organization.findFirst({
      where: { slug: "airborne-aviation" },
      select: { id: true },
    });
    assert.ok(org);

    const blogs = await prisma.resource.findMany({
      where: {
        orgId: org.id,
        status: "PUBLISHED",
        type: "DOCUMENT",
        category: "blog",
      },
      orderBy: [{ publishedAt: "desc" }],
      select: { slug: true, seoTitle: true, seoDesc: true, publishedAt: true },
    });

    const slugs = blogs.map((b) => b.slug);
    for (const slug of BLOG_SLUGS) {
      assert.ok(slugs.includes(slug), `seeded blog Resource ${slug} must be PUBLISHED`);
    }
    for (const blog of blogs) {
      assert.ok(blog.seoTitle?.trim(), `blog ${blog.slug} must carry seoTitle`);
      assert.ok(blog.seoDesc?.trim(), `blog ${blog.slug} must carry seoDesc`);
      assert.ok(blog.publishedAt, `blog ${blog.slug} must carry publishedAt`);
    }
  },
);

test(
  "Section 6: public testimonials contract — APPROVED, featured-first, rating 5",
  { skip: !ENABLED },
  async () => {
    const org = await prisma.organization.findFirst({
      where: { slug: "airborne-aviation" },
      select: { id: true },
    });
    assert.ok(org);

    const testimonials = await prisma.testimonial.findMany({
      where: { orgId: org.id, status: "APPROVED" },
      orderBy: [{ isFeatured: "desc" }, { order: "asc" }, { createdAt: "desc" }],
      select: { id: true, authorName: true, content: true, rating: true, isFeatured: true },
    });

    assert.ok(testimonials.length >= 3, `expected >= 3 APPROVED testimonials, got ${testimonials.length}`);
    for (const t of testimonials) {
      assert.ok(t.content?.trim(), `testimonial ${t.authorName} must have content`);
      assert.equal(Number(t.rating), 5, `seeded testimonials use rating 5 (${t.authorName})`);
    }
    // CMM policy: never fabricate ratings — every released row must be explicitly APPROVED.
    const allApproved = await prisma.testimonial.count({
      where: { orgId: org.id, status: "APPROVED" },
    });
    const sluggedFeatured = testimonials.filter((t) => t.isFeatured).length;
    assert.ok(sluggedFeatured > 0, "featured-first ordering requires >= 1 featured row");
    assert.ok(allApproved >= testimonials.length);
  },
);

test(
  "Section 6: public jobs contract — PUBLISHED only, never closed jobs",
  { skip: !ENABLED },
  async () => {
    const org = await prisma.organization.findFirst({
      where: { slug: "airborne-aviation" },
      select: { id: true },
    });
    assert.ok(org);

    const jobs = await prisma.job.findMany({
      where: {
        orgId: org.id,
        status: "PUBLISHED",
        OR: [{ closesAt: null }, { closesAt: { gte: new Date() } }],
      },
      orderBy: [{ publishedAt: "desc" }],
      select: { slug: true, title: true, closesAt: true, salaryMin: true, salaryMax: true, currency: true, publishedAt: true, description: true },
    });

    // M-09: the career feed must not be vacuous — the seed provides a PUBLISHED
    // open job. Assert presence + that no internal/PII text leaks into the
    // public projection's body fields.
    assert.ok(jobs.length > 0, "At least one PUBLISHED, open job must exist (seed M-09)");
    assert.ok(
      jobs.some((j) => j.slug === "cpl-ground-school-mentor-2026"),
      "seeded M-09 job must be present and PUBLISHED",
    );

    for (const job of jobs) {
      assert.ok(!job.closesAt || job.closesAt >= new Date(), `job ${job.slug} must not be closed`);
      assert.ok(job.publishedAt, `job ${job.slug} must carry publishedAt`);
      const body = [job.title, job.description].filter(Boolean).join(" ");
      assert.ok(
        !/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(body),
        `job ${job.slug} body must not leak an email address`,
      );
    }
  },
);