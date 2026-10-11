import test from "node:test";
import assert from "node:assert/strict";
import { ValidationError } from "@/lib/utils/errors";
import { courseEligibility, evaluateEligibility, questionsFromMetadata, resolveCourseSlug } from "./eligibility";

test("website course labels resolve to the right course slug", () => {
  const cases: Array<[string, string | null]> = [
    ["DGCA CPL Ground Classes (₹2,70,000)", "ground-school"],
    ["Commercial Pilot License (CPL)", "commercial-pilot-license-cpl"],
    ["Cadet Preparation (₹50,000)", "cadet-preparation"],
    ["Airline Preparation (₹1,25,000)", "airline-preparation"],
    ["Comprehensive Airline Preparation Program (₹1,25,000)", "airline-preparation"],
    ["CPL & Airline Preparation", "airline-preparation"],
    ["GD & PI Course (₹30,000)", "gd-pi"],
    ["CASS Compass Adapt (₹30,000)", "cas-compass-adapt"],
    ["ATPL Ground School (₹1,50,000)", "atpl"],
    ["Airbus A320 Simulator FBS (₹10,000)", "a320-simulator"],
    ["Securing Your Child's Future in Aviation", "securing-your-childs-future-in-aviation"],
    ["Cabin Crew Training (₹54,000)", "cabin-crew-training"],
    ["Private Pilot License (PPL)", "private-pilot-license"],
    ["atpl", "atpl"],
    ["Flying Training Counselling (India vs Abroad)", null],
    ["", null],
  ];
  for (const [label, slug] of cases) assert.equal(resolveCourseSlug(label), slug, label);
});

test("question set changes with the selected course", () => {
  const cpl = courseEligibility("Commercial Pilot License (CPL)").questions.map((q) => q.key);
  const cabin = courseEligibility("Cabin Crew Training (₹54,000)").questions.map((q) => q.key);
  const atpl = courseEligibility("ATPL Ground School").questions.map((q) => q.key);
  assert.deepEqual(cpl, ["age17", "class12PhysicsMaths", "eyesight"]);
  assert.deepEqual(cabin, ["age18to27", "height", "class12"]);
  assert.deepEqual(atpl, ["age21", "cplTheory"]);
  assert.deepEqual(courseEligibility("GD & PI Course").questions, []);
  assert.deepEqual(courseEligibility("Unknown thing"), { courseSlug: null, questions: [] });
});

test("Course.metadata.eligibilityQuestions overrides the built-in set when valid", () => {
  const metadata = { eligibilityQuestions: [{ key: "medical", label: "Do you hold a Class 2 medical?" }] };
  assert.deepEqual(courseEligibility("cadet-preparation", metadata).questions, [
    { key: "medical", label: "Do you hold a Class 2 medical?" },
  ]);
  assert.equal(questionsFromMetadata({ eligibilityQuestions: [{ key: "bad key", label: "x" }] }), null);
  assert.equal(questionsFromMetadata({ eligibilityQuestions: [{ key: "a", label: "x" }, { key: "a", label: "y" }] }), null);
  assert.equal(questionsFromMetadata(null), null);
  // Invalid override falls back to the built-in set.
  assert.equal(courseEligibility("cadet-preparation", { eligibilityQuestions: "nope" }).questions.length, 3);
});

test("evaluateEligibility scores answers and rejects foreign keys or values", () => {
  const cabin = courseEligibility("cabin-crew-training");
  assert.equal(evaluateEligibility(cabin, { age18to27: "yes", height: "yes", class12: "yes" }).result, "eligible");
  assert.equal(evaluateEligibility(cabin, { age18to27: "yes", height: "no", class12: "yes" }).result, "review");
  assert.equal(evaluateEligibility(cabin, { age18to27: "yes" }).result, "review");
  assert.equal(evaluateEligibility(courseEligibility("gd-pi"), {}).result, "not_applicable");
  const evaluated = evaluateEligibility(cabin, { height: "no" });
  assert.deepEqual(evaluated, { course: "cabin-crew-training", answers: { height: "no" }, result: "review" });

  // A pilot question is not valid for cabin crew.
  assert.throws(() => evaluateEligibility(cabin, { age17: "yes" }), ValidationError);
  assert.throws(() => evaluateEligibility(cabin, { height: "maybe" }), ValidationError);
  assert.throws(() => evaluateEligibility(cabin, ["yes"]), ValidationError);
  assert.throws(() => evaluateEligibility(cabin, null), ValidationError);
});
