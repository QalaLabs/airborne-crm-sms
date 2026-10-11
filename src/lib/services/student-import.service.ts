import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { AppError } from "@/lib/utils/errors";
import { parseStudentCsv, type NormalizedStudentRow, type StudentImportIssue } from "@/lib/students/student-import";
import type { RequestContext } from "@/types";

export interface StudentImportPreviewRow {
  rowNumber: number;
  name: string;
  email: string;
  phone: string;
  campus: string | null;
}

export interface StudentImportReport {
  dryRun: boolean;
  committed: boolean;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  fileErrors: string[];
  errors: StudentImportIssue[];
  preview: StudentImportPreviewRow[];
  created: { id: string; studentCode: string; email: string }[];
  batchId: string | null;
}

interface PreparedStudent extends NormalizedStudentRow {
  campusId: string | null;
  campusName: string | null;
}

/** Same format as StudentRepository.getNextCode, skipping any code already taken. */
export function allocateStudentCodes(year: number, startCount: number, n: number, taken: Set<string>): string[] {
  const codes: string[] = [];
  for (let seq = startCount + 1; codes.length < n; seq++) {
    const code = `AAA-${year}-${String(seq).padStart(4, "0")}`;
    if (!taken.has(code)) codes.push(code);
  }
  return codes;
}

function toCreateData(orgId: string, row: PreparedStudent, studentCode: string): Prisma.StudentUncheckedCreateInput {
  const d = row.input;
  return {
    orgId,
    studentCode,
    firstName: d.firstName,
    lastName: d.lastName,
    email: d.email.toLowerCase(),
    phone: d.phone,
    dateOfBirth: d.dateOfBirth ? new Date(d.dateOfBirth) : null,
    gender: d.gender,
    nationality: d.nationality,
    address: (d.address ?? {}) as Prisma.InputJsonValue,
    guardianName: d.guardianName || null,
    guardianPhone: d.guardianPhone || null,
    guardianEmail: d.guardianEmail || null,
    medicalFitness: d.medicalFitness,
    class10Board: d.class10Board || null,
    class10Year: d.class10Year ?? null,
    class10Percent: d.class10Percent ?? null,
    class12Board: d.class12Board || null,
    class12Year: d.class12Year ?? null,
    class12Percent: d.class12Percent ?? null,
    class12Stream: d.class12Stream ?? null,
    campusId: row.campusId,
    customFields: {},
  };
}

export class StudentImportService {
  /**
   * Preview (dryRun) or commit. Commit re-validates the whole file against the
   * database and writes nothing unless every row is valid.
   */
  static async run(ctx: RequestContext, csv: string, dryRun: boolean, now: Date = new Date()): Promise<StudentImportReport> {
    const parsed = parseStudentCsv(csv, now);
    const errors: StudentImportIssue[] = [...parsed.issues];
    const report: StudentImportReport = {
      dryRun,
      committed: false,
      totalRows: parsed.totalRows,
      validRows: 0,
      invalidRows: 0,
      fileErrors: parsed.fileErrors,
      errors,
      preview: [],
      created: [],
      batchId: null,
    };

    const prepared: PreparedStudent[] = [];
    if (parsed.fileErrors.length === 0 && parsed.rows.length > 0) {
      const campuses = await this.resolveCampuses(ctx.orgId, parsed.rows);
      const existing = await this.existingEmails(prisma, ctx.orgId, parsed.rows.map((r) => r.input.email));
      for (const row of parsed.rows) {
        const clash = existing.get(row.input.email);
        if (clash) {
          errors.push({
            rowNumber: row.rowNumber,
            column: "email",
            message: clash.archived
              ? `${row.input.email} belongs to an archived student (${clash.studentCode}) — restore that record instead`
              : `A student with email ${row.input.email} already exists (${clash.studentCode})`,
          });
          continue;
        }
        let campusId: string | null = null;
        let campusName: string | null = null;
        if (row.campusCode) {
          const campus = campuses.get(row.campusCode.toLowerCase());
          if (!campus) {
            errors.push({ rowNumber: row.rowNumber, column: "campus_code", message: `Unknown campus code "${row.campusCode}" in your organization` });
            continue;
          }
          campusId = campus.id;
          campusName = campus.name;
        }
        prepared.push({ ...row, campusId, campusName });
      }
      report.preview = prepared.map((r) => ({
        rowNumber: r.rowNumber,
        name: `${r.input.firstName} ${r.input.lastName}`,
        email: r.input.email,
        phone: r.input.phone,
        campus: r.campusName,
      }));
    }

    errors.sort((a, b) => a.rowNumber - b.rowNumber);
    report.invalidRows = new Set(errors.map((e) => e.rowNumber)).size;
    report.validRows = prepared.length;
    if (dryRun) return report;

    if (report.fileErrors.length > 0 || errors.length > 0) {
      throw new AppError(
        "IMPORT_HAS_ERRORS",
        `Nothing was imported: fix ${report.fileErrors.length > 0 ? "the file" : `${report.invalidRows} invalid row(s)`} and upload again`,
        422,
        [...report.fileErrors.map((message) => ({ message })), ...errors.slice(0, 50).map((e) => ({ path: [`row ${e.rowNumber}`], message: e.message }))],
      );
    }
    if (prepared.length === 0) throw new AppError("IMPORT_EMPTY", "The file has no student rows", 422);

    const batchId = randomUUID();
    report.created = await this.persist(ctx, prepared, batchId, report.totalRows, now);
    report.batchId = batchId;
    report.committed = true;
    return report;
  }

