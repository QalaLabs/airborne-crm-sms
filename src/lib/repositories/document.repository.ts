import { prisma } from "@/lib/db/client";
import type { Prisma } from "@prisma/client";
import type { DocumentFilters, UploadDocumentInput } from "@/lib/validations/document.schema";

const DOCUMENT_SELECT = {
  id: true,
  orgId: true,
  studentId: true,
  admissionId: true,
  uploadedBy: true,
  reviewedBy: true,
  documentType: true,
  name: true,
  fileUrl: true,
  fileKey: true,
  fileMimeType: true,
  fileSizeBytes: true,
  status: true,
  reviewedAt: true,
  rejectionReason: true,
  expiresAt: true,
  metadata: true,
  createdAt: true,
  updatedAt: true,
  uploader: { select: { id: true, name: true, avatarUrl: true } },
  reviewer: { select: { id: true, name: true } },
} satisfies Prisma.DocumentSelect;

export class DocumentRepository {
  static async findMany(orgId: string, filters: DocumentFilters) {
    const where: Prisma.DocumentWhereInput = {
      orgId,
      ...(filters.status && { status: filters.status }),
      ...(filters.documentType && { documentType: filters.documentType }),
      ...(filters.studentId && { studentId: filters.studentId }),
      ...(filters.admissionId && { admissionId: filters.admissionId }),
    };

    const skip = (filters.page - 1) * filters.limit;
    const [data, total] = await Promise.all([
      prisma.document.findMany({
        where,
        select: DOCUMENT_SELECT,
        skip,
        take: filters.limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.document.count({ where }),
    ]);
    return { data, total };
  }

  static async findById(orgId: string, id: string) {
    return prisma.document.findFirst({ where: { id, orgId }, select: DOCUMENT_SELECT });
  }

  static async create(orgId: string, uploadedBy: string, data: UploadDocumentInput) {
    return prisma.document.create({
      data: {
        orgId,
        uploadedBy,
        documentType: data.documentType,
        name: data.name,
        fileUrl: data.fileUrl,
        fileKey: data.fileKey,
        fileMimeType: data.fileMimeType,
        fileSizeBytes: data.fileSizeBytes,
        studentId: data.studentId,
        admissionId: data.admissionId,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        metadata: (data.metadata ?? {}) as Prisma.InputJsonValue,
      },
      select: DOCUMENT_SELECT,
    });
  }

  static async review(
    orgId: string,
    id: string,
    reviewedBy: string,
    status: "UNDER_REVIEW" | "APPROVED" | "REJECTED",
    rejectionReason?: string,
  ) {
    return prisma.document.update({
      where: { id, orgId },
      data: {
        status,
        reviewedBy,
        reviewedAt: new Date(),
        ...(rejectionReason !== undefined && { rejectionReason }),
      },
      select: DOCUMENT_SELECT,
    });
  }

  static async countByAdmission(orgId: string, admissionId: string) {
    return prisma.document.groupBy({
      by: ["status"],
      where: { admissionId, orgId },
      _count: { status: true },
    });
  }
}
