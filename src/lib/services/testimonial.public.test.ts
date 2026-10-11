import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { TestimonialService } from "./testimonial.service";
import { AuditService } from "./audit.service";
import { ActivityFeedService } from "./activity.service";
import { publicTestimonialSchema } from "@/lib/validations/public-testimonial.schema";
import { AppError } from "@/lib/utils/errors";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const COURSE = "00000000-0000-4000-8000-0000000000c1";

function harness(courses: { id: string; orgId: string; status: string }[] = []) {
  const created: any[] = [];
  const orig = {
    course: prisma.course.findFirst,
    create: prisma.testimonial.create,
    evt: prisma.internalEvent.create,
    audit: AuditService.write,
    feed: ActivityFeedService.write,
    err: console.error,
  };
  (prisma.course as any).findFirst = async (a: any) =>
    courses.find((c) => c.id === a.where.id && c.orgId === a.where.orgId && c.status === a.where.status) ?? null;
  (prisma.testimonial as any).create = async (a: any) => {
    created.push(a.data);
    return { id: "t1", status: a.data.status, isFeatured: a.data.isFeatured, createdAt: new Date() };
  };
  (prisma.internalEvent as any).create = async () => { throw new Error("events disabled in unit test"); };
  (AuditService as any).write = async () => {};
  (ActivityFeedService as any).write = async () => {};
  console.error = () => {};
  return {
    created,
    restore() {
      (prisma.course as any).findFirst = orig.course;
      (prisma.testimonial as any).create = orig.create;
      (prisma.internalEvent as any).create = orig.evt;
      (AuditService as any).write = orig.audit;
      (ActivityFeedService as any).write = orig.feed;
      console.error = orig.err;
    },
  };
}

const valid = {
  authorName: "Aman Gupta",
  content: "Ground classes were clear and the instructors were always available.",
  consent: true as const,
};

test("public submission is always PENDING, never featured, org server-derived", async () => {
  const h = harness();
  try {
    const input = publicTestimonialSchema.parse({ ...valid, status: "APPROVED", isFeatured: true, orgId: "evil", order: -1 } as any);
    const out = await TestimonialService.submitPublic(ORG, input);
    assert.equal(out.status, "PENDING");
    assert.equal(out.isFeatured, false);
    assert.equal(h.created[0].orgId, ORG);
    assert.equal(h.created[0].status, "PENDING");
    assert.equal(h.created[0].isFeatured, false);
    assert.equal(h.created[0].source, "public_form");
    assert.equal("order" in h.created[0], false);
  } finally {
    h.restore();
  }
});

test("courseId must be a published course of the same org", async () => {
  const h = harness([{ id: COURSE, orgId: "00000000-0000-4000-8000-0000000000bb", status: "PUBLISHED" }]);
  try {
    await assert.rejects(
      TestimonialService.submitPublic(ORG, publicTestimonialSchema.parse({ ...valid, courseId: COURSE })),
      (e: unknown) => e instanceof AppError && e.statusCode === 400,
    );
    assert.equal(h.created.length, 0);
  } finally {
    h.restore();
  }
  const h2 = harness([{ id: COURSE, orgId: ORG, status: "PUBLISHED" }]);
  try {
    await TestimonialService.submitPublic(ORG, publicTestimonialSchema.parse({ ...valid, courseId: COURSE }));
    assert.equal(h2.created[0].courseId, COURSE);
  } finally {
    h2.restore();
  }
});

test("strict validation: markup, too short, no consent, bad rating are rejected", () => {
  const bad = [
    { ...valid, content: "short" },
    { ...valid, content: "<script>alert(1)</script> this is long enough to pass length" },
    { ...valid, authorName: "<b>x</b>" },
    { ...valid, consent: false },
    { ...valid, rating: 6 },
    { ...valid, authorEmail: "nope" },
  ];
  for (const b of bad) assert.equal(publicTestimonialSchema.safeParse(b).success, false, JSON.stringify(b));
  assert.equal(publicTestimonialSchema.parse({ ...valid, authorEmail: "", authorTitle: "" }).authorEmail, undefined);
});
