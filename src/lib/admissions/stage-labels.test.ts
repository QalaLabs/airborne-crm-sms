import test from "node:test";
import assert from "node:assert/strict";
import { ADMISSION_STAGE_FLOW, admissionStageLabel, canonicalAdmissionStage } from "./stage-labels";
import { STAGE_TRANSITIONS } from "../validations/admission.schema";
import { canTransitionDealStage } from "../validations/deal.schema";

test("flow lists exactly the six operational stages in order", () => {
  assert.deepEqual(
    ADMISSION_STAGE_FLOW.map(admissionStageLabel),
    ["Prospect / Enquiry", "Admission", "Verification", "Enrolled", "Cancelled", "Dropped"],
  );
});

test("legacy stages fold into Admission", () => {
  for (const s of ["DOCUMENT_COLLECTION", "OFFER_LETTER", "FEE_PAYMENT"]) {
    assert.equal(canonicalAdmissionStage(s), "FEE_PAYMENT");
    assert.equal(admissionStageLabel(s), "Admission");
  }
  assert.equal(canonicalAdmissionStage("VERIFICATION"), "VERIFICATION");
});

test("every flow stage is reachable in both directions between Enquiry, Admission and Verification", () => {
  const hop = (a: string, b: string) => (STAGE_TRANSITIONS as Record<string, string[]>)[a]?.includes(b);
  for (const [a, b] of [["ENQUIRY", "FEE_PAYMENT"], ["FEE_PAYMENT", "VERIFICATION"], ["VERIFICATION", "FEE_PAYMENT"], ["FEE_PAYMENT", "ENQUIRY"]]) {
    assert.ok(hop(a!, b!), `${a} -> ${b}`);
  }
  assert.ok(canTransitionDealStage("VERIFICATION", "FEE_PAYMENT"));
});
