import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { buildPublicOrgPayload } from "@/lib/services/org.public";

export async function GET() {
  try {
    const org = await prisma.organization.findFirst({
      where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
      select: {
        id: true,
        name: true,
        slug: true,
        logoUrl: true,
        domain: true,
        settings: true,
      },
    });

    if (!org) return NextResponse.json({ data: null });

    const navMenus = await prisma.navMenu.findMany({
      where: { orgId: org.id, isActive: true },
    });

    // Public surface only — org.settings is an allow-listed projection
    // (applicationIntake, maintenanceMode). Never the raw settings blob.
    return NextResponse.json({
      data: buildPublicOrgPayload(org, navMenus),
    });
  } catch (err) {
    console.error("[Public Settings API Error]:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
