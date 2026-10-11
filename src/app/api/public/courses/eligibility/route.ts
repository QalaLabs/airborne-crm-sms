import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { checkMaintenance } from "@/lib/middleware/maintenance";
import { handleError } from "@/lib/utils/response";
import { getCourseEligibility } from "@/lib/services/course-eligibility.service";

export async function GET(req: NextRequest) {
  try {
    await checkMaintenance();
    const course = (new URL(req.url).searchParams.get("course") ?? "").slice(0, 255);
    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: { id: true },
    });
    if (!org) return NextResponse.json({ data: { courseSlug: null, questions: [] } });
    return NextResponse.json({ data: await getCourseEligibility(org.id, course) });
  } catch (err) {
    return handleError(err);
  }
}
