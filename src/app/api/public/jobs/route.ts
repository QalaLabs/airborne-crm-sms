import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { checkMaintenance } from "@/lib/middleware/maintenance";
import { handleError } from "@/lib/utils/response";

const JOB_SELECT = {
  id: true,
  slug: true,
  title: true,
  description: true,
  requirements: true,
  location: true,
  isRemote: true,
  jobType: true,
  salaryMin: true,
  salaryMax: true,
  currency: true,
  experienceYears: true,
  closesAt: true,
  tags: true,
  metadata: true,
  publishedAt: true,
  status: true,
  hiringPartner: { select: { logoId: true } },
} as const;

function imageIdOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const id = (metadata as Record<string, unknown>).imageId;
  return typeof id === "string" && id ? id : null;
}

export async function GET(req: NextRequest) {
  try {
    await checkMaintenance();
    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: { id: true },
    });

    if (!org) return NextResponse.json({ data: [] });

    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);

    const jobs = await prisma.job.findMany({
      where: {
        orgId: org.id,
        status: "PUBLISHED",
        OR: [{ closesAt: null }, { closesAt: { gte: new Date() } }],
      },
      orderBy: [{ publishedAt: "desc" }],
      take: limit,
      select: JOB_SELECT,
    });

    const mediaIds = jobs
      .map((j) => imageIdOf(j.metadata) ?? j.hiringPartner?.logoId ?? null)
      .filter((id): id is string => !!id);
    const assets = mediaIds.length
      ? await prisma.mediaAsset.findMany({
          where: { orgId: org.id, id: { in: mediaIds }, isActive: true },
          select: { id: true, fileUrl: true },
        })
      : [];
    const urlById = new Map(assets.map((a) => [a.id, a.fileUrl]));

    return NextResponse.json({
      data: jobs.map(({ hiringPartner, ...j }) => {
        const own = imageIdOf(j.metadata);
        const logo = hiringPartner?.logoId ?? null;
        return {
          ...j,
          imageUrl: (own && urlById.get(own)) || (logo && urlById.get(logo)) || null,
        };
      }),
    });
  } catch (err) {
    return handleError(err);
  }
}
