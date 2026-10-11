import { DocumentRepository } from "@/lib/repositories/document.repository";
import { AuditService } from "@/lib/services/audit.service";
import { ActivityFeedService } from "@/lib/services/activity.service";
import { emitEvent } from "@/lib/events/inngest";
import { randomUUID } from "node:crypto";
import type { DocumentType } from "@prisma/client";
import { NotFoundError, ForbiddenError, StorageUnavailableError, AppError } from "@/lib/utils/errors";
import { prisma } from "@/lib/db/client";
import {
  createSignedUploadUrl,
  createSignedReadUrl,
  deleteObject,
  getPublicUrl,
  isLocalStorageDriver,
  isStorageConfigured,
  readLocalObject,
  uploadObject,
} from "@/lib/storage/gcs";
import { ALLOWED_DOCUMENT_TYPES, checkDocumentFile, documentStorageKey, fileExtension } from "@/lib/documents/upload-policy";
import type { UploadDocumentInput, ReviewDocumentInput, DocumentFilters } from "@/lib/validations/document.schema";
import type { RequestContext } from "@/types";

export interface DocumentStorageDeps {
  upload: (key: string, data: Uint8Array, contentType: string) => Promise<unknown>;
  remove: (key: string) => Promise<void>;
}

const defaultStorage: DocumentStorageDeps = { upload: uploadObject, remove: deleteObject };

export function documentDownloadPath(documentId: string): string {
  return `/api/v1/documents/${documentId}/download`;
}

/**
 * Counselors may only touch dossiers they own (admission counselor or lead assignee);
 * other roles holding documents:write are org-wide.
 */
export async function assertDossierAccess(ctx: RequestContext, admissionId: string) {
  const admission = await prisma.admission.findFirst({
    where: { id: admissionId, orgId: ctx.orgId },
    select: { id: true, studentId: true, counselorId: true, applicationNo: true, lead: { select: { assignedTo: true } } },
  });
  if (!admission) throw new NotFoundError("Admission", admissionId);
  if (ctx.user.role === "ADMISSIONS_COUNSELOR") {
    const owns = admission.counselorId === ctx.user.id || admission.lead?.assignedTo === ctx.user.id;
    if (!owns) throw new ForbiddenError("write", "documents");
  }
  return admission;
}

export class DocumentService {
  static async list(ctx: RequestContext, filters: DocumentFilters) {
    return DocumentRepository.findMany(ctx.orgId, filters);
  }

  static async getById(ctx: RequestContext, id: string) {
    const doc = await DocumentRepository.findById(ctx.orgId, id);
    if (!doc) throw new NotFoundError("Document", id);
    return doc;
  }

  // Signed upload URL on the shared media bucket (caller uploads directly, then calls upload())
  static async getPresignedUrl(
    ctx: RequestContext,
    admissionId: string,
    fileName: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; fileKey: string; fileUrl: string }> {
    if (!isStorageConfigured()) {
      throw new StorageUnavailableError("Media storage is not configured.");
    }
    await assertDossierAccess(ctx, admissionId);
    const ext = fileExtension(fileName);
    if (!["pdf", "jpg", "jpeg", "png", "webp"].includes(ext) || !(contentType in ALLOWED_DOCUMENT_TYPES)) {
      throw new AppError("UNSUPPORTED_FILE_TYPE", "Only PDF, JPG, PNG or WEBP documents can be uploaded.", 415);
    }
    const fileKey = documentStorageKey(ctx.orgId, admissionId, randomUUID(), ext);
    const uploadUrl = await createSignedUploadUrl(fileKey, contentType, 300);
    return { uploadUrl, fileKey, fileUrl: getPublicUrl(fileKey) };
  }

