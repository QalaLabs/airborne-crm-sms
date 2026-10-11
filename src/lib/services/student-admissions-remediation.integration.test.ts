/**
 * DB integration coverage for the Student Management / Admissions remediation:
 * bulk student import (A1), airline partner edit (A2), placement org refs (A3),
 * counselor document upload (B1) and admission letters (B2/B3).
 * Gated by ADMISSION_INTEGRATION=1 (enabled by `npm run test:local`), which
 * refuses non-loopback databases.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/db/client";
import { StudentImportService } from "@/lib/services/student-import.service";
import { HiringPartnerService, PlacementService } from "@/lib/services/placement.service";
import { DocumentService, type DocumentStorageDeps } from "@/lib/services/document.service";
import { AdmissionLetterService } from "@/lib/services/admission-letter.service";
import { updateHiringPartnerSchema } from "@/lib/validations/placement.schema";
import { hasPermission } from "@/lib/utils/permissions";
import { AppError } from "@/lib/utils/errors";
import type { UserRole } from "@prisma/client";
import type { RequestContext } from "@/types";

const ENABLED = process.env.ADMISSION_INTEGRATION === "1";
const NOW = new Date("2026-10-02T06:00:00Z");
const HEADER = "first_name,last_name,email,phone";
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0x25, 0x45, 0x4f, 0x46]);

let SEQ = 0;
const uniq = () => `${Date.now().toString(36)}${(SEQ++).toString(36)}`;

const ctxFor = (orgId: string, userId: string, role: UserRole = "ADMIN"): RequestContext => ({
  orgId,
  user: { id: userId, orgId, campusId: null, name: `T ${role}`, email: `${userId}@example.com`, role, avatarUrl: null },
  requestId: `req-${uniq()}`,
  ipAddress: "127.0.0.1",
  userAgent: "node:test",
});

async function seedOrg() {
  const s = uniq();
  const org = await prisma.organization.create({ data: { name: `REM-${s}`, slug: `rem-${s}` } });
  const admin = await prisma.user.create({ data: { orgId: org.id, name: "Rem Admin", email: `rem-admin-${s}@example.com`, role: "ADMIN", passwordHash: null } });
  const counselorA = await prisma.user.create({ data: { orgId: org.id, name: "Counselor A", email: `rem-ca-${s}@example.com`, role: "ADMISSIONS_COUNSELOR", passwordHash: null } });
  const counselorB = await prisma.user.create({ data: { orgId: org.id, name: "Counselor B", email: `rem-cb-${s}@example.com`, role: "ADMISSIONS_COUNSELOR", passwordHash: null } });
  const campus = await prisma.campus.create({ data: { orgId: org.id, name: "Delhi Campus", code: `DEL${s.slice(-6)}`.toUpperCase(), city: "Delhi", state: "Delhi" } });
  return { org, admin, counselorA, counselorB, campus, s };
}

async function seedAdmission(orgId: string, counselorId: string | null, s: string) {
  const lead = await prisma.lead.create({ data: { orgId, name: "Dossier Lead", phone: "9876543210", email: `lead-${s}-${uniq()}@example.com` } });
  const student = await prisma.student.create({
    data: { orgId, firstName: "Asha", lastName: "Rao", email: `stu-${s}-${uniq()}@example.com`, phone: "9876543210", studentCode: `T-${uniq()}` },
  });
  return prisma.admission.create({
    data: {
      orgId,
      leadId: lead.id,
      studentId: student.id,
      applicationNo: `APP-${uniq()}`,
      counselorId,
      courseName: "Commercial Pilot License",
      feeAmount: 450000,
      feeDiscount: 25000,
      feeFinal: 425000,
      feePaid: 100000,
      feeBalance: 300000,
      metadata: { feePlanSnapshot: { name: "CPL 2-part", items: [{ name: "Booking", resolvedAmount: 100000, dueOffsetDays: 0 }] } },
    },
  });
}

const csvRows = (n: number, tag: string) =>
  Array.from({ length: n }, (_, i) => `S${i},T,imp-${tag}-${i}@example.com,98${String(10000000 + i).slice(-8)}`).join("\n");

async function expectAppError(p: Promise<unknown>, code: string | RegExp, status?: number) {
  await assert.rejects(p, (err: unknown) => {
    assert.ok(err instanceof AppError, `expected AppError, got ${String(err)}`);
    if (typeof code === "string") assert.equal(err.code, code);
    else assert.match(err.code, code);
    if (status) assert.equal(err.statusCode, status);
    return true;
  });
}

// ─── A1: bulk student import ────────────────────────────────────────────────

test("A1 int: dry run of 150 rows writes nothing; commit creates 150 with codes + audit", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  const ctx = ctxFor(org.id, admin.id);
  const csv = `${HEADER}\n${csvRows(150, s)}`;

  const preview = await StudentImportService.run(ctx, csv, true, NOW);
  assert.equal(preview.totalRows, 150);
  assert.equal(preview.validRows, 150);
  assert.equal(preview.invalidRows, 0);
  assert.equal(await prisma.student.count({ where: { orgId: org.id } }), 0);

  const done = await StudentImportService.run(ctx, csv, false, NOW);
  assert.equal(done.committed, true);
  assert.equal(done.created.length, 150);
  assert.equal(await prisma.student.count({ where: { orgId: org.id } }), 150);
  const codes = new Set(done.created.map((c) => c.studentCode));
  assert.equal(codes.size, 150);
  assert.ok([...codes].every((c) => /^AAA-2026-\d{4}$/.test(c)));
  assert.equal(await prisma.auditLog.count({ where: { orgId: org.id, action: "student.created" } }), 150);
  const summary = await prisma.auditLog.findFirst({ where: { orgId: org.id, action: "student.bulk_imported" } });
  assert.ok(summary);
});

test("A1 int: 151 rows rejected on commit with nothing written", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  await expectAppError(StudentImportService.run(ctxFor(org.id, admin.id), `${HEADER}\n${csvRows(151, s)}`, false, NOW), "IMPORT_HAS_ERRORS", 422);
  assert.equal(await prisma.student.count({ where: { orgId: org.id } }), 0);
});

test("A1 int: mixed file is all-or-nothing (no partial import)", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  const csv = `${HEADER}\nA,B,ok1-${s}@example.com,9876543210\nC,D,not-an-email,9876543211\nE,F,ok2-${s}@example.com,9876543212`;
  const preview = await StudentImportService.run(ctxFor(org.id, admin.id), csv, true, NOW);
  assert.equal(preview.validRows, 2);
  assert.equal(preview.invalidRows, 1);
  assert.equal(preview.errors[0]!.rowNumber, 3);
  await expectAppError(StudentImportService.run(ctxFor(org.id, admin.id), csv, false, NOW), "IMPORT_HAS_ERRORS", 422);
  assert.equal(await prisma.student.count({ where: { orgId: org.id } }), 0);
});

test("A1 int: duplicates against DB (active and archived) are row errors", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  await prisma.student.create({ data: { orgId: org.id, firstName: "X", lastName: "Y", email: `live-${s}@example.com`, phone: "9876543210", studentCode: `L-${s}` } });
  await prisma.student.create({
    data: { orgId: org.id, firstName: "X", lastName: "Y", email: `gone-${s}@example.com`, phone: "9876543210", studentCode: `G-${s}`, deletedAt: new Date() },
  });
  const r = await StudentImportService.run(
    ctxFor(org.id, admin.id),
    `${HEADER}\nA,B,LIVE-${s}@example.com,9876543210\nC,D,gone-${s}@example.com,9876543211`,
    true,
    NOW,
  );
  assert.equal(r.validRows, 0);
  assert.match(r.errors[0]!.message, /already exists/);
  assert.match(r.errors[1]!.message, /archived student/);
});

test("A1 int: same email in another org is not a conflict; campus codes are org-scoped", { skip: !ENABLED }, async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  await prisma.student.create({ data: { orgId: b.org.id, firstName: "X", lastName: "Y", email: `shared-${a.s}@example.com`, phone: "9876543210", studentCode: `B-${a.s}` } });
  const r = await StudentImportService.run(
    ctxFor(a.org.id, a.admin.id),
    `${HEADER},campus_code\nA,B,shared-${a.s}@example.com,9876543210,${a.campus.code}\nC,D,other-${a.s}@example.com,9876543211,${b.campus.code}`,
    true,
    NOW,
  );
  assert.equal(r.validRows, 1);
  assert.equal(r.preview[0]!.campus, "Delhi Campus");
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!.message, /Unknown campus code/);
});

test("A1 int: transaction rolls back fully when a row fails mid-insert", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  const csv = `${HEADER}\nA,B,rb1-${s}@example.com,9876543210\nC,D,rb2-${s}@example.com,9876543211`;
  const original = prisma.$transaction.bind(prisma);
  (prisma as unknown as { $transaction: unknown }).$transaction = async (fn: (tx: unknown) => Promise<unknown>, opts?: unknown) =>
    original(async (tx) => {
      let calls = 0;
      const proxy = new Proxy(tx, {
        get(target, prop) {
          if (prop === "student") {
            return new Proxy(target.student, {
              get(st, p) {
                if (p === "create") {
                  return async (args: unknown) => {
                    calls += 1;
                    if (calls === 2) throw new Error("simulated failure on row 2");
                    return (st.create as (a: unknown) => Promise<unknown>)(args);
                  };
                }
                return Reflect.get(st, p);
              },
            });
          }
          return Reflect.get(target, prop);
        },
      });
      return fn(proxy);
    }, opts as never);
  try {
    await assert.rejects(StudentImportService.run(ctxFor(org.id, admin.id), csv, false, NOW), /simulated failure/);
  } finally {
    (prisma as unknown as { $transaction: unknown }).$transaction = original;
  }
  assert.equal(await prisma.student.count({ where: { orgId: org.id } }), 0);
  assert.equal(await prisma.auditLog.count({ where: { orgId: org.id, action: { in: ["student.created", "student.bulk_imported"] } } }), 0);
});

test("A1 int: RBAC — only roles with students:write may import", { skip: !ENABLED }, async () => {
  const u = (role: UserRole) => ({ id: "x", orgId: "o", campusId: null, name: "x", email: "x@example.com", role, avatarUrl: null });
  assert.equal(hasPermission(u("ADMIN"), "write", "students"), true);
  assert.equal(hasPermission(u("ADMISSIONS_COUNSELOR"), "write", "students"), true);
  assert.equal(hasPermission(u("CONTENT_MANAGER"), "write", "students"), false);
  assert.equal(hasPermission(u("MARKETING_MANAGER"), "write", "students"), false);
});

// ─── A2: airline partner edit ───────────────────────────────────────────────

test("A2 int: edit persists, audits changed fields, keeps placements linked", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  const ctx = ctxFor(org.id, admin.id);
  const partner = await HiringPartnerService.create(ctx, { name: `IndiGo ${s}`, slug: `indigo-${s}`, isActive: true, order: 0 });
  const student = await prisma.student.create({ data: { orgId: org.id, firstName: "P", lastName: "Q", email: `pl-${s}@example.com`, phone: "9876543210", studentCode: `P-${s}` } });
  const placement = await PlacementService.create(ctx, { studentId: student.id, hiringPartnerId: partner.id, jobTitle: "Cadet", currency: "INR", status: "PENDING", isPublic: false });

  const input = updateHiringPartnerSchema.parse({ name: `IndiGo Airlines ${s}`, slug: `6e-${s}`, website: "https://www.goindigo.in", industry: "", isActive: false });
  const updated = await HiringPartnerService.update(ctx, partner.id, input);
  assert.equal(updated.name, `IndiGo Airlines ${s}`);
  assert.equal(updated.slug, `6e-${s}`);
  assert.equal(updated.industry, null);
  assert.equal(updated.isActive, false);

  const reloaded = await prisma.hiringPartner.findUnique({ where: { id: partner.id } });
  assert.equal(reloaded?.website, "https://www.goindigo.in");
  const stillLinked = await prisma.placement.findUnique({ where: { id: placement.id } });
  assert.equal(stillLinked?.hiringPartnerId, partner.id);

  const audit = await prisma.auditLog.findFirst({ where: { orgId: org.id, action: "hiring_partner.updated", entityId: partner.id } });
  assert.ok(audit);
  for (const k of ["name", "slug", "isActive", "website"]) assert.ok(k in (audit!.newValue as object), `audit newValue has ${k}`);
  assert.equal((audit!.oldValue as Record<string, unknown>).slug, `indigo-${s}`);
});

test("A2 int: invalid code/website rejected by schema; empty patch rejected", { skip: !ENABLED }, async () => {
  assert.equal(updateHiringPartnerSchema.safeParse({ slug: "Bad Code!" }).success, false);
  assert.equal(updateHiringPartnerSchema.safeParse({ slug: "a" }).success, false);
  assert.equal(updateHiringPartnerSchema.safeParse({ website: "not a url" }).success, false);
  assert.equal(updateHiringPartnerSchema.safeParse({ orgId: "x" }).success, false);
  assert.equal(updateHiringPartnerSchema.safeParse({}).success, false);
  assert.equal(updateHiringPartnerSchema.safeParse({ name: "   " }).success, false);
});

test("A2 int: duplicate code and duplicate name (case-insensitive) conflict", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  const ctx = ctxFor(org.id, admin.id);
  await HiringPartnerService.create(ctx, { name: `Air India ${s}`, slug: `ai-${s}`, isActive: true, order: 0 });
  const other = await HiringPartnerService.create(ctx, { name: `Akasa ${s}`, slug: `qp-${s}`, isActive: true, order: 1 });
  await expectAppError(HiringPartnerService.update(ctx, other.id, updateHiringPartnerSchema.parse({ slug: `ai-${s}` })), "CONFLICT", 409);
  await expectAppError(HiringPartnerService.update(ctx, other.id, updateHiringPartnerSchema.parse({ name: `AIR INDIA ${s}` })), "CONFLICT", 409);
  const unchanged = await prisma.hiringPartner.findUnique({ where: { id: other.id } });
  assert.equal(unchanged?.slug, `qp-${s}`);
});

test("A2 int: cross-org update is a 404 and changes nothing; RBAC denies non-placement roles", { skip: !ENABLED }, async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  const partner = await HiringPartnerService.create(ctxFor(a.org.id, a.admin.id), { name: `Vistara ${a.s}`, slug: `uk-${a.s}`, isActive: true, order: 0 });
  await expectAppError(HiringPartnerService.update(ctxFor(b.org.id, b.admin.id), partner.id, updateHiringPartnerSchema.parse({ name: "Hijack" })), /NOT_FOUND/, 404);
  assert.equal((await prisma.hiringPartner.findUnique({ where: { id: partner.id } }))?.name, `Vistara ${a.s}`);
  const u = (role: UserRole) => ({ id: "x", orgId: "o", campusId: null, name: "x", email: "x@example.com", role, avatarUrl: null });
  assert.equal(hasPermission(u("PLACEMENT_MANAGER"), "write", "hiring_partners"), true);
  assert.equal(hasPermission(u("CONTENT_MANAGER"), "write", "hiring_partners"), false);
  assert.equal(hasPermission(u("ADMISSIONS_COUNSELOR"), "write", "hiring_partners"), false);
});

test("A2 int: logo must be a media asset in the same org", { skip: !ENABLED }, async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  const partner = await HiringPartnerService.create(ctxFor(a.org.id, a.admin.id), { name: `SpiceJet ${a.s}`, slug: `sg-${a.s}`, isActive: true, order: 0 });
  const foreignLogo = await prisma.mediaAsset.create({
    data: { orgId: b.org.id, name: "l.png", originalName: "l.png", mimeType: "image/png", sizeBytes: 10, fileKey: `media/${b.s}/l.png`, fileUrl: "https://example.com/l.png" },
  });
  await expectAppError(
    HiringPartnerService.update(ctxFor(a.org.id, a.admin.id), partner.id, updateHiringPartnerSchema.parse({ logoId: foreignLogo.id })),
    /NOT_FOUND|VALIDATION/,
  );
});

// ─── A3: placement references stay inside the org ───────────────────────────

test("A3 int: placement cannot link a student or partner from another org", { skip: !ENABLED }, async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  const ctxA = ctxFor(a.org.id, a.admin.id);
  const foreignStudent = await prisma.student.create({ data: { orgId: b.org.id, firstName: "F", lastName: "S", email: `fs-${a.s}@example.com`, phone: "9876543210", studentCode: `F-${a.s}` } });
  const foreignPartner = await HiringPartnerService.create(ctxFor(b.org.id, b.admin.id), { name: `Foreign ${a.s}`, slug: `fp-${a.s}`, isActive: true, order: 0 });
  const ownStudent = await prisma.student.create({ data: { orgId: a.org.id, firstName: "O", lastName: "S", email: `os-${a.s}@example.com`, phone: "9876543210", studentCode: `O-${a.s}` } });
  await expectAppError(PlacementService.create(ctxA, { studentId: foreignStudent.id, jobTitle: "x", currency: "INR", status: "PENDING", isPublic: false }), /NOT_FOUND/, 404);
  await expectAppError(
    PlacementService.create(ctxA, { studentId: ownStudent.id, hiringPartnerId: foreignPartner.id, jobTitle: "x", currency: "INR", status: "PENDING", isPublic: false }),
    /NOT_FOUND/,
    404,
  );
  const ok = await PlacementService.create(ctxA, { studentId: ownStudent.id, jobTitle: "First Officer", currency: "INR", status: "PENDING", isPublic: false });
  assert.equal(ok.studentId, ownStudent.id);
});

// ─── B1: counselor document upload ──────────────────────────────────────────

function memoryStorage() {
  const objects = new Map<string, Uint8Array>();
  const deps: DocumentStorageDeps = {
    upload: async (key, data) => void objects.set(key, data),
    remove: async (key) => void objects.delete(key),
  };
  return { objects, deps };
}

test("B1 int: assigned counselor uploads; object, row, linkage, uploader and audit are consistent", { skip: !ENABLED }, async () => {
  const { org, counselorA, s } = await seedOrg();
  const admission = await seedAdmission(org.id, counselorA.id, s);
  const store = memoryStorage();
  const doc = await DocumentService.uploadFile(
    ctxFor(org.id, counselorA.id, "ADMISSIONS_COUNSELOR"),
    admission.id,
    { documentType: "AADHAR_CARD", fileName: "../../aadhaar card.pdf", declaredType: "application/pdf", bytes: PDF },
    store.deps,
  );
  assert.equal(doc.name, "aadhaar card.pdf");
  assert.equal(doc.admissionId, admission.id);
  assert.equal(doc.studentId, admission.studentId);
  assert.equal(doc.uploadedBy, counselorA.id);
  assert.equal(doc.fileMimeType, "application/pdf");
  assert.equal(doc.fileSizeBytes, PDF.length);
  assert.equal(doc.fileKey, `documents/${org.id}/${admission.id}/${doc.id}.pdf`);
  assert.equal(doc.fileUrl, `/api/v1/documents/${doc.id}/download`);
  assert.ok(doc.createdAt instanceof Date);
  assert.deepEqual(store.objects.get(doc.fileKey), PDF);
  const audit = await prisma.auditLog.findFirst({ where: { orgId: org.id, action: "document.uploaded", entityId: doc.id } });
  assert.equal(audit?.userId, counselorA.id);
});

test("B1 int: counselor cannot upload to another counselor's dossier; admin can", { skip: !ENABLED }, async () => {
  const { org, admin, counselorA, counselorB, s } = await seedOrg();
  const admission = await seedAdmission(org.id, counselorA.id, s);
  const store = memoryStorage();
  const file = { documentType: "PHOTO" as const, fileName: "p.pdf", declaredType: "application/pdf", bytes: PDF };
  await expectAppError(DocumentService.uploadFile(ctxFor(org.id, counselorB.id, "ADMISSIONS_COUNSELOR"), admission.id, file, store.deps), "FORBIDDEN", 403);
  assert.equal(store.objects.size, 0);
  const viaAdmin = await DocumentService.uploadFile(ctxFor(org.id, admin.id), admission.id, file, store.deps);
  assert.equal(viaAdmin.uploadedBy, admin.id);
});

test("B1 int: lead assignee counselor may upload even when admission counselor is unset", { skip: !ENABLED }, async () => {
  const { org, counselorB, s } = await seedOrg();
  const admission = await seedAdmission(org.id, null, s);
  await prisma.lead.update({ where: { id: admission.leadId }, data: { assignedTo: counselorB.id } });
  const doc = await DocumentService.uploadFile(
    ctxFor(org.id, counselorB.id, "ADMISSIONS_COUNSELOR"),
    admission.id,
    { documentType: "OTHER", fileName: "x.pdf", bytes: PDF },
    memoryStorage().deps,
  );
  assert.equal(doc.admissionId, admission.id);
});

test("B1 int: other org's admission is a 404 and nothing is stored", { skip: !ENABLED }, async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  const admission = await seedAdmission(a.org.id, a.counselorA.id, a.s);
  const store = memoryStorage();
  await expectAppError(
    DocumentService.uploadFile(ctxFor(b.org.id, b.admin.id), admission.id, { documentType: "OTHER", fileName: "x.pdf", bytes: PDF }, store.deps),
    /NOT_FOUND/,
    404,
  );
  assert.equal(store.objects.size, 0);
});

test("B1 int: dangerous / mismatched files rejected before storage", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  const admission = await seedAdmission(org.id, null, s);
  const store = memoryStorage();
  const ctx = ctxFor(org.id, admin.id);
  await expectAppError(
    DocumentService.uploadFile(ctx, admission.id, { documentType: "OTHER", fileName: "x.exe", bytes: new Uint8Array([0x4d, 0x5a]) }, store.deps),
    "UNSUPPORTED_FILE_TYPE",
    415,
  );
  await expectAppError(
    DocumentService.uploadFile(ctx, admission.id, { documentType: "OTHER", fileName: "x.pdf", declaredType: "text/html", bytes: PDF }, store.deps),
    "FILE_TYPE_MISMATCH",
    415,
  );
  await expectAppError(DocumentService.uploadFile(ctx, admission.id, { documentType: "OTHER", fileName: "x.pdf", bytes: new Uint8Array() }, store.deps), "EMPTY_FILE", 400);
  assert.equal(store.objects.size, 0);
  assert.equal(await prisma.document.count({ where: { admissionId: admission.id } }), 0);
});

test("B1 int: storage failure leaves no DB row (502)", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  const admission = await seedAdmission(org.id, null, s);
  const failing: DocumentStorageDeps = { upload: async () => Promise.reject(new Error("bucket down")), remove: async () => undefined };
  await expectAppError(
    DocumentService.uploadFile(ctxFor(org.id, admin.id), admission.id, { documentType: "OTHER", fileName: "x.pdf", bytes: PDF }, failing),
    "UPLOAD_FAILED",
    502,
  );
  assert.equal(await prisma.document.count({ where: { admissionId: admission.id } }), 0);
});

test("B1 int: DB failure after storage removes the stored object", { skip: !ENABLED }, async () => {
  const { org, s } = await seedOrg();
  const admission = await seedAdmission(org.id, null, s);
  const store = memoryStorage();
  // A user id that does not exist violates the uploader FK inside the transaction.
  const ghost = ctxFor(org.id, "00000000-0000-4000-8000-000000000000");
  await assert.rejects(DocumentService.uploadFile(ghost, admission.id, { documentType: "OTHER", fileName: "x.pdf", bytes: PDF }, store.deps));
  assert.equal(store.objects.size, 0, "orphaned object must be deleted");
  assert.equal(await prisma.document.count({ where: { admissionId: admission.id } }), 0);
});

test("B1 int: legacy JSON register cannot point at arbitrary or foreign keys", { skip: !ENABLED }, async () => {
  const { org, admin, s } = await seedOrg();
  const admission = await seedAdmission(org.id, null, s);
  const ctx = ctxFor(org.id, admin.id);
  await expectAppError(
    DocumentService.upload(ctx, {
      admissionId: admission.id,
      documentType: "OTHER",
      name: "x",
      fileKey: "media/other-org/secret.pdf",
      fileUrl: "https://storage.googleapis.com/airborne-aviation-media-prod/media/other-org/secret.pdf",
    }),
    "VALIDATION_ERROR",
    400,
  );
  await expectAppError(
    DocumentService.upload(ctx, {
      admissionId: admission.id,
      documentType: "OTHER",
      name: "x",
      fileKey: `documents/${org.id}/${admission.id}/a.pdf`,
      fileUrl: "https://evil.example.com/a.pdf",
    }),
    "VALIDATION_ERROR",
    400,
  );
});

// ─── B2/B3: letters ─────────────────────────────────────────────────────────

test("B2/B3 int: letters render stored dossier values, are org-scoped and audited", { skip: !ENABLED }, async () => {
  const a = await seedOrg();
  const b = await seedOrg();
  const admission = await seedAdmission(a.org.id, a.counselorA.id, a.s);
  const ctx = ctxFor(a.org.id, a.admin.id);

  const fee = await AdmissionLetterService.render(ctx, admission.id, "fee-update", NOW);
  assert.equal(fee.approved, false);
  assert.match(fee.html, /DRAFT — NOT FOR ISSUE/);
  assert.match(fee.html, new RegExp(admission.applicationNo));
  assert.match(fee.html, /Asha Rao/);
  assert.match(fee.html, /Balance Due<\/th><td>₹3,00,000\.00/);
  assert.match(fee.html, /Fee Plan: CPL 2-part/);

  const offer = await AdmissionLetterService.render(ctx, admission.id, "offer", NOW);
  assert.match(offer.html, /Offer Letter/);
  assert.equal(await prisma.auditLog.count({ where: { orgId: a.org.id, entityId: admission.id, action: { in: ["admission.offer_letter_generated", "admission.fee_update_generated"] } } }), 2);

  await expectAppError(AdmissionLetterService.render(ctxFor(b.org.id, b.admin.id), admission.id, "offer", NOW), /NOT_FOUND/, 404);
});

test("B2/B3 int: approved org copy replaces the draft banner; bad placeholders are 422", { skip: !ENABLED }, async () => {
  const { org, admin, counselorA, s } = await seedOrg();
  const admission = await seedAdmission(org.id, counselorA.id, s);
  await prisma.organization.update({
    where: { id: org.id },
    data: { settings: { letterTemplates: { offerLetter: { body: "Dear {{applicant_name}}, seat in {{course_name}}." }, feeUpdate: { body: "Hi {{nope}}" } } } },
  });
  const offer = await AdmissionLetterService.render(ctxFor(org.id, admin.id), admission.id, "offer", NOW);
  assert.equal(offer.approved, true);
  assert.match(offer.html, /Dear Asha Rao, seat in Commercial Pilot License\./);
  await expectAppError(AdmissionLetterService.render(ctxFor(org.id, admin.id), admission.id, "fee-update", NOW), "LETTER_TEMPLATE_INVALID", 422);
});
