import { cn } from "@/lib/utils";

// Lead statuses
const LEAD_STATUS_COLORS: Record<string, string> = {
  NEW: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  CONTACTED: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  INTERESTED: "bg-green-500/20 text-green-400 border-green-500/30",
  NOT_INTERESTED: "bg-red-500/20 text-red-400 border-red-500/30",
  FOLLOW_UP: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  COUNSELED: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  APPLICATION_SUBMITTED: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  CONVERTED: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  LOST: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  CONNECTED: "bg-teal-500/20 text-teal-400 border-teal-500/30",
  CALL_BACK: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  PROSPECT: "bg-lime-500/20 text-lime-400 border-lime-500/30",
  WON: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  NOT_CONNECTED: "bg-slate-500/20 text-slate-400 border-slate-500/30",
  RINGING: "bg-sky-500/20 text-sky-400 border-sky-500/30",
  NOT_REACHABLE: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  SWITCHED_OFF: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  VOICEMAIL: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30",
  INCOMING_BARD: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  OUT_OF_SERVICE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  NOT_AWARE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  NOT_CONTACTABLE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  LOCATION_OUT_OF_SCOPE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  LANGUAGE_BARRIER: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  PRICE_HIGH: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  JOINED_OTHERS: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  NOT_ELIGIBLE: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  INVALID_NUMBER: "bg-gray-500/10 text-gray-400 border-gray-500/30",
  TEST_LEAD: "bg-gray-500/10 text-gray-400 border-gray-500/30",
};

// Admission stages
const ADMISSION_STAGE_COLORS: Record<string, string> = {
  INQUIRY: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  DOCUMENT_COLLECTION: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  INTERVIEW: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  ENROLLED: "bg-green-500/20 text-green-400 border-green-500/30",
  REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
};

// Job statuses
const JOB_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  PUBLISHED: "bg-green-500/20 text-green-400 border-green-500/30",
  CLOSED: "bg-red-500/20 text-red-400 border-red-500/30",
  ARCHIVED: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

// Job application statuses
const JOB_APPLICATION_STATUS_COLORS: Record<string, string> = {
  SUBMITTED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  UNDER_REVIEW: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  SHORTLISTED: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  INTERVIEW_SCHEDULED: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  SELECTED: "bg-green-500/20 text-green-400 border-green-500/30",
  REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
  WITHDRAWN: "bg-gray-500/20 text-gray-400 border-gray-500/30",
};

// Resource statuses
const RESOURCE_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  PUBLISHED: "bg-green-500/20 text-green-400 border-green-500/30",
  ARCHIVED: "bg-red-500/20 text-red-400 border-red-500/30",
};

// Testimonial statuses
const TESTIMONIAL_STATUS_COLORS: Record<string, string> = {
  PENDING: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  APPROVED: "bg-green-500/20 text-green-400 border-green-500/30",
  REJECTED: "bg-red-500/20 text-red-400 border-red-500/30",
};

// Student statuses
const STUDENT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-500/20 text-green-400 border-green-500/30",
  INACTIVE: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  GRADUATED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  DROPPED: "bg-red-500/20 text-red-400 border-red-500/30",
};

// Course statuses
const COURSE_STATUS_COLORS: Record<string, string> = {
  DRAFT: "bg-gray-500/20 text-gray-400 border-gray-500/30",
  PUBLISHED: "bg-green-500/20 text-green-400 border-green-500/30",
  ARCHIVED: "bg-red-500/20 text-red-400 border-red-500/30",
};

type StatusDomain = "lead" | "admission" | "job" | "job_application" | "resource" | "testimonial" | "student" | "course";

const DOMAIN_MAP: Record<StatusDomain, Record<string, string>> = {
  lead: LEAD_STATUS_COLORS,
  admission: ADMISSION_STAGE_COLORS,
  job: JOB_STATUS_COLORS,
  job_application: JOB_APPLICATION_STATUS_COLORS,
  resource: RESOURCE_STATUS_COLORS,
  testimonial: TESTIMONIAL_STATUS_COLORS,
  student: STUDENT_STATUS_COLORS,
  course: COURSE_STATUS_COLORS,
};

interface StatusBadgeProps {
  status: string;
  domain: StatusDomain;
  className?: string;
}

export function StatusBadge({ status, domain, className }: StatusBadgeProps) {
  const colorMap = DOMAIN_MAP[domain] ?? {};
  const colors = colorMap[status] ?? "bg-muted text-muted-foreground border-border";
  const label = status.replace(/_/g, " ");

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold",
        colors,
        className,
      )}
    >
      {label}
    </span>
  );
}
