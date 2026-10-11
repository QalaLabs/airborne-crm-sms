import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import { buildAuditRowHash } from "@/lib/utils/crypto";
import { scheduleWebsiteRevalidation } from "@/lib/website/revalidate";

interface WriteAuditParams {
  orgId: string;
  userId?: string;
  sessionId?: string;
  requestId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
}

export class AuditService {
  // Append one audit row with hash-chain integrity.
  // Pass tx when writing inside a database transaction so the audit row shares
  // the same commit/rollback fate as the financial write.
  static async write(params: WriteAuditParams, tx?: Prisma.TransactionClient): Promise<void> {
    try {
      const db = tx ?? prisma;

      // Fetch last row for hash chaining (per org)
      const lastRow = await db.auditLog.findFirst({
        where: { orgId: params.orgId },
        orderBy: { id: "desc" },
        select: { id: true, rowHash: true },
      });

      const prevHash = lastRow?.rowHash ?? null;

      // Compute diff between old and new
      const diff = params.oldValue && params.newValue
        ? computeDiff(params.oldValue, params.newValue)
        : null;

      const created = await db.auditLog.create({
        data: {
          orgId: params.orgId,
          userId: params.userId,
          sessionId: params.sessionId,
          requestId: params.requestId,
          action: params.action,
          entityType: params.entityType,
          entityId: params.entityId,
          oldValue: (params.oldValue ?? undefined) as Prisma.InputJsonValue | undefined,
          newValue: (params.newValue ?? undefined) as Prisma.InputJsonValue | undefined,
          diff: (diff ?? undefined) as Prisma.InputJsonValue | undefined,
          ipAddress: params.ipAddress,
          userAgent: params.userAgent,
          prevHash,
        },
      });

      // Compute row hash and back-fill
      const rowHash = buildAuditRowHash({
        id: created.id,
        orgId: created.orgId,
        userId: created.userId,
        action: created.action,
        entityType: created.entityType,
        entityId: created.entityId,
        occurredAt: created.occurredAt,
        prevHash: created.prevHash,
      });

      await db.auditLog.update({
        where: { id: created.id },
        data: { rowHash },
      });

      // Inside a transaction the write may still roll back; the caller syncs after commit.
      if (!tx) scheduleWebsiteRevalidation(params.entityType, params.requestId);
    } catch (err) {
      // Audit must never crash the caller
      console.error("[AuditService] write failed", err);
    }
  }

  // Verify hash chain integrity for an org
  static async verifyIntegrity(orgId: string): Promise<{ valid: boolean; brokenAt?: bigint }> {
    const rows = await prisma.auditLog.findMany({
      where: { orgId },
      orderBy: { id: "asc" },
      select: {
        id: true,
        orgId: true,
        userId: true,
        action: true,
        entityType: true,
        entityId: true,
        occurredAt: true,
        prevHash: true,
        rowHash: true,
      },
    });

    for (const row of rows) {
      const computed = buildAuditRowHash({
        id: row.id,
        orgId: row.orgId,
        userId: row.userId,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        occurredAt: row.occurredAt,
        prevHash: row.prevHash,
      });
      if (computed !== row.rowHash) {
        return { valid: false, brokenAt: row.id };
      }
    }

    return { valid: true };
  }
}

// ─── Diff helper ─────────────────────────────────────────────────────────────

function computeDiff(
  oldVal: Record<string, unknown>,
  newVal: Record<string, unknown>,
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  const allKeys = Array.from(new Set([...Object.keys(oldVal), ...Object.keys(newVal)]));

  for (const key of allKeys) {
    if (JSON.stringify(oldVal[key]) !== JSON.stringify(newVal[key])) {
      diff[key] = { from: oldVal[key], to: newVal[key] };
    }
  }

  return diff;
}
