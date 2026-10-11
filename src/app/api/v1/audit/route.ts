import { type NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { guard } from "@/lib/middleware/permissions";
import { getRequestContext } from "@/lib/middleware/context";
import { ok, handleError, buildPaginationMeta } from "@/lib/utils/response";
import { z } from "zod";

const auditFiltersSchema = z.object({
  search: z.string().optional(),
  module: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = await getRequestContext();
    guard(ctx.user, "read", "audit");

    const url = new URL(req.url);
    const filters = auditFiltersSchema.parse(Object.fromEntries(url.searchParams));

    const skip = (filters.page - 1) * filters.limit;

    const where: Prisma.AuditLogWhereInput = {
      orgId: ctx.orgId,
      ...(filters.module && filters.module !== "ALL" && { entityType: { contains: filters.module, mode: "insensitive" as const } }),
      ...(filters.search && {
        OR: [
          { action: { contains: filters.search, mode: "insensitive" as const } },
          { entityType: { contains: filters.search, mode: "insensitive" as const } },
          { ipAddress: { contains: filters.search } },
          { user: { name: { contains: filters.search, mode: "insensitive" as const } } },
        ],
      }),
    };

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip,
        take: filters.limit,
        orderBy: { occurredAt: "desc" },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      }),
      prisma.auditLog.count({ where }),
    ]);

    const formattedData = data.map((log) => ({
      id: String(log.id),
      actionType: log.action,
      user: log.user?.name ?? "System Process",
      email: log.user?.email ?? "system@airborneaviation.in",
      timestamp: log.occurredAt.toISOString(),
      ipAddress: log.ipAddress ?? "Internal (VPN)",
      description: `${log.action} performed on ${log.entityType} (${log.entityId ?? "n/a"})`,
      integrityHash: log.rowHash ?? "n/a",
      module: log.entityType,
    }));

    return ok(formattedData, buildPaginationMeta(total, filters.page, filters.limit));
  } catch (err) {
    return handleError(err);
  }
}
