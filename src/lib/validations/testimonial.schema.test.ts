import test from "node:test";
import assert from "node:assert/strict";
import { testimonialFiltersSchema, updateTestimonialSchema, reviewTestimonialSchema } from "./testimonial.schema";

test("isFeatured query string is parsed instead of rejected", () => {
  assert.equal(testimonialFiltersSchema.parse({ isFeatured: "true" }).isFeatured, true);
  assert.equal(testimonialFiltersSchema.parse({ isFeatured: "false" }).isFeatured, false);
  assert.equal(testimonialFiltersSchema.parse({}).isFeatured, undefined);
  assert.throws(() => testimonialFiltersSchema.parse({ isFeatured: "yes" }));
});

test("update accepts an avatar change, avatar removal and display order", () => {
  const id = "3f1c1d8e-8b5e-4c6e-9a63-0d0b9e3b1a11";
  assert.equal(updateTestimonialSchema.parse({ avatarId: id }).avatarId, id);
  assert.equal(updateTestimonialSchema.parse({ avatarId: null }).avatarId, null);
  assert.equal(updateTestimonialSchema.parse({ order: 3 }).order, 3);
  assert.throws(() => updateTestimonialSchema.parse({ order: -1 }));
  assert.throws(() => updateTestimonialSchema.parse({ avatarId: "not-a-uuid" }));
});

test("review only accepts publish (APPROVED) or unpublish (REJECTED)", () => {
  assert.equal(reviewTestimonialSchema.parse({ status: "APPROVED" }).status, "APPROVED");
  assert.equal(reviewTestimonialSchema.parse({ status: "REJECTED" }).status, "REJECTED");
  assert.throws(() => reviewTestimonialSchema.parse({ status: "PENDING" }));
});
