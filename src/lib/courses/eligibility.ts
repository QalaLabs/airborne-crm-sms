import { ValidationError } from "@/lib/utils/errors";

/**
 * Course-specific eligibility pre-check for public enquiries.
 *
 * Questions come from the eligibility facts already published for each course
 * (course pages / registry). A course can override its set through
 * `Course.metadata.eligibilityQuestions` ([{ key, label }]) without a schema
 * change. Answers are advisory: they never block an enquiry, but they are
 * validated against the selected course's question set and stored on the lead.
 */

export interface EligibilityQuestion {
  key: string;
  label: string;
}

export interface CourseEligibility {
  courseSlug: string | null;
  questions: EligibilityQuestion[];
}

export type EligibilityAnswer = "yes" | "no";
export type EligibilityResult = "eligible" | "review" | "not_applicable";

export interface EvaluatedEligibility {
  course: string | null;
  answers: Record<string, EligibilityAnswer>;
  result: EligibilityResult;
}

const PILOT_ENTRY: EligibilityQuestion[] = [
  { key: "age17", label: "Are you at least 17 years old?" },
  { key: "class12PhysicsMaths", label: "Have you passed Class 12th (10+2) with Physics & Mathematics?" },
  { key: "eyesight", label: "Is your eyesight correctable to 6/6 (you can wear glasses/contacts)?" },
];

const CABIN_CREW: EligibilityQuestion[] = [
  { key: "age18to27", label: "Is your age between 18 and 27 years?" },
  { key: "height", label: "Is your height at least 157 cm (Females) or 170 cm (Males)?" },
  { key: "class12", label: "Have you completed Class 12th (10+2) or equivalent?" },
];

const ATPL: EligibilityQuestion[] = [
  { key: "age21", label: "Are you at least 21 years old?" },
  { key: "cplTheory", label: "Have you completed, or are you currently pursuing, CPL theory?" },
];

const CPL_HOLDER: EligibilityQuestion[] = [
  { key: "cplHolder", label: "Do you hold a Commercial Pilot License (CPL)?" },
];

const CPL_OR_TRAINING: EligibilityQuestion[] = [
  { key: "cplOrTraining", label: "Do you hold a CPL, or are you currently in CPL / cadet pilot training?" },
];

/** Built-in question sets by course slug. Courses absent here have no pre-check. */
export const COURSE_ELIGIBILITY: Readonly<Record<string, EligibilityQuestion[]>> = Object.freeze({
  "ground-school": PILOT_ENTRY,
  "commercial-pilot-license-cpl": PILOT_ENTRY,
  "private-pilot-license": PILOT_ENTRY,
  "cadet-preparation": PILOT_ENTRY,
  "cas-compass-adapt": PILOT_ENTRY,
  "cabin-crew-training": CABIN_CREW,
  atpl: ATPL,
  "airline-preparation": CPL_HOLDER,
  "a320-simulator": CPL_OR_TRAINING,
  "gd-pi": [],
  "securing-your-childs-future-in-aviation": [],
});

// Most specific first: "ATPL Ground School" must not resolve to the CPL ground school.
const COURSE_ALIASES: ReadonlyArray<[RegExp, string]> = [
  [/\batpl\b/, "atpl"],
  [/\ba320\b|simulator/, "a320-simulator"],
  [/cabin/, "cabin-crew-training"],
  [/airline prep/, "airline-preparation"],
  [/\bcass?\b|compass|adapt/, "cas-compass-adapt"],
  [/\bgd\b.*\bpi\b|gd-pi/, "gd-pi"],
  [/cadet/, "cadet-preparation"],
  [/\bppl\b|private pilot/, "private-pilot-license"],
  [/child/, "securing-your-childs-future-in-aviation"],
  [/ground (school|classes)/, "ground-school"],
  [/\bcpl\b|commercial pilot/, "commercial-pilot-license-cpl"],
];

/** Course slug for an enquiry's course text (slug or website label), or null when unknown. */
export function resolveCourseSlug(courseInterest: string | null | undefined): string | null {
  const text = String(courseInterest ?? "").trim().toLowerCase();
  if (!text) return null;
  if (Object.prototype.hasOwnProperty.call(COURSE_ELIGIBILITY, text)) return text;
  for (const [pattern, slug] of COURSE_ALIASES) if (pattern.test(text)) return slug;
  return null;
}

/** Valid question override stored on Course.metadata, or null to use the built-in set. */
export function questionsFromMetadata(metadata: unknown): EligibilityQuestion[] | null {
  const raw = (metadata as { eligibilityQuestions?: unknown } | null)?.eligibilityQuestions;
  if (!Array.isArray(raw)) return null;
  const seen = new Set<string>();
  const questions: EligibilityQuestion[] = [];
  for (const q of raw) {
    const key = typeof q?.key === "string" ? q.key.trim() : "";
    const label = typeof q?.label === "string" ? q.label.trim() : "";
    if (!/^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(key) || !label || label.length > 300 || seen.has(key)) return null;
    seen.add(key);
    questions.push({ key, label });
  }
  return questions.length <= 10 ? questions : null;
}

export function courseEligibility(courseInterest: string | null | undefined, metadata?: unknown): CourseEligibility {
  const courseSlug = resolveCourseSlug(courseInterest);
  if (!courseSlug) return { courseSlug: null, questions: [] };
  return { courseSlug, questions: questionsFromMetadata(metadata) ?? COURSE_ELIGIBILITY[courseSlug] ?? [] };
}

/**
 * Validates answers against the course's question set and scores them.
 * Unknown keys or values are rejected; unanswered questions mean "review".
 */
export function evaluateEligibility(eligibility: CourseEligibility, answers: unknown): EvaluatedEligibility {
  if (answers === null || typeof answers !== "object" || Array.isArray(answers)) {
    throw new ValidationError([{ path: ["eligibility"], message: "eligibility must be an object of question answers" }]);
  }
  const allowed = new Set(eligibility.questions.map((q) => q.key));
  const clean: Record<string, EligibilityAnswer> = {};
  for (const [key, value] of Object.entries(answers as Record<string, unknown>)) {
    if (!allowed.has(key)) {
      throw new ValidationError([{ path: ["eligibility", key], message: `${key} is not a question for this course` }]);
    }
    if (value !== "yes" && value !== "no") {
      throw new ValidationError([{ path: ["eligibility", key], message: `${key} must be "yes" or "no"` }]);
    }
    clean[key] = value;
  }
  const result: EligibilityResult =
    eligibility.questions.length === 0
      ? "not_applicable"
      : eligibility.questions.every((q) => clean[q.key] === "yes")
        ? "eligible"
        : "review";
  return { course: eligibility.courseSlug, answers: clean, result };
}
