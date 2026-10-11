import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { checkMaintenance } from "@/lib/middleware/maintenance";
import { handleError } from "@/lib/utils/response";

export async function GET(req: NextRequest) {
  try {
    await checkMaintenance();
    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: { id: true },
    });

    if (!org) return NextResponse.json({ data: [] });

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 100);

    const placements = await prisma.placement.findMany({
      where: { orgId: org.id, status: "CONFIRMED", isPublic: true },
      orderBy: { joiningDate: "desc" },
      take: limit,
      select: {
        id: true,
        jobTitle: true,
        package: true,
        currency: true,
        joiningDate: true,
        batchYear: true,
        hiringPartner: {
          select: {
            name: true,
            logoId: true,
          },
        },
      },
    });

    return NextResponse.json({ data: placements });
  } catch (err) {
    return handleError(err);
  }
}
