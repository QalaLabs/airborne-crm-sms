/**
 * CRM-09: Legacy Course Interest Normalization Script
 * Maps varied / legacy courseInterest values on Lead records to canonical slugs.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CANONICAL_MAP: Record<string, string> = {
  // CPL
  "cpl": "commercial-pilot-license-cpl",
  "cpl ground classes": "commercial-pilot-license-cpl",
  "cpl-ground-classes": "commercial-pilot-license-cpl",
  "commercial pilot license": "commercial-pilot-license-cpl",
  "commercial pilot license (cpl)": "commercial-pilot-license-cpl",
  "dgca cpl ground school": "commercial-pilot-license-cpl",
  "dgca-compliant cpl ground school": "commercial-pilot-license-cpl",
  "commercial-pilot-license-cpl": "commercial-pilot-license-cpl",

  // Cabin Crew
  "cabin crew": "cabin-crew-training",
  "cabin-crew": "cabin-crew-training",
  "cabin crew training": "cabin-crew-training",
  "cabin-crew-training": "cabin-crew-training",
  "air hostess": "cabin-crew-training",

  // ATPL
  "atpl": "atpl",
  "atpl ground classes": "atpl",
  "atpl-ground-classes": "atpl",
  "airline transport pilot license": "atpl",

  // Ground School
  "ground school": "ground-school",
  "ground-school": "ground-school",
  "dgca ground school": "ground-school",
  "dgca ground classes": "ground-school",

  // Cadet Preparation
  "cadet pilot": "cadet-preparation",
  "cadet pilot preparation": "cadet-preparation",
  "cadet-preparation": "cadet-preparation",
  "cadet pilot program": "cadet-preparation",
  "cadet-pilot-program": "cadet-preparation",

  // Simulator
  "simulator": "a320-simulator",
  "a320": "a320-simulator",
  "a320 simulator": "a320-simulator",
  "a320-simulator": "a320-simulator",
  "a320 pre type rating": "a320-simulator",
  "a320-pre-type-rating": "a320-simulator",

  // Flying Training
  "flying training": "flying-training-india-abroad",
  "flying training india abroad": "flying-training-india-abroad",
  "flying-training": "flying-training-india-abroad",
  "flying-training-india-abroad": "flying-training-india-abroad",

  // Airline Preparation
  "airline prep": "airline-preparation",
  "airline preparation": "airline-preparation",
  "airline-prep": "airline-preparation",
  "airline-preparation": "airline-preparation",

  // PPL
  "ppl": "private-pilot-license",
  "private pilot license": "private-pilot-license",
  "private-pilot-license": "private-pilot-license",

  // GD-PI
  "gd pi": "gd-pi",
  "gd-pi": "gd-pi",
  "interview preparation": "gd-pi",

  // CAS / Compass
  "cas compass adapt": "cas-compass-adapt",
  "cas-compass-adapt": "cas-compass-adapt",
  "compass test": "cas-compass-adapt",

  // Child Aviation
  "securing your childs future in aviation": "securing-your-childs-future-in-aviation",
  "securing-your-childs-future-in-aviation": "securing-your-childs-future-in-aviation",
  "parent counseling": "securing-your-childs-future-in-aviation",
};

async function main() {
  console.log("[CRM-09] Starting courseInterest normalization migration...");

  const leads = await prisma.lead.findMany({
    where: {
      courseInterest: { not: null },
    },
    select: {
      id: true,
      name: true,
      courseInterest: true,
    },
  });

  console.log(`[CRM-09] Found ${leads.length} leads with courseInterest populated.`);

  let updatedCount = 0;
  let alreadyCanonicalCount = 0;
  let unmatchedCount = 0;

  for (const lead of leads) {
    const raw = lead.courseInterest?.trim() ?? "";
    const lower = raw.toLowerCase();

    const canonical = CANONICAL_MAP[lower] ?? null;

    if (!canonical) {
      console.log(`[UNMATCHED] Lead ${lead.id} (${lead.name}): "${raw}"`);
      unmatchedCount++;
      continue;
    }

    if (raw === canonical) {
      alreadyCanonicalCount++;
      continue;
    }

    await prisma.lead.update({
      where: { id: lead.id },
      data: {
        courseInterest: canonical,
        customFields: {
          path: ["legacyCourseInterest"],
          set: raw,
        },
      },
    });

    console.log(`[MIGRATED] Lead ${lead.id}: "${raw}" -> "${canonical}"`);
    updatedCount++;
  }

  console.log("\n--- Migration Summary ---");
  console.log(`Total Leads Checked: ${leads.length}`);
  console.log(`Already Canonical:   ${alreadyCanonicalCount}`);
  console.log(`Migrated:            ${updatedCount}`);
  console.log(`Unmatched (Kept):    ${unmatchedCount}`);
}

main()
  .catch((e) => {
    console.error("[CRM-09] Migration failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
