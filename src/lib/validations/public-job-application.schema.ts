import { z } from "zod";
import { isHttpUrl } from "@/lib/utils/safe-url";

const NO_MARKUP = /^[^<>]*$/;

export const publicJobApplicationSchema = z.object({
  jobId: z.string().uuid(),
  applicantName: z.string().trim().min(2).max(120).regex(NO_MARKUP, "name must not contain markup"),
  applicantEmail: z.string().trim().toLowerCase().email().max(255),
  applicantPhone: z
    .string()
    .trim()
    .transform((v) => v.replace(/[\s-]/g, ""))
    .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "phone must be 7-15 digits")),
  resumeUrl: z
    .string()
    .trim()
    .max(2000)
    .refine(isHttpUrl, "resumeUrl must be an http(s) link")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  coverLetter: z.string().trim().max(5000).regex(NO_MARKUP, "cover letter must not contain markup").optional(),
  consent: z.literal(true, { errorMap: () => ({ message: "consent is required" }) }),
});

export type PublicJobApplicationInput = z.infer<typeof publicJobApplicationSchema>;
