# Airborne OS Implementation Plan — Comprehensive Overhaul

This implementation plan addresses the 15 specific operational, workflow, and UX requirements requested for **Airborne OS** (`airborne-admin`).

---

## 📌 Requirement Matrix & Technical Architecture

| # | Feedback Area | Target Files | Key Technical Change |
|---|---|---|---|
| **1** | Clickable Dashboard Stat Boxes | `src/app/(dashboard)/page.tsx` | Wrap cards in `Link` components with query params (e.g., `/leads?filter=today`, `/leads?filter=week`, `/payments`). |
| **2** | Non-mandatory Email for Leads | `src/lib/validations/lead.schema.ts`, `src/app/(dashboard)/leads/page.tsx`, `prisma/schema.prisma` | Phone is already the primary unique key (`@db.VarChar(20)`), email is already optional in DB (`email String?`). Update Zod and UI forms to remove `*` and make email fully optional. |
| **3** | Admin & Super Admin Edit Lead Profile | `src/app/(dashboard)/leads/[id]/page.tsx`, `src/app/api/v1/leads/[id]/route.ts` | Add "Edit Details" modal for Admin/Super Admin to update Name, Phone, Course, City, etc. Write `lead.updated` to `ActivityFeed` so it logs on the timeline. |
| **4 & 5** | Direct Stage Jump & Funnel Restructuring | `src/lib/services/admission.service.ts`, `src/app/(dashboard)/admissions/page.tsx`, `src/app/(dashboard)/crm/lead-pipeline/page.tsx` | Update stages: `PROSPECT / ENQUIRY` ➔ `ADMISSION` ➔ `VERIFICATION` ➔ `ENROLLED` (Terminal: `CANCELLED`, `DROPPED`). Allow jumping from `VERIFICATION` directly to `ENROLLED`. |
| **6** | Kanban Pipeline with Meeting Gate for Prospect | `src/app/(dashboard)/crm/lead-pipeline/page.tsx`, `src/lib/crm/deals.ts` | Render Kanban: `NEW`, `INTERESTED`, `PROSPECT`, `ADMISSION`, `LOST`, `NOT_CONNECTED`. Gated validation: Dragging to `PROSPECT` checks if an Online or Campus Visit meeting is scheduled; if not, pops up Meeting Schedule modal. |
| **7** | Direct "Convert to Student" in Student Database | `src/app/(dashboard)/students/page.tsx`, `src/app/api/v1/admissions/convert-lead/route.ts` | Add "Admit Lead as Student" button with a Lead search modal. Converts lead to `WON`, creates admission/student draft dossier, and redirects to dossier. |
| **8 & 9** | Imported Leads Lifecycle & Analytics Sync | `src/lib/analytics/report.service.ts`, `src/lib/services/lead.service.ts`, `src/app/(dashboard)/students/page.tsx` | Ensure `source: IMPORTED` or batch-imported leads create dossier on `WON` and are included in all `buildAnalyticsReport` SQL queries. |
| **10** | Automated Admission & Payment Receipt Emails | `src/lib/messaging/providers/smtp.provider.ts`, `src/lib/services/payment.service.ts`, `src/lib/services/admission.service.ts` | Auto-trigger email with styled HTML invoice receipt on payment creation, and enrollment/offer letter on admission reaching `ENROLLED`. |
| **11** | Logic for Pending Payment in Ledger | `src/app/(dashboard)/payments/page.tsx`, `src/lib/repositories/payment.repository.ts` | Currently `PaymentTransaction` only stores recorded payments (COMPLETED/REFUNDED). Clarify and fix: Display admissions with `feeBalance > 0` or pending installments in a "Pending / Receivables" ledger view. |
| **12** | New Finance "Collections" Page | `src/app/(dashboard)/finance/collections/page.tsx`, `src/components/layout/sidebar.tsx` | Create 2-table view: **Fees Due This Month** and **Overdue Fees**. Columns: Student, Admission Date, Course Fees, Pending Amount, Due Date, Remarks. Remarks sync to unified timeline. |
| **13** | Unified Timeline on Student Profile | `src/app/(dashboard)/students/[id]/page.tsx`, `src/app/api/v1/students/[id]/timeline/route.ts` | Embed `UnifiedTimeline` in Student Profile merging lead activity (`leadId`) + admission stage changes + payment logs. |
| **14** | One-Click WhatsApp Web / Desktop with Dynamic Templates | `src/app/(dashboard)/leads/[id]/page.tsx` | Add 2 buttons beside Phone: Direct WhatsApp Web link (`https://wa.me/91.../?text=...`) pre-filled with stage-specific greeting, and Interakt template trigger. |
| **15** | Preview Deployment & GCR Cutover | Cloud Run / Cloud Build CLI | Docker build tagged `preview-v2`, deploy to temporary Cloud Run URL for review before switching production domain traffic. |

---

## 🛠️ Step-by-Step Execution Phases

### Phase 1: High-Impact UI & Navigation Fixes (Tasks 1, 2, 14)
- Make all 10 dashboard boxes clickable with targeted filter URLs.
- Make email optional on lead creation across schemas and modal forms.
- Add WhatsApp Web & WhatsApp Business quick-action buttons with dynamic stage-based pre-filled messages on the lead detail view.

### Phase 2: CRM Stages, Kanban & Meetings Workflow (Tasks 4, 5, 6)
- Update `AdmissionStage` and `LeadStatus` pipeline mapping:
  - Stages: `PROSPECT` ➔ `ADMISSION` ➔ `VERIFICATION` ➔ `ENROLLED` (`CANCELLED`, `DROPPED`).
  - Allow skipping from verification directly to enrolled.
- Update `lead-pipeline` Kanban board columns:
  - `New` | `Interested` | `Prospect` | `Admission` | `Lost Leads` | `Not Connected`.
- Add guard: Moving to `Prospect` requires meeting data (Online or Campus Visit). If missing, open meeting dialogue.

### Phase 3: Lead Editing & Student Conversion Workflow (Tasks 3, 7, 8, 9)
- Enable Admin / Super Admin edit mode on Lead Details (Name, Phone, Course, etc.) with automated audit logging.
- Add "Convert Lead to Student" button in Student Management that marks lead `WON` and opens their dossier.
- Ensure imported leads support full dossier generation and are aggregated into CRM analytics and performance reports.

### Phase 4: Finance, Payments & Collections Module (Tasks 10, 11, 12, 13)
- Fix Pending Payments display logic.
- Create `/finance/collections` page with "Fees Due This Month" and "Overdue Fees".
- Continue unified timeline across Lead ➔ Student profile.
- Send automated payment receipt and enrollment letter emails using the configured SMTP service.

### Phase 5: GCR Preview Build & Production Cutover (Task 15)
- Local testing and Playwright E2E verification.
- Build container and deploy preview service on Google Cloud Run.
- Route production traffic upon final verification.
