import { type NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError } from "@/lib/utils/response";

export async function GET(_req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    // Return latest 15 activity items for the organization
    const items = await prisma.activityFeedItem.findMany({
      where: { orgId: ctx.orgId },
      orderBy: { occurredAt: "desc" },
      take: 15,
      include: {
        actor: {
          select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
          },
        },
      },
    });
    return ok(items);
  } catch (err) {
    return handleError(err);
  }
}
