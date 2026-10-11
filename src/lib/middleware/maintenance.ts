import { prisma } from "@/lib/db/client";
import { AppError } from "@/lib/utils/errors";

export async function checkMaintenance() {
  const org = await prisma.organization.findFirst({
    where: { slug: process.env.PUBLIC_ORG_SLUG ?? "airborne-aviation" },
    select: { settings: true },
  });

  if (org) {
    const settings = org.settings as Record<string, unknown> | null;
    if (settings && settings.maintenanceMode === true) {
      throw new AppError(
        "MAINTENANCE_MODE",
        "System is undergoing maintenance. Please try again later.",
        503,
      );
    }
  }
}
