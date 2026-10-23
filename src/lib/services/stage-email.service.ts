import { prisma } from "@/lib/db/client";
import { getProvider } from "@/lib/messaging";

export interface StageEmailParams {
  orgId: string;
  stage: string;
  leadId: string;
  admissionId?: string | null;
  courseName?: string | null;
  performedBy?: string | null;
}

export class StageEmailService {
  static async triggerStageEmail({
    orgId,
    stage,
    leadId,
    admissionId,
    courseName,
    performedBy,
  }: StageEmailParams): Promise<boolean> {
    try {
      const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { id: true, name: true, email: true, phone: true, courseInterest: true },
      });

      if (!lead?.email) return false;

      const program = courseName || lead.courseInterest || "DGCA CPL Ground School";
      const name = lead.name || "Aviation Aspirant";
      const email = lead.email.trim();

      const provider = getProvider("EMAIL");
      if (!provider.isConfigured()) {
        console.warn("[StageEmailService] Email provider not configured, skipping stage email.");
        return false;
      }

      let subject = "";
      let title = "";
      let bodyText = "";
      let detailsHtml = "";

      switch (stage) {
        case "NEW":
        case "ENQUIRY":
          subject = `Welcome to Airborne Aviation Academy — ${program} Brochure`;
          title = "Program Brochure & Course Overview";
          bodyText = `Thank you for your interest in Airborne Aviation Academy. We have received your enquiry for ${program}.`;
          detailsHtml = `
            <p>Our founder-led ground school has been mentoring pilots since 2009 with DGCA-compliant curriculum.</p>
            <div style="background-color: #f1f5f9; padding: 14px; border-radius: 6px; margin: 16px 0;">
              <strong>Course:</strong> ${program}<br/>
              <strong>Campus:</strong> Ramphal Chowk, Dwarka, New Delhi<br/>
              <strong>Highlights:</strong> 100% DGCA-compliant syllabus, conceptual theory &amp; RTR preparation.
            </div>
          `;
          break;

        case "INTERESTED":
        case "CONNECTED":
          subject = `Course Syllabus & Upcoming Batches: ${program} — Airborne Aviation`;
          title = "Syllabus Details & Upcoming Batch Schedule";
          bodyText = `Following up on our conversation regarding ${program}. Here is your detailed curriculum roadmap.`;
          detailsHtml = `
            <div style="background-color: #f1f5f9; padding: 14px; border-radius: 6px; margin: 16px 0;">
              <strong>Program:</strong> ${program}<br/>
              <strong>Batch Schedule:</strong> Weekday &amp; Weekend batches starting 1st and 15th of every month.<br/>
              <strong>Seats:</strong> Strictly capped at 25 cadets per batch for personalized mentoring.
            </div>
          `;
          break;

        case "OFFER_LETTER":
        case "PROSPECT":
          subject = `Provisional Admission Offer Letter — Airborne Aviation Academy`;
          title = "Provisional Admission Offer";
          bodyText = `We are pleased to extend a provisional admission offer for enrollment in ${program}.`;
          detailsHtml = `
            <div style="background-color: #f8fafc; padding: 14px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #d97706;">
              <strong>Candidate:</strong> ${name}<br/>
              <strong>Program:</strong> ${program}<br/>
              <strong>Status:</strong> PROVISIONAL ADMISSION OFFER ISSUED<br/>
              <strong>Next Step:</strong> Complete document verification and fee payment to secure your batch seat.
            </div>
          `;
          break;

        case "FEE_PAYMENT":
        case "PAYMENT_RECEIVED":
          subject = `Payment Confirmation & Official Tax Receipt — Airborne Aviation`;
          title = "Fee Payment Confirmation";
          bodyText = `Your payment for ${program} has been recorded in the academy ledger.`;
          detailsHtml = `
            <div style="background-color: #f0fdf4; padding: 14px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #16a34a;">
              <strong>Candidate:</strong> ${name}<br/>
              <strong>Program:</strong> ${program}<br/>
              <strong>Status:</strong> FEE PAYMENT RECORDED<br/>
              <strong>Receipt:</strong> Verified and archived on your student ledger.
            </div>
          `;
          break;

        case "ENROLLED":
        case "WON":
          subject = `Cadet Welcome Kit & Official Enrollment Confirmation — Airborne Aviation`;
          title = "Official Enrollment Confirmation & Welcome Kit";
          bodyText = `Congratulations ${name}! Your admission into ${program} is officially confirmed.`;
          detailsHtml = `
            <div style="background-color: #f0fdfa; padding: 14px; border-radius: 6px; margin: 16px 0; border-left: 4px solid #0d9488;">
              <strong>Cadet Name:</strong> ${name}<br/>
              <strong>Program:</strong> ${program}<br/>
              <strong>Status:</strong> OFFICIALLY ENROLLED<br/>
              <strong>Welcome Kit:</strong> Study materials, navigation equipment, flight logs, and uniform sizing will be issued at orientation.
            </div>
          `;
          break;

        default:
          return false;
      }

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h2 style="color: #0f172a; margin: 0; letter-spacing: 0.05em;">AIRBORNE AVIATION ACADEMY</h2>
            <p style="color: #0d9488; margin: 4px 0 0 0; font-size: 13px; font-weight: bold; text-transform: uppercase;">${title}</p>
          </div>
          <p style="color: #334155; font-size: 15px;">Dear <strong>${name}</strong>,</p>
          <p style="color: #334155; font-size: 14px; line-height: 1.5;">${bodyText}</p>
          ${detailsHtml}
          <p style="color: #334155; font-size: 14px; line-height: 1.5;">
            If you have any questions or require assistance, please call our admissions desk at <strong>+91 9953 777 320</strong> or reply directly to this email.
          </p>
          <p style="font-size: 13px; color: #64748b; margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
            Warm regards,<br />
            <strong>Admissions &amp; Flight Operations</strong><br />
            Airborne Aviation Academy, Dwarka, New Delhi
          </p>
        </div>
      `;

      await provider.send({
        to: email,
        subject,
        body: `${bodyText}\n\nCourse: ${program}\nAirborne Aviation Academy`,
        html,
      });

      // Persistent Timeline Invariant: Log activity on the lead record
      await prisma.leadActivity.create({
        data: {
          orgId,
          leadId,
          activityType: "EMAIL",
          title: `Transactional Email Sent: ${title}`,
          notes: `Sent "${subject}" to ${email} on stage update (${stage}).`,
          performedBy: performedBy ?? undefined,
          metadata: {
            stage,
            recipient: email,
            subject,
            courseName: program,
          },
        },
      });

      return true;
    } catch (err) {
      console.error("[StageEmailService] Error sending stage email:", err);
      return false;
    }
  }
}
