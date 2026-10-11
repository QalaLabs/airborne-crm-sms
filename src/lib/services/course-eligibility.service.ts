import { prisma } from "@/lib/db/client";
import { courseEligibility, type CourseEligibility } from "@/lib/courses/eligibility";

/** Eligibility questions for an enquiry's course in this org, honouring a Course.metadata override. */
export async function getCourseEligibility(orgId: string, courseInterest: string | null | undefined): Promise<CourseEligibility> {
  const base = courseEligibility(courseInterest);
  if (!base.courseSlug) return base;
  const course = await prisma.course.findFirst({
    where: { orgId, slug: base.courseSlug },
    select: { metadata: true },
  });
  return courseEligibility(courseInterest, course?.metadata);
}