  private static async persist(ctx: RequestContext, rows: PreparedStudent[], batchId: string, totalRows: number, now: Date) {
    const created = await prisma.$transaction(
      async (tx) => {
        // Serializes concurrent imports/creates for this org so code allocation
        // and the email re-check below cannot race.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${ctx.orgId}:students`}))`;

        const clashes = await this.existingEmails(tx, ctx.orgId, rows.map((r) => r.input.email));
        if (clashes.size > 0) {
          throw new AppError("IMPORT_CONFLICT", `Nothing was imported: ${clashes.size} email(s) were registered while you were importing`, 409);
        }

        const year = now.getFullYear();
        const count = await tx.student.count({ where: { orgId: ctx.orgId } });
        const taken = new Set(
          (await tx.student.findMany({ where: { orgId: ctx.orgId, studentCode: { startsWith: `AAA-${year}-` } }, select: { studentCode: true } })).map(
            (s) => s.studentCode,
          ),
        );
        const codes = allocateStudentCodes(year, count, rows.length, taken);

        const out: { id: string; studentCode: string; email: string }[] = [];
        for (const [i, row] of rows.entries()) {
          const student = await tx.student.create({
            data: toCreateData(ctx.orgId, row, codes[i]!),
            select: { id: true, studentCode: true, email: true },
          });
          out.push(student);
          await AuditService.write(
            {
              orgId: ctx.orgId,
              userId: ctx.user.id,
              requestId: ctx.requestId,
              action: "student.created",
              entityType: "student",
              entityId: student.id,
              newValue: { studentCode: student.studentCode, email: student.email, via: "student.bulk_imported", batchId, rowNumber: row.rowNumber },
            },
            tx,
          );
        }
        await AuditService.write(
          {
            orgId: ctx.orgId,
            userId: ctx.user.id,
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            action: "student.bulk_imported",
            entityType: "student",
            entityId: batchId,
            newValue: { batchId, source: "csv", totalRows, created: out.length, studentIds: out.map((s) => s.id) },
          },
          tx,
        );
        return out;
      },
      { timeout: 60_000 },
    );

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "imported",
      objectType: "student",
      objectId: batchId,
      objectSnapshot: { count: created.length },
      context: { actorName: ctx.user.name },
    });
    return created;
  }

  /** Includes soft-deleted rows: the (orgId, email) unique index still covers them. */
  private static async existingEmails(db: Prisma.TransactionClient, orgId: string, emails: string[]) {
    const rows = await db.student.findMany({
      where: { orgId, email: { in: emails.map((e) => e.toLowerCase()) } },
      select: { email: true, studentCode: true, deletedAt: true },
    });
    return new Map(rows.map((r) => [r.email.toLowerCase(), { studentCode: r.studentCode, archived: r.deletedAt !== null }]));
  }

  private static async resolveCampuses(orgId: string, rows: NormalizedStudentRow[]) {
    const codes = [...new Set(rows.map((r) => r.campusCode).filter((c): c is string => Boolean(c)))];
    const map = new Map<string, { id: string; name: string }>();
    if (codes.length === 0) return map;
    const campuses = await prisma.campus.findMany({
      where: { orgId, code: { in: codes, mode: "insensitive" } },
      select: { id: true, name: true, code: true },
    });
    for (const c of campuses) map.set(c.code.toLowerCase(), { id: c.id, name: c.name });
    return map;
  }
}
