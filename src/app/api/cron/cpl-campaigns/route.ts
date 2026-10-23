import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { cronAuthHttpStatus, verifyCronSecret } from "@/lib/automation/cron-auth";
import { getProvider } from "@/lib/messaging";

export async function GET(req: NextRequest) {
  return handleCron(req);
}

export async function POST(req: NextRequest) {
  return handleCron(req);
}

async function handleCron(req: NextRequest) {
  const auth = verifyCronSecret(req);
  if (!auth.ok) {
    return NextResponse.json(
      { error: "unauthorized", reason: auth.failure },
      { status: cronAuthHttpStatus(auth.failure) },
    );
  }

  const now = new Date();
  const ms48h = 48 * 60 * 60 * 1000;
  const ms7d = 7 * 24 * 60 * 60 * 1000;
  const ms14d = 14 * 24 * 60 * 60 * 1000;

  const cutoff48h = new Date(now.getTime() - ms48h);
  const cutoff7d = new Date(now.getTime() - ms7d);
  const cutoff14d = new Date(now.getTime() - ms14d);

  const orgs = await prisma.organization.findMany({
    select: { id: true, slug: true },
  });

  let totalProcessed = 0;
  const dispatched = {
    tier48h: 0,
    tier7d: 0,
    tier14d: 0,
  };

  const emailProvider = getProvider("EMAIL");
  const waProvider = getProvider("WHATSAPP");

  for (const org of orgs) {
    const leads = await prisma.lead.findMany({
      where: {
        orgId: org.id,
        deletedAt: null,
        status: { in: ["NEW", "INTERESTED", "NOT_CONNECTED", "FOLLOW_UP", "PROSPECT"] },
        OR: [
          { courseInterest: { contains: "cpl", mode: "insensitive" } },
          { courseInterest: { contains: "ground", mode: "insensitive" } },
          { courseInterest: { contains: "pilot", mode: "insensitive" } },
          { courseInterest: null },
        ],
      },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        courseInterest: true,
        tags: true,
        createdAt: true,
        lastActivityAt: true,
      },
    });

    totalProcessed += leads.length;

    for (const lead of leads) {
      const lastAction = lead.lastActivityAt || lead.createdAt;
      const tags = new Set(lead.tags || []);

      let tier: "14d" | "7d" | "48h" | null = null;
      let newTag = "";
      let campaignTitle = "";
      let messageBody = "";

      if (lastAction <= cutoff14d && !tags.has("cpl-drip-14d")) {
        tier = "14d";
        newTag = "cpl-drip-14d";
        campaignTitle = "DGCA Upcoming Batch Deadline Reminder";
        messageBody = `Hi ${lead.name || "Aviation Aspirant"}, DGCA CPL batch admissions are closing for the upcoming month at Airborne Aviation. Only limited seats remain in Capt. Navrang Singh's mentor-led cohort.`;
      } else if (lastAction <= cutoff7d && !tags.has("cpl-drip-7d")) {
        tier = "7d";
        newTag = "cpl-drip-7d";
        campaignTitle = "CPL Ground Training Fee & Scholarship Overview";
        messageBody = `Hi ${lead.name || "there"}, explore our transparent CPL ground training fees and education loan assistance via SBI/BoB. Clear your DGCA papers on the first attempt with Airborne Aviation.`;
      } else if (lastAction <= cutoff48h && !tags.has("cpl-drip-48h")) {
        tier = "48h";
        newTag = "cpl-drip-48h";
        campaignTitle = "CPL Training Roadmap & Founder Video";
        messageBody = `Hi ${lead.name || "there"}, have you reviewed our DGCA CPL Ground School curriculum? Watch Capt. Navrang Singh explain how to clear all 5 DGCA papers in 3 months.`;
      }

      if (!tier || !newTag) continue;

      // 1. Dispatch via WhatsApp if phone exists & provider configured
      if (lead.phone && waProvider.isConfigured()) {
        try {
          await waProvider.send({
            to: lead.phone,
            body: messageBody,
            templateName: `cpl_nurture_${tier}`,
            bodyValues: [lead.name || "Student"],
            providerCampaignId: `cpl-drip-${tier}`,
          });
        } catch (e) {
          console.warn(`[CPL Cron] WhatsApp send failed for ${lead.id}:`, e);
        }
      }

      // 2. Dispatch via Email if email exists & provider configured
      if (lead.email && emailProvider.isConfigured()) {
        try {
          await emailProvider.send({
            to: lead.email,
            subject: `${campaignTitle} — Airborne Aviation Academy`,
            body: messageBody,
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                <h3 style="color: #0f172a; margin-top: 0;">AIRBORNE AVIATION ACADEMY</h3>
                <p style="color: #0d9488; font-weight: bold; font-size: 13px; text-transform: uppercase;">${campaignTitle}</p>
                <p style="color: #334155; font-size: 14px; line-height: 1.5;">${messageBody}</p>
                <div style="margin: 20px 0;">
                  <a href="https://www.airborneaviation.in/courses/commercial-pilot-license-cpl" style="background-color: #db241e; color: #ffffff; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
                    View Batch Schedule &amp; Syllabus →
                  </a>
                </div>
                <p style="font-size: 12px; color: #64748b;">Dwarka, New Delhi · Call: +91 9953 777 320</p>
              </div>
            `,
          });
        } catch (e) {
          console.warn(`[CPL Cron] Email send failed for ${lead.id}:`, e);
        }
      }

      // 3. Update lead with idempotency tag & create timeline activity
      tags.add(newTag);
      await prisma.$transaction([
        prisma.lead.update({
          where: { id: lead.id },
          data: {
            tags: Array.from(tags),
            lastActivityAt: now,
          },
        }),
        prisma.leadActivity.create({
          data: {
            orgId: org.id,
            leadId: lead.id,
            activityType: "TASK",
            title: `CPL Inactivity Drip (${tier}): ${campaignTitle}`,
            notes: messageBody,
            metadata: {
              cron: "cpl-campaigns",
              tier,
              tag: newTag,
              dispatchedAt: now.toISOString(),
            },
          },
        }),
      ]);

      if (tier === "48h") dispatched.tier48h++;
      if (tier === "7d") dispatched.tier7d++;
      if (tier === "14d") dispatched.tier14d++;
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: now.toISOString(),
    processedLeads: totalProcessed,
    dispatched,
  });
}
