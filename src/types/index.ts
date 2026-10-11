import type { UserRole } from "@prisma/client";

export * from "./cms";

// ─── API Response Envelope ───────────────────────────────────────────────────

export interface ApiSuccess<T> {
  success: true;
  data: T;
  meta?: PaginationMeta;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown[];
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  cursor?: string;
}

// ─── Auth / Session ──────────────────────────────────────────────────────────

export interface SessionUser {
  id: string;
  orgId: string;
  campusId: string | null;
  name: string;
  email: string;
  role: UserRole;
  avatarUrl: string | null;
}

export interface AuthSession {
  user: SessionUser;
  expires: string;
}

// ─── Request Context ─────────────────────────────────────────────────────────

export interface RequestContext {
  user: SessionUser;
  orgId: string;
  requestId: string;
  ipAddress: string;
  userAgent: string;
}

// ─── Pagination ──────────────────────────────────────────────────────────────

export interface PaginationParams {
  page?: number;
  limit?: number;
  cursor?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

// ─── Events ─────────────────────────────────────────────────────────────────

export interface BaseEvent {
  orgId: string;
  actorId: string;
  actorName: string;
  requestId: string;
  ipAddress?: string;
  timestamp: string;
}

export interface LeadCreatedEvent extends BaseEvent {
  name: "lead/created";
  data: { leadId: string; leadName: string; source: string; courseInterest?: string };
}

export interface LeadStatusChangedEvent extends BaseEvent {
  name: "lead/status.changed";
  data: { leadId: string; leadName: string; oldStatus: string; newStatus: string };
}

export interface LeadAssignedEvent extends BaseEvent {
  name: "lead/assigned";
  data: { leadId: string; leadName: string; counselorId: string; counselorName: string };
}

export interface LeadActivityCreatedEvent extends BaseEvent {
  name: "lead/activity.created";
  data: { leadId: string; leadName: string; activityId: string; activityType: string };
}

export interface UserInvitedEvent extends BaseEvent {
  name: "user/invited";
  data: { userId: string; email: string; role: string };
}

export interface AdmissionCreatedEvent extends BaseEvent {
  name: "admission/created";
  data: {
    admissionId: string;
    applicationNo: string;
    leadId: string;
    leadName: string;
    campusId?: string;
    courseId?: string;
    batchId?: string;
  };
}

export interface AdmissionStageChangedEvent extends BaseEvent {
  name: "admission/stage.changed";
  data: { admissionId: string; applicationNo: string; fromStage: string; toStage: string; studentId?: string };
}

export interface PaymentReceivedEvent extends BaseEvent {
  name: "payment/received";
  data: { paymentId: string; admissionId: string; studentId?: string; amount: string; method: string; receiptNo?: string };
}

export interface PaymentRefundedEvent extends BaseEvent {
  name: "payment.refunded";
  data: {
    paymentId: string;
    admissionId: string;
    studentId?: string;
    amount: string;
    refundedAmount: string;
    status: string;
    receiptNo?: string;
  };
}

export interface DocumentUploadedEvent extends BaseEvent {
  name: "document/uploaded";
  data: { documentId: string; admissionId?: string; studentId?: string; documentType: string; name: string };
}

export interface DocumentReviewedEvent extends BaseEvent {
  name: "document/reviewed";
  data: { documentId: string; admissionId?: string; studentId?: string; status: string; reviewedBy: string };
}

// ─── Sprint 3 — CMS Events ───────────────────────────────────────────────────

export interface MediaUploadedEvent extends BaseEvent {
  name: "media/uploaded";
  data: { assetId: string; name: string; mimeType: string; folderId?: string };
}

export interface MediaReplacedEvent extends BaseEvent {
  name: "media/replaced";
  data: { assetId: string; oldFileKey: string; newFileKey: string };
}

export interface MediaDeletedEvent extends BaseEvent {
  name: "media/deleted";
  data: { assetId: string; name: string };
}

export interface PageStatusChangedEvent extends BaseEvent {
  name: "page/status.changed";
  data: { pageId: string; slug: string; fromStatus: string; toStatus: string; version: number; scheduledAt?: string };
}

export interface PagePublishedEvent extends BaseEvent {
  name: "page/published";
  data: { pageId: string; slug: string; version: number; versionId: string };
}

export interface CourseStatusChangedEvent extends BaseEvent {
  name: "course/status.changed";
  data: { courseId: string; slug: string; title: string; fromStatus: string; toStatus: string; scheduledAt?: string };
}

export interface CoursePublishedEvent extends BaseEvent {
  name: "course/published";
  data: { courseId: string; slug: string; title: string; version: number; versionId: string };
}

export interface ContentVersionCreatedEvent extends BaseEvent {
  name: "content/version.created";
  data: { entityType: "page" | "course"; entityId: string; version: number; versionId: string; notes?: string };
}

export interface CmsScheduledCheckEvent extends BaseEvent {
  name: "cms/scheduled.check";
  data: Record<string, never>;
}

// ─── Sprint 4 — Business Content Events ──────────────────────────────────────

export interface ResourcePublishedEvent extends BaseEvent {
  name: "resource/published";
  data: { resourceId: string; slug: string; title: string; type: string };
}

export interface ResourceStatusChangedEvent extends BaseEvent {
  name: "resource/status.changed";
  data: { resourceId: string; slug: string; fromStatus: string; toStatus: string };
}

export interface JobPublishedEvent extends BaseEvent {
  name: "job/published";
  data: { jobId: string; slug: string; title: string; hiringPartnerId?: string };
}

export interface JobStatusChangedEvent extends BaseEvent {
  name: "job/status.changed";
  data: { jobId: string; slug: string; fromStatus: string; toStatus: string };
}

export interface JobApplicationSubmittedEvent extends BaseEvent {
  name: "job_application/submitted";
  data: { applicationId: string; jobId: string; jobTitle: string; applicantName: string; applicantEmail: string };
}

export interface JobApplicationStatusChangedEvent extends BaseEvent {
  name: "job_application/status.changed";
  data: { applicationId: string; jobId: string; fromStatus: string; toStatus: string; applicantEmail: string };
}

export interface PlacementCreatedEvent extends BaseEvent {
  name: "placement/created";
  data: { placementId: string; studentId: string; jobTitle: string; hiringPartnerId?: string };
}

export interface PlacementUpdatedEvent extends BaseEvent {
  name: "placement/updated";
  data: { placementId: string; studentId: string; status: string };
}

export interface TestimonialSubmittedEvent extends BaseEvent {
  name: "testimonial/submitted";
  data: { testimonialId: string; authorName: string; courseId?: string };
}

export interface TestimonialReviewedEvent extends BaseEvent {
  name: "testimonial/reviewed";
  data: { testimonialId: string; status: string; reviewedBy: string };
}

// ─── Interconnect OS — workflow control plane ────────────────────────────────

export interface WorkflowRunRequestedEvent extends BaseEvent {
  name: "workflow/run.requested";
  data: { runId: string };
}

// ─── Interconnect OS — WhatsApp lifecycle (canonical dot-notation) ───────────

export interface WhatsAppRepliedEvent extends BaseEvent {
  name: "whatsapp.replied";
  data: { conversationId: string; leadId?: string; phone: string; body: string; externalId?: string };
}

export interface WhatsAppOptedOutEvent extends BaseEvent {
  name: "whatsapp.opted_out";
  data: { conversationId: string; leadId?: string; phone: string };
}

export interface WhatsAppStatusEvent extends BaseEvent {
  name: "whatsapp.sent" | "whatsapp.delivered" | "whatsapp.read" | "whatsapp.failed";
  data: { messageId: string; conversationId: string; leadId?: string; externalId?: string };
}

export interface CourseEnrolledEvent extends BaseEvent {
  name: "course.enrolled";
  data: {
    studentId: string;
    studentName: string;
    courseId: string;
    courseName: string;
    batchId?: string;
    batchName?: string;
  };
}

// ─── Section 3 — CRM Pipeline / Deal lifecycle ───────────────────────────────

export interface DealCreatedEvent extends BaseEvent {
  name: "deal/created";
  data: { dealId: string; leadId: string; title: string; stage: string };
}

export interface DealStageChangedEvent extends BaseEvent {
  name: "deal/stage.changed";
  data: { dealId: string; leadId: string; fromStage: string; toStage: string };
}

export interface DealAssignedEvent extends BaseEvent {
  name: "deal/assigned";
  data: { dealId: string; counselorId: string; counselorName: string };
}

export interface DealConvertedToAdmissionEvent extends BaseEvent {
  name: "deal/converted_to_admission";
  data: { dealId: string; admissionId: string; applicationNo: string; leadId: string };
}

export interface DealRevertedToProspectEvent extends BaseEvent {
  name: "deal/reverted_to_prospect";
  data: { dealId: string; leadId: string };
}

export interface LeadBulkAssignedEvent extends BaseEvent {
  name: "lead/bulk.assigned";
  data: { leadIds: string[]; count: number; counselorId: string; counselorName: string };
}

export type AppEvent =
  | LeadCreatedEvent
  | LeadStatusChangedEvent
  | LeadAssignedEvent
  | LeadActivityCreatedEvent
  | UserInvitedEvent
  | AdmissionCreatedEvent
  | AdmissionStageChangedEvent
  | PaymentReceivedEvent
  | PaymentRefundedEvent
  | DocumentUploadedEvent
  | DocumentReviewedEvent
  | MediaUploadedEvent
  | MediaReplacedEvent
  | MediaDeletedEvent
  | PageStatusChangedEvent
  | PagePublishedEvent
  | CourseStatusChangedEvent
  | CoursePublishedEvent
  | ContentVersionCreatedEvent
  | CmsScheduledCheckEvent
  | ResourcePublishedEvent
  | ResourceStatusChangedEvent
  | JobPublishedEvent
  | JobStatusChangedEvent
  | JobApplicationSubmittedEvent
  | JobApplicationStatusChangedEvent
  | PlacementCreatedEvent
  | PlacementUpdatedEvent
  | TestimonialSubmittedEvent
  | TestimonialReviewedEvent
  | WorkflowRunRequestedEvent
  | WhatsAppRepliedEvent
  | WhatsAppOptedOutEvent
  | WhatsAppStatusEvent
  | CourseEnrolledEvent
  | DealCreatedEvent
  | DealStageChangedEvent
  | DealAssignedEvent
  | DealConvertedToAdmissionEvent
  | DealRevertedToProspectEvent
  | LeadBulkAssignedEvent;
