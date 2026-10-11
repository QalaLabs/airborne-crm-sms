import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { TestimonialService } from "./testimonial.service";
import { testimonialFiltersSchema } from "@/lib/validations/testimonial.schema";
import type { RequestContext } from "@/types";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const ctx = { orgId: ORG, user: { id: "u1", orgId: ORG, role: "ADMIN" }, requestId: "r", ipAddress: "x", userAgent: "t" } as unknown as RequestContext;

type Row = { id: string; orgId: string; status: string; authorName: string; content: string };

function seed(pending: number, approved: number, otherOrgPending = 0): Row[] {
  const rows: Row[] = [];
  for (let i = 0; i < pending; i++) rows.push({ id: `p${i}`, orgId: ORG, status: "PENDING", authorName: `P${i}`, content: "x" });
  for (let i = 0; i < approved; i++) rows.push({ id: `a${i}`, orgId: ORG, status: "APPROVED", authorName: `A${i}`, content: "x" });
  for (let i = 0; i < otherOrgPending; i++) rows.push({ id: `o${i}`, orgId: "other", status: "PENDING", authorName: `O${i}`, content: "x" });
  return rows;
}

function matches(row: Row, where: any) {
  return Object.entries(where ?? {}).every(([k, v]) => (k === "OR" ? true : (row as any)[k] === v));
}

function harness(rows: Row[]) {
  const orig = { count: prisma.testimonial.count, findMany: prisma.testimonial.findMany };
  const countWheres: any[] = [];
  (prisma.testimonial as any).count = async (a: any) => {
    countWheres.push(a.where);
    return rows.filter((r) => matches(r, a.where)).length;
  };
  (prisma.testimonial as any).findMany = async (a: any) =>
    rows.filter((r) => matches(r, a.where)).slice(a.skip ?? 0, (a.skip ?? 0) + (a.take ?? rows.length));
  return {
    countWheres,
    restore() {
      (prisma.testimonial as any).count = orig.count;
      (prisma.testimonial as any).findMany = orig.findMany;
    },
  };
}

for (const [label, pending] of [["zero", 0], ["one", 1], ["more than one page", 57]] as const) {
  test(`pending count is canonical (${label})`, async () => {
    const h = harness(seed(pending, 30, 4));
    try {
      assert.equal(await TestimonialService.getPendingCount(ctx), pending);
      assert.deepEqual(h.countWheres.at(-1), { orgId: ORG, status: "PENDING" });
    } finally {
      h.restore();
    }
  });
}

test("pending count ignores list pagination and active filters", async () => {
  const h = harness(seed(57, 30));
  try {
    const page2Approved = testimonialFiltersSchema.parse({ page: "2", limit: "10", status: "APPROVED" });
    const list = await TestimonialService.list(ctx, page2Approved);
    const rowsPending = list.data.filter((t: any) => t.status === "PENDING").length;
    assert.equal(rowsPending, 0, "a page-derived count would show 0 here");
    assert.equal(await TestimonialService.getPendingCount(ctx), 57);

    const firstPageAll = await TestimonialService.list(ctx, testimonialFiltersSchema.parse({ page: "1", limit: "20" }));
    assert.ok(firstPageAll.data.length <= 20);
    assert.equal(await TestimonialService.getPendingCount(ctx), 57);
  } finally {
    h.restore();
  }
});

test("header and sidebar share one query key and count parser", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const page = src("src/app/(dashboard)/testimonials/page.tsx");
  const sidebar = src("src/components/layout/sidebar.tsx");
  assert.match(page, /usePendingTestimonialCount\(\)/);
  assert.match(sidebar, /usePendingTestimonialCount\(\)/);
  assert.doesNotMatch(page, /filter\(\(t\) => t\.status === "PENDING"\)/);
});
