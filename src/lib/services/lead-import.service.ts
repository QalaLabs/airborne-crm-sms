import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { contactCandidates } from "@/lib/messaging/phone";
import {
  prepareImportRows,
  type ImportRowError,
  type PreparedImportRow,
  type RawImportRow,
} from "@/lib/leads/lead-import";
import type { RequestContext } from "@/types";

export interface LeadImportResult {
  dryRun: boolean;
  totalRows: number;
  toCreate: number;
  created: number;
  duplicates: ImportRowError[];
  errors: ImportRowError[];
  batchId: string | null;
}

const CHUNK = 500;

/**
 * Bulk import of historical leads. Deliberately does NOT emit lead.created
 * automation events: imported contacts are old enquiries and must not receive
 * welcome WhatsApp/email sends.
 */
export class LeadImportService {
  static async run(ctx: RequestContext, rows: RawImportRow[], dryRun: boolean): Promise<LeadImportResult> {
    const { valid, errors } = prepareImportRows(rows);

    const duplicates: ImportRowError[] = [];
    const existingPhones = await this.findExistingPhones(ctx.orgId, valid);
    const counselors = await this.resolveCounselors(ctx.orgId, valid);

    const ready: (PreparedImportRow & { counselorId: string | null })[] = [];
    for (const row of valid) {
      const match = contactCandidates(row.phone).find((c) => existingPhones.has(c));
      if (match) {
        duplicates.push({
          rowNumber: row.rowNumber,
          reason: existingPhones.get(match)
            ? `Phone ${row.phone} is in the Recycle Bin — restore it there`
            : `Phone ${row.phone} already exists in CRM`,
        });
        continue;
      }
      let counselorId: string | null = null;
      if (row.counselorEmail) {
        counselorId = counselors.get(row.counselorEmail) ?? null;
        if (!counselorId) {
          errors.push({ rowNumber: row.rowNumber, reason: `No active user with email ${row.counselorEmail}` });
          continue;
        }
      }
      ready.push({ ...row, counselorId });
    }

    errors.sort((a, b) => a.rowNumber - b.rowNumber);

    if (dryRun || ready.length === 0) {
      return { dryRun, totalRows: rows.length, toCreate: ready.length, created: 0, duplicates, errors, batchId: null };
    }

    const batchId = randomUUID();
    const now = new Date();
    let created = 0;

    for (let i = 0; i < ready.length; i += CHUNK) {
      const chunk = ready.slice(i, i + CHUNK);
      const inserted = await prisma.lead.createManyAndReturn({
        data: chunk.map((row) => ({
          orgId: ctx.orgId,
          createdBy: ctx.user.id,
          name: row.name,
          phone: row.phone,
          email: row.email,
          courseInterest: row.courseInterest,
          city: row.city,
          state: row.state,
          pincode: row.pincode,
          source: row.source,
          status: row.status,
          assignedTo: row.counselorId,
          tags: ["imported"],
          customFields: {
            importBatchId: batchId,
            importRow: row.rowNumber,
            ...(row.originalSource ? { importedSource: row.originalSource } : {}),
          } as Prisma.InputJsonValue,
          ...(row.createdAt ? { createdAt: row.createdAt } : {}),
          ...(row.notes ? { lastActivityAt: now } : {}),
        })),
        skipDuplicates: true,
        select: { id: true, phone: true },
      });
      created += inserted.length;

      const idByPhone = new Map(inserted.map((l) => [l.phone, l.id]));
      const insertedRows = chunk.filter((r) => idByPhone.has(r.phone));
      if (insertedRows.length > 0) {
        await prisma.leadActivity.createMany({
          data: insertedRows.map((r) => ({
            leadId: idByPhone.get(r.phone)!,
            orgId: ctx.orgId,
            performedBy: ctx.user.id,
            activityType: "NOTE" as const,
            title: r.notes ? "Imported note" : "Imported lead",
            notes: r.notes || `Lead imported via batch ${batchId.slice(0, 8)}`,
            completedAt: now,
          })),
        });
      }
    }

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "lead.imported",
      entityType: "lead",
      entityId: batchId,
      newValue: { batchId, created, duplicates: duplicates.length, errors: errors.length, totalRows: rows.length },
    });

    return { dryRun, totalRows: rows.length, toCreate: ready.length, created, duplicates, errors, batchId };
  }

  // unique(orgId, phone) spans soft-deleted rows too, so they count as existing.
  // Value = true when the matching lead is in the Recycle Bin.
  private static async findExistingPhones(orgId: string, rows: PreparedImportRow[]): Promise<Map<string, boolean>> {
    const candidates = [...new Set(rows.flatMap((r) => contactCandidates(r.phone)))];
    const found = new Map<string, boolean>();
    for (let i = 0; i < candidates.length; i += 5000) {
      const existing = await prisma.lead.findMany({
        where: { orgId, phone: { in: candidates.slice(i, i + 5000) } },
        select: { phone: true, deletedAt: true },
      });
      for (const l of existing) found.set(l.phone, l.deletedAt !== null);
    }
    return found;
  }

  private static async resolveCounselors(orgId: string, rows: PreparedImportRow[]): Promise<Map<string, string>> {
    const emails = [...new Set(rows.map((r) => r.counselorEmail).filter((e): e is string => !!e))];
    if (emails.length === 0) return new Map();
    const users = await prisma.user.findMany({
      where: { orgId, isActive: true, deletedAt: null, email: { in: emails, mode: "insensitive" } },
      select: { id: true, email: true },
    });
    return new Map(users.map((u) => [u.email.toLowerCase(), u.id]));
  }
}
