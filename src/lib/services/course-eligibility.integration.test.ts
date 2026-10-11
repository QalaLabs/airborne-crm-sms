/**
 * Course-specific eligibility pre-check through the public intake API against a
 * disposable PostgreSQL database. Gated by SECTION5_INTEGRATION=1.
 *
 *   npm run test:local
 */
import test from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { POST as intake } from "@/app/api/public/leads/route";
import { GET as eligibilityApi } from "@/app/api/public/courses/eligibility/route";
import { getCourseEligibility } from "@/lib/services/course-eligibility.service";

const ENABLED = process.env.SECTION5_INTEGRATION === "1";
const KEY = "eligibility-test-intake-key";

let SEQ = 0;
const suffix = () => `${Date.now()}-${(SEQ++).toString(36)}`;
const phone = () => `94${Date.now().toString().slice(-6)}${String(SEQ++).padStart(4, "0")}`.slice(0, 12);

function post(body: Record<string, unknown>, ip: string) {
  return intake(
    new NextRequest("http://admin.test/api/public/leads", {
      method: "POST",
      headers: { "content-type": "application/json", "x-intake-key": KEY, "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

test("public eligibility: questions follow the course, answers are validated and persisted per org", { skip: !ENABLED }, async () => {
  const s = suffix();
  const org = await prisma.organization.create({ data: { name: `Elig-${s}`, slug: `elig-${s}` } });
  const other = await prisma.organization.create({ data: { name: `EligOther-${s}`, slug: `elig-other-${s}` } });
  // Org-specific override lives on that org's Course.metadata only.
  await prisma.course.create({
    data: {
      orgId: other.id,
      title: "Cadet Preparation",
      slug: "cadet-preparation",
      metadata: { eligibilityQuestions: [{ key: "medical", label: "Do you hold a Class 2 medical?" }] },
    },
  });

  const prev = { key: process.env.PUBLIC_INTAKE_KEY, slug: process.env.PUBLIC_ORG_SLUG };
  process.env.PUBLIC_INTAKE_KEY = KEY;
  process.env.PUBLIC_ORG_SLUG = org.slug;
  try {
    const questions = async (course: string) =>
      (await (await eligibilityApi(new NextRequest(`http://admin.test/api/public/courses/eligibility?course=${encodeURIComponent(course)}`))).json()).data;

    const cabin = await questions("Cabin Crew Training (₹54,000)");
    assert.equal(cabin.courseSlug, "cabin-crew-training");
    assert.deepEqual(cabin.questions.map((q: { key: string }) => q.key), ["age18to27", "height", "class12"]);
    const cpl = await questions("Commercial Pilot License (CPL)");
    assert.deepEqual(cpl.questions.map((q: { key: string }) => q.key), ["age17", "class12PhysicsMaths", "eyesight"]);
    assert.deepEqual((await questions("GD & PI Course")).questions, []);

    // Org isolation: the other org's metadata override is not served to this org.
    assert.equal((await questions("Cadet Preparation")).questions.length, 3);
    assert.deepEqual((await getCourseEligibility(other.id, "cadet-preparation")).questions.map((q) => q.key), ["medical"]);

    const ip = `10.77.${SEQ % 250}.${(Date.now() % 250) + 1}`;
    const okPhone = phone();
    const created = await post(
      { name: "Elig Pass", phone: okPhone, courseInterest: "Cabin Crew Training (₹54,000)", source: "course_page", eligibility: { age18to27: "yes", height: "yes", class12: "yes" } },
      ip,
    );
    assert.equal(created.status, 201);
    assert.deepEqual((await created.json()).eligibility, { course: "cabin-crew-training", result: "eligible" });
    const stored = await prisma.lead.findFirstOrThrow({ where: { orgId: org.id, phone: okPhone } });
    const saved = (stored.customFields as { eligibility?: Record<string, unknown> }).eligibility!;
    assert.equal(saved.course, "cabin-crew-training");
    assert.equal(saved.result, "eligible");
    assert.deepEqual(saved.answers, { age18to27: "yes", height: "yes", class12: "yes" });
    assert.ok(typeof saved.evaluatedAt === "string");

    // A pilot question is rejected for cabin crew and nothing is created.
    const badPhone = phone();
    const rejected = await post({ name: "Elig Bad", phone: badPhone, courseInterest: "Cabin Crew Training", eligibility: { age17: "yes" } }, ip);
    assert.equal(rejected.status, 400);
    assert.equal(await prisma.lead.count({ where: { orgId: org.id, phone: badPhone } }), 0);

    // Switching course changes the accepted set; partial "no" means counsellor review.
    const reviewPhone = phone();
    const review = await post({ name: "Elig Review", phone: reviewPhone, courseInterest: "ATPL Ground School", eligibility: { age21: "yes", cplTheory: "no" } }, ip);
    assert.equal(review.status, 201);
    assert.deepEqual((await review.json()).eligibility, { course: "atpl", result: "review" });

    // No answers: lead is created exactly as before, with no eligibility stored.
    const plainPhone = phone();
    const plain = await post({ name: "Elig Plain", phone: plainPhone, courseInterest: "ATPL Ground School" }, ip);
    assert.equal(plain.status, 201);
    assert.equal((await plain.json()).eligibility, null);
    const plainLead = await prisma.lead.findFirstOrThrow({ where: { orgId: org.id, phone: plainPhone } });
    assert.equal((plainLead.customFields as Record<string, unknown>).eligibility, undefined);

    assert.equal(await prisma.lead.count({ where: { orgId: other.id } }), 0, "intake stays in the public org");
  } finally {
    if (prev.key === undefined) delete process.env.PUBLIC_INTAKE_KEY;
    else process.env.PUBLIC_INTAKE_KEY = prev.key;
    if (prev.slug === undefined) delete process.env.PUBLIC_ORG_SLUG;
    else process.env.PUBLIC_ORG_SLUG = prev.slug;
  }
});
