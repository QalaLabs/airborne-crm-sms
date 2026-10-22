import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const BLOG_POSTS = [
  {
    slug: "how-to-become-pilot-india",
    title: "How to Become a Pilot in India After 12th - Step-by-Step 2026",
    seoTitle: "How to Become a Pilot in India After 12th - Step-by-Step 2026",
    seoDesc: "Complete guide to becoming a commercial pilot in India after 12th. CPL eligibility, DGCA exams, flying hours, costs, and airline placement tips from Airborne Aviation Academy, Dwarka.",
    description: `Complete step-by-step roadmap to becoming a commercial pilot in India after Class 12, written by Capt. Navrang Singh.

Step 1: Confirm Class 12 Eligibility
The DGCA requires Physics and Mathematics in your 10+2 with a minimum 50% aggregate. If you passed without these, NIOS exam is a valid path to meet the requirement before applying. DGCA Class 1 Medical check is recommended before you invest in training.

Step 2: Clear Your DGCA Class 1 Medical
A DGCA Class 1 Medical examination at an authorised AME checks vision, cardiovascular health, hearing, and general fitness. This clearance is required before your first solo flight.

Step 3: Enrol in DGCA Ground School
Ground school covers Air Navigation, Aviation Meteorology, Air Regulations, Technical General, Technical Specific, and RTR (Aero). Clearing all 6 written papers is required for CPL issuance.

Step 4: Choose a Flight School (India or Abroad)
Complete 200 hours of flight training, including 100 hours solo, 50 hours cross-country, and 10 hours instrument flight.

Step 5: Airline Preparation - GD/PI & Type Rating
Prepare for airline screening with technical ground refreshers, Airbus A320 / Boeing 737 simulator sessions, group discussions, and personal interviews.`,
    type: "DOCUMENT" as const,
    category: "blog",
    status: "PUBLISHED" as const,
    publishedAt: new Date("2026-01-15T00:00:00.000Z"),
    metadata: {
      author: "Capt. Navrang Singh",
      readTime: "8 min read",
    },
  },
  {
    slug: "pilot-training-cost-india",
    title: "Pilot Training Cost in India 2026 - Complete CPL Fee Breakdown",
    seoTitle: "Pilot Training Cost in India 2026 - Complete CPL Fee Breakdown",
    seoDesc: "Complete breakdown of pilot training cost in India for 2026 - CPL ground school, flying hours, DGCA exam fees, medical, and total investment compared to training abroad.",
    description: `Transparent cost breakdown for commercial pilot training in India and abroad for 2026.

1. DGCA Ground School: ₹1.5L - ₹2.7L covering all 6 DGCA theory subjects, study materials, mock tests, and question bank.
2. DGCA Class 1 & 2 Medicals: ₹15,000 - ₹30,000 for initial Class 2 with approved doctor and Class 1 at Air Force Medical Examination Centre.
3. Flight Training (200 Hours): ₹35L - ₹50L depending on flying club (single-engine vs multi-engine hours).
4. DGCA Examination & License Fees: ₹15,000 - ₹25,000.
5. Airline Preparation & Type Rating: ₹15L - ₹25L for A320/B737 type rating after securing CPL.

Total Estimated Investment: ₹45 Lakhs to ₹75 Lakhs from Class 12 to Airline First Officer cockpit entry.`,
    type: "DOCUMENT" as const,
    category: "blog",
    status: "PUBLISHED" as const,
    publishedAt: new Date("2026-02-01T00:00:00.000Z"),
    metadata: {
      author: "Capt. Navrang Singh",
      readTime: "6 min read",
    },
  },
  {
    slug: "dgca-ground-school-guide",
    title: "DGCA Ground School Guide - All Subjects, Exams & Prep Strategy 2026",
    seoTitle: "DGCA Ground School Guide - All Subjects, Exams & Prep Strategy 2026",
    seoDesc: "Complete DGCA ground school guide for CPL and ATPL aspirants. Covers all 6 exam subjects, exam schedule, pass criteria, preparation strategies, and common mistakes. By Airborne Aviation Academy.",
    description: `Everything you need to know about preparing for and clearing all DGCA pilot examinations on your first attempt.

The 6 DGCA CPL Theory Papers:
1. Air Navigation: General Navigation, In-flight Calculations, Magnetism, Flight Planning.
2. Aviation Meteorology: Atmospheric pressure, wind patterns, monsoon weather, cloud formations, thunderstorms, and METAR/TAF decoding.
3. Air Regulations: ICAO Annexes, Aircraft Rules 1937, Air Traffic Control procedures, airspace classifications.
4. Technical General: Aircraft systems, aerodynamics, engines (piston and turbine), airframe structures, electrical & hydraulic systems.
5. Technical Specific: Aircraft type examination for the specific trainer aircraft (e.g. Cessna 172, Piper Seneca).
6. Radio Telephony Restricted (RTR Aero): Conducted by WPC (Ministry of Communications) for cockpit communication protocols.

Preparation Strategy:
- Focus on concepts first rather than rote memorization.
- Solve past 10 years DGCA question papers.
- Take weekly timed mock tests under actual DGCA computer exam conditions (Pariksha portal format).`,
    type: "DOCUMENT" as const,
    category: "blog",
    status: "PUBLISHED" as const,
    publishedAt: new Date("2026-02-15T00:00:00.000Z"),
    metadata: {
      author: "Capt. Navrang Singh",
      readTime: "10 min read",
    },
  },
  {
    slug: "pilot-salary-india",
    title: "Pilot Salary in India 2026 - CPL vs ATPL Income Guide | Airborne",
    seoTitle: "Pilot Salary in India 2026 - CPL vs ATPL Income Guide | Airborne",
    seoDesc: "Complete pilot salary guide for India in 2026. First Officer vs Captain pay at IndiGo, Air India, Akasa, Vistara. CPL salary expectations, growth timeline, and perks explained.",
    description: `In-depth analysis of airline pilot salaries in India across carriers, seniority levels, and career milestones.

Salary Hierarchy in Indian Aviation:
1. Junior First Officer (Trainee): ₹1.2L - ₹1.8L per month during line training.
2. First Officer (Line Flying): ₹2.5L - ₹3.5L per month based on 70-80 flying hours.
3. Senior First Officer: ₹3.8L - ₹5.0L per month with 1,500+ flying hours and ATPL.
4. Captain (Line Commander): ₹6.5L - ₹9.0L per month upon command upgrade (approx 2,500-3,000 total hours).
5. Senior Captain / Examiner / TRI / TRE: ₹9.0L - ₹14.0L+ per month with management and training allowances.

Additional Allowances:
- Flying hour allowances beyond 70 hours.
- Layover / per diem allowances for domestic and international layovers.
- Comprehensive family health insurance, loss-of-license insurance, and free staff travel tickets.`,
    type: "DOCUMENT" as const,
    category: "blog",
    status: "PUBLISHED" as const,
    publishedAt: new Date("2026-03-01T00:00:00.000Z"),
    metadata: {
      author: "Capt. Navrang Singh",
      readTime: "7 min read",
    },
  },
];

async function main() {
  const org = await prisma.organization.findFirst({
    where: { slug: "airborne-aviation" },
    select: { id: true },
  });

  if (!org) {
    console.error("Default org 'airborne-aviation' not found");
    return;
  }

  for (const post of BLOG_POSTS) {
    const existing = await prisma.resource.findFirst({
      where: { orgId: org.id, slug: post.slug },
    });

    if (existing) {
      await prisma.resource.update({
        where: { id: existing.id },
        data: {
          title: post.title,
          seoTitle: post.seoTitle,
          seoDesc: post.seoDesc,
          description: post.description,
          type: post.type,
          category: post.category,
          status: post.status,
          publishedAt: post.publishedAt,
          metadata: post.metadata,
        },
      });
      console.log(`Updated blog post: ${post.slug}`);
    } else {
      await prisma.resource.create({
        data: {
          orgId: org.id,
          ...post,
        },
      });
      console.log(`Created blog post: ${post.slug}`);
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