  static async upload(ctx: RequestContext, input: UploadDocumentInput) {
    if (!input.admissionId) throw new AppError("VALIDATION_ERROR", "admissionId is required", 400);
    const admission = await assertDossierAccess(ctx, input.admissionId);

    // Registered objects must live under this org's dossier prefix issued by getPresignedUrl.
    const prefix = `documents/${ctx.orgId}/${admission.id}/`;
    if (!input.fileKey.startsWith(prefix) || input.fileKey.includes("..") || input.fileUrl !== getPublicUrl(input.fileKey)) {
      throw new AppError("VALIDATION_ERROR", "fileKey/fileUrl must reference an object issued for this admission", 400);
    }

    if (input.studentId && input.studentId !== admission.studentId) {
      throw new AppError("VALIDATION_ERROR", "studentId does not match the admission's student", 400);
    }

    const doc = await DocumentRepository.create(ctx.orgId, ctx.user.id, {
      ...input,
      studentId: admission.studentId ?? undefined,
    });

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: "document.uploaded",
      entityType: "document",
      entityId: doc.id,
      newValue: { name: doc.name, documentType: doc.documentType, admissionId: input.admissionId },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "uploaded",
      objectType: "document",
      objectId: doc.id,
      objectSnapshot: { name: doc.name, documentType: doc.documentType },
      targetType: input.admissionId ? "admission" : input.studentId ? "student" : undefined,
      targetId: input.admissionId ?? input.studentId,
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "document/uploaded",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        documentId: doc.id,
        admissionId: input.admissionId,
        studentId: input.studentId,
        documentType: doc.documentType,
        name: doc.name,
      },
    });

    return doc;
  }

  /**
   * Server-side upload: the file is validated by content, stored under a server-generated
   * key, then recorded. A failed DB write removes the stored object; a failed storage
   * write leaves no row.
   */
  static async uploadFile(
    ctx: RequestContext,
    admissionId: string,
    input: { documentType: DocumentType; fileName: string; declaredType?: string; bytes: Uint8Array },
    storage: DocumentStorageDeps = defaultStorage,
  ) {
    const admission = await assertDossierAccess(ctx, admissionId);
    const check = checkDocumentFile({ name: input.fileName, declaredType: input.declaredType, bytes: input.bytes });
    if (!check.ok) {
      const status = check.code === "FILE_TOO_LARGE" ? 413 : check.code === "EMPTY_FILE" ? 400 : 415;
      throw new AppError(check.code, check.message, status);
    }

    const documentId = randomUUID();
    const fileKey = documentStorageKey(ctx.orgId, admission.id, documentId, check.ext);

    try {
      await storage.upload(fileKey, input.bytes, check.mime);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError("UPLOAD_FAILED", "Document storage is unavailable; nothing was saved.", 502);
    }

    let doc;
    try {
      doc = await prisma.$transaction(async (tx) => {
        const row = await tx.document.create({
          data: {
            id: documentId,
            orgId: ctx.orgId,
            uploadedBy: ctx.user.id,
            documentType: input.documentType,
            name: check.displayName,
            fileUrl: documentDownloadPath(documentId),
            fileKey,
            fileMimeType: check.mime,
            fileSizeBytes: input.bytes.length,
            admissionId: admission.id,
            studentId: admission.studentId,
          },
          include: { uploader: { select: { id: true, name: true, avatarUrl: true } } },
        });
        await AuditService.write(
          {
            orgId: ctx.orgId,
            userId: ctx.user.id,
            requestId: ctx.requestId,
            ipAddress: ctx.ipAddress,
            action: "document.uploaded",
            entityType: "document",
            entityId: documentId,
            newValue: {
              name: row.name,
              documentType: row.documentType,
              admissionId: admission.id,
              studentId: admission.studentId,
              fileMimeType: check.mime,
              fileSizeBytes: input.bytes.length,
            },
          },
          tx,
        );
        return row;
      });
    } catch (err) {
      await storage.remove(fileKey).catch(() => undefined);
      throw err;
    }

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: "uploaded",
      objectType: "document",
      objectId: doc.id,
      objectSnapshot: { name: doc.name, documentType: doc.documentType },
      targetType: "admission",
      targetId: admission.id,
      context: { actorName: ctx.user.name },
    });

    await emitEvent({
      name: "document/uploaded",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        documentId: doc.id,
        admissionId: admission.id,
        studentId: admission.studentId ?? undefined,
        documentType: doc.documentType,
        name: doc.name,
      },
    });

    return doc;
  }

  /** Resolves an org-scoped document to either local bytes (test driver) or a short-lived signed URL. */
  static async resolveDownload(ctx: RequestContext, id: string) {
    const doc = await prisma.document.findFirst({
      where: { id, orgId: ctx.orgId },
      select: { id: true, name: true, fileKey: true, fileUrl: true, fileMimeType: true },
    });
    if (!doc) throw new NotFoundError("Document", id);
    if (isLocalStorageDriver()) {
      const bytes = await readLocalObject(doc.fileKey);
      if (!bytes) throw new NotFoundError("Document file", id);
      return { kind: "bytes" as const, doc, bytes };
    }
    if (!doc.fileKey.startsWith("documents/")) {
      return { kind: "redirect" as const, doc, url: doc.fileUrl };
    }
    return { kind: "redirect" as const, doc, url: await createSignedReadUrl(doc.fileKey, doc.name) };
  }

  static async review(ctx: RequestContext, id: string, input: ReviewDocumentInput) {
    const doc = await this.getById(ctx, id);

    // Only ADMIN/ORG_ADMIN can approve/reject
    if (input.status !== "UNDER_REVIEW") {
      const canApprove = ["SUPER_ADMIN", "ADMIN"].includes(ctx.user.role);
      if (!canApprove) throw new ForbiddenError("approve", "documents");
    }

    if (input.status === "REJECTED" && !input.rejectionReason) {
      throw new Error("rejectionReason is required when rejecting a document");
    }

    const updated = await DocumentRepository.review(
      ctx.orgId,
      id,
      ctx.user.id,
      input.status,
      input.rejectionReason,
    );

    await AuditService.write({
      orgId: ctx.orgId,
      userId: ctx.user.id,
      requestId: ctx.requestId,
      ipAddress: ctx.ipAddress,
      action: `document.${input.status.toLowerCase()}`,
      entityType: "document",
      entityId: id,
      oldValue: { status: doc.status },
      newValue: { status: input.status, rejectionReason: input.rejectionReason },
    });

    await ActivityFeedService.write({
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      verb: input.status === "APPROVED" ? "approved" : input.status === "REJECTED" ? "rejected" : "marked_under_review",
      objectType: "document",
      objectId: id,
      objectSnapshot: { name: doc.name, documentType: doc.documentType },
      context: { actorName: ctx.user.name, status: input.status },
    });

    await emitEvent({
      name: "document/reviewed",
      orgId: ctx.orgId,
      actorId: ctx.user.id,
      actorName: ctx.user.name,
      requestId: ctx.requestId,
      timestamp: new Date().toISOString(),
      data: {
        documentId: id,
        admissionId: doc.admissionId ?? undefined,
        studentId: doc.studentId ?? undefined,
        status: input.status,
        reviewedBy: ctx.user.id,
      },
    });

    return updated;
  }
}
