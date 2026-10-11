// Real persisted CRM types served by /api/v1/crm/*

export interface AnalyticsTotals {
  leads: number;
  pipeline: number;
  converted: number;
  lost: number;
  admissionLeads: number;
  conversionRate: string;
  admissions: number;
  avgAdmissionFee: number | null;
  revenue: number;
  payments: number;
  students: number;
  counselors: number;
  activities: number;
  meetings: number;
  calls: number;

  // Phase 2 overview metrics
  activeLeads: number;
  newLeadsToday: number;
  todayFollowUps: number;
  opportunitySales: number;
  opportunityCollections: number;
  collectionsToday: number;
  totalCollections: number;
  totalCollectionPending: number;
  totalFeeBilled?: number;
  totalFeePaid?: number;
  collectionPct: string;
  workableLeads: number;
  workablePct: string;

  // Deal pipeline metrics (SECTION 3)
  dealsOpen: number;
  dealsWon: number;
  dealsLost: number;
  dealPipelineByStage: Record<string, number>;
}

export interface AnalyticsMonth {
  key: string;
  label: string;
  leads: number;
  admissions: number;
  revenue: number;
}

export interface AnalyticsSourceRow {
  source: string;
  leads: number;
  admissions: number;
  conversion: string;
  lost?: number;
  workableLeads?: number;
  workablePct?: string;
}

export interface AnalyticsStatusRow {
  status: string;
  count: number;
}

export interface AnalyticsCounselorRow {
  counselorId: string;
  name: string;
  leads: number;
  admissions: number;
  conversion: string;
  calls: number;
  meetings: number;
  emails: number;
  collections?: number;
  collectionPct?: string;
}

export interface AnalyticsRangeInfo {
  from: string;
  to: string;
  fromInput: string;
  toInput: string;
  timezone: string;
}

export interface AnalyticsData {
  range: AnalyticsRangeInfo | null;
  scope: "counselor" | "organization";
  totals: AnalyticsTotals;
  monthly: AnalyticsMonth[];
  bySource: AnalyticsSourceRow[];
  byStatus: AnalyticsStatusRow[];
  byCounselor: AnalyticsCounselorRow[];
}

export interface OutreachTemplate {
  id: string;
  event: string;
  channel: string;
  name: string;
  subject: string | null;
  body: string;
  variables: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachLog {
  id: string;
  event: string | null;
  channel: string;
  recipient: string;
  subject: string | null;
  status: string;
  errorMsg: string | null;
  externalId: string | null;
  entityType: string | null;
  entityId: string | null;
  sentAt: string | null;
  createdAt: string;
  template: { id: string; name: string } | null;
}

export type OutreachProviderStatus =
  | "not_configured"
  | "configured_not_verified"
  | "connected";

export interface OutreachProvider {
  configured: boolean;
  verified: boolean;
  status: OutreachProviderStatus;
  provider: string;
  note: string;
}

export interface OutreachData {
  templates: OutreachTemplate[];
  logs: OutreachLog[];
  statusBreakdown: Record<string, number>;
  delivery: {
    total: number;
    sent: number;
    failed: number;
    pending: number;
    whatsappReplies: number;
    /** null when not measurable with persisted data — never a fabricated 0. */
    emailOpenRate: number | null;
    replyRate: number | null;
  };
  providers: {
    email: OutreachProvider;
    sms: OutreachProvider;
    whatsapp: OutreachProvider;
  };
  dispatchEngine: { automationEnabled: boolean; note: string };
}

export interface MeetingLead {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  courseInterest: string | null;
  status: string;
  campusId: string | null;
  assignedTo: string | null;
  counselor: { id: string; name: string } | null;
}

export interface Meeting {
  id: string;
  leadId: string;
  performedBy: string | null;
  title: string | null;
  notes: string | null;
  outcome: string | null;
  nextAction: string | null;
  dueAt: string | null;
  completedAt: string | null;
  durationMins: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  lead: MeetingLead;
  performer: { id: string; name: string; avatarUrl: string | null } | null;
}

export interface MeetingsData {
  scope: "upcoming" | "past" | "all";
  meetings: Meeting[];
}

export interface DealData {
  capability: {
    deals: boolean;
    status: string;
    reason: string;
  };
  pipeline: {
    byStage: { stage: string; count: number; value: number }[];
    won: number;
    wonValue: number;
    lost: number;
    lostValue: number;
    open: number;
    openValue: number;
  };
  recentDeals: DealRecord[];
  recentWonDeals: DealRecord[];
}

export interface DealRecord {
  id: string;
  orgId: string;
  leadId: string;
  admissionId: string | null;
  title: string;
  stage: string;
  value: string | number | null;
  currency: string;
  expectedCloseAt: string | null;
  source: string | null;
  assignedTo: string | null;
  createdBy: string | null;
  notes: string | null;
  lostReason: string | null;
  wonAt: string | null;
  lostAt: string | null;
  convertedAt: string | null;
  revertedAt: string | null;
  isActive: boolean;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  lead: {
    id: string;
    name: string;
    phone: string;
    email: string | null;
    status: string;
    score: number;
    assignedTo: string | null;
    campusId: string | null;
  } | null;
  admission: {
    id: string;
    applicationNo: string;
    stage: string;
    courseName: string | null;
    feeAmount: string | number | null;
    feePaid: string | number | null;
    feeBalance: string | number | null;
  } | null;
  counselor: { id: string; name: string; avatarUrl: string | null; email: string } | null;
  creator: { id: string; name: string; avatarUrl: string | null } | null;
}

export interface DealRecordFilters {
  stage?: string;
  isActive?: boolean | "true" | "false";
  status?: "open" | "won" | "lost";
  assignedTo?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface IntegrationStatus {
  status: "connected" | "not_configured" | "removed";
  provider?: string;
  note?: string;
  required?: string[];
  assets?: number;
}

export interface IntegrationsData {
  crm: IntegrationStatus;
  facebook: IntegrationStatus;
  googleAds: IntegrationStatus;
  frappe: IntegrationStatus;
  media: IntegrationStatus;
  documents: IntegrationStatus;
  automation: IntegrationStatus;
  payments: IntegrationStatus;
  summary: {
    connected: string[];
    notConfigured: string[];
  };
}
