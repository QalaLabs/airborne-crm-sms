import { z } from "zod";
import { DocumentType, DocumentStatus } from "@prisma/client";

export const uploadDocumentSchema = z.object({
  documentType: z.nativeEnum(DocumentType),
  name: z.string().min(1).max(255),
  fileUrl: z.string().url(),
  fileKey: z.string().min(1).max(500),
  fileMimeType: z.string().max(100).optional(),
  fileSizeBytes: z.number().int().positive().optional(),
  studentId: z.string().uuid().optional(),
  admissionId: z.string().uuid().optional(),
  expiresAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const multipartDocumentSchema = z.object({
  documentType: z.nativeEnum(DocumentType, { errorMap: () => ({ message: "Choose a valid document type" }) }),
});

export const reviewDocumentSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "APPROVED", "REJECTED"]),
  rejectionReason: z.string().max(1000).optional(),
});

export const documentFiltersSchema = z.object({
  status: z.nativeEnum(DocumentStatus).optional(),
  documentType: z.nativeEnum(DocumentType).optional(),
  studentId: z.string().uuid().optional(),
  admissionId: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const getPresignedUrlSchema = z.object({
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(100),
  admissionId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
});

export type UploadDocumentInput = z.infer<typeof uploadDocumentSchema>;
export type ReviewDocumentInput = z.infer<typeof reviewDocumentSchema>;
export type DocumentFilters = z.infer<typeof documentFiltersSchema>;
export type GetPresignedUrlInput = z.infer<typeof getPresignedUrlSchema>;
