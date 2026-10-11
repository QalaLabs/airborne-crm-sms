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
    const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20"), 50);
    const slug = url.searchParams.get("slug") ?? undefined;

    if (slug) {
      const blog = await prisma.resource.findFirst({
        where: { orgId: org.id, slug, status: "PUBLISHED" },
        select: {
          id: true,
          slug: true,
          title: true,
          description: true,
          type: true,
          fileUrl: true,
          externalUrl: true,
          isGated: true,
          category: true,
          tags: true,
          metadata: true,
          seoTitle: true,
          seoDesc: true,
          downloadCount: true,
          createdAt: true,
          publishedAt: true,
        },
      });
      return NextResponse.json({ data: blog });
    }

    const blogs = await prisma.resource.findMany({
      where: {
        orgId: org.id,
        status: "PUBLISHED",
        OR: [{ category: "blog" }, { type: "DOCUMENT" }],
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        slug: true,
        title: true,
        description: true,
        type: true,
        fileUrl: true,
        externalUrl: true,
        isGated: true,
        category: true,
        tags: true,
        metadata: true,
        seoTitle: true,
        seoDesc: true,
        downloadCount: true,
        createdAt: true,
        publishedAt: true,
      },
    });

    return NextResponse.json({ data: blogs });
  } catch (err) {
    return handleError(err);
  }
}
