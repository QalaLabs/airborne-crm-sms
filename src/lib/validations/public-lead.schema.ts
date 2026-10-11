import { z } from "zod";

export const publicLeadSchema = z.object({
  name: z.string().trim().min(2).max(200),
  email: z.string().trim().email().max(255).nullish(),
  phone: z
    .string()
    .trim()
    .min(7)
    .max(20)
    .regex(/^[+\d][\d\s\-()]*$/, "phone must contain digits, spaces, dashes or parentheses"),
  courseInterest: z.string().trim().max(255).nullish(),
  pincode: z.string().trim().max(10).nullish(),
  source: z.string().trim().max(50).optional(),
  utmSource: z.string().trim().max(255).nullish(),
  utmMedium: z.string().trim().max(255).nullish(),
  utmCampaign: z.string().trim().max(255).nullish(),
  utmTerm: z.string().trim().max(255).nullish(),
  utmContent: z.string().trim().max(255).nullish(),
  referrerUrl: z.string().trim().max(2000).nullish(),
  landingPage: z.string().trim().max(2000).nullish(),
  // Client/edge-generated idempotency key for a single submission attempt.
  // Replays of the same submission (same leadUuid) resolve to the original lead
  // instead of a false 409. Genuinely new submissions always generate a new key.
  leadUuid: z.string().trim().min(1).max(64).nullish(),
  // Course eligibility pre-check answers ({ questionKey: "yes" | "no" }); validated
  // against the selected course's question set by the intake route.
  eligibility: z.record(z.string().max(40), z.unknown()).nullish(),
});

export type PublicLeadInput = z.infer<typeof publicLeadSchema>;
