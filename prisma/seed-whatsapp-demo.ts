import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Seeds demo WhatsApp conversations so the admin UI (inbox, contacts,
// analytics) has realistic data immediately after setup.
//
// Idempotent: conversations upsert on (orgId, phone); message threads are only
// created when the conversation has none yet. Safe to run repeatedly.

const DAY = 86_400_000;
const HOUR = 3_600_000;

interface DemoThread {
  phone: string;
  optedOut?: boolean;
  unreadCount?: number;
  messages: { direction: "IN" | "OUT"; body: string; hoursAgo: number }[];
}

const THREADS: DemoThread[] = [
  {
    phone: "+919812345001",
    unreadCount: 1,
    messages: [
      { direction: "OUT", body: "Hi Ananya, welcome to Airborne Aviation! You asked about Commercial Pilot License — your journey starts here. A counsellor will call you shortly.", hoursAgo: 144 },
      { direction: "IN", body: "Hi, what are the fee details for CPL?", hoursAgo: 120 },
      { direction: "OUT", body: "Great question! CPL total program fee is structured in phases with EMI options available. Want me to send the full breakdown?", hoursAgo: 118 },
      { direction: "IN", body: "Yes please share", hoursAgo: 96 },
    ],
  },
  {
    phone: "+919823456002",
    unreadCount: 0,
    messages: [
      { direction: "OUT", body: "Hi Rohan, quick hello from Airborne Aviation. DGCA-aligned ground school, real hangar exposure and small batches — reply here with any question.", hoursAgo: 72 },
      { direction: "IN", body: "Can I visit the campus this Saturday?", hoursAgo: 48 },
      { direction: "OUT", body: "Absolutely — Saturday 11 AM works. I have noted your visit, our counsellor will meet you at reception.", hoursAgo: 47 },
    ],
  },
  {
    phone: "+919834567003",
    unreadCount: 2,
    messages: [
      { direction: "OUT", body: "Hi Priya, did you know our graduates fly with leading airlines across India and abroad? Come see a live class this week — reply VISIT.", hoursAgo: 192 },
      { direction: "IN", body: "How long is the training?", hoursAgo: 168 },
      { direction: "OUT", body: "The CPL program takes about 18 months including ground school and flying hours, weather permitting.", hoursAgo: 165 },
      { direction: "IN", body: "Ok good to know. Also is hostel available?", hoursAgo: 30 },
      { direction: "IN", body: "And what about the medical requirements?", hoursAgo: 29 },
    ],
  },
  {
    phone: "+919845678004",
    optedOut: true,
    unreadCount: 0,
    messages: [
      { direction: "OUT", body: "Hi Vikram, seats for the upcoming batch are filling fast. Lock your seat before the batch closes — reply SEAT.", hoursAgo: 240 },
      { direction: "IN", body: "STOP", hoursAgo: 216 },
    ],
  },
];

async function main() {
  console.log("🌱 Seeding WhatsApp demo data...\n");

  const org = await prisma.organization.findUnique({ where: { slug: "airborne-aviation" } });
  if (!org) throw new Error("Organization 'airborne-aviation' not found — run `npm run db:seed` first.");

  for (const thread of THREADS) {
    const lead = await prisma.lead.findFirst({
      where: { orgId: org.id, phone: { endsWith: thread.phone.slice(-10) } },
      select: { id: true, name: true },
    });

    const last = thread.messages.at(-1);
    if (!last) continue;
    const lastAt = new Date(Date.now() - last.hoursAgo * HOUR);

    const conversation = await prisma.whatsAppConversation.upsert({
      where: { orgId_phone: { orgId: org.id, phone: thread.phone } },
      update: {},
      create: {
        orgId: org.id,
        phone: thread.phone,
        ...(lead && { leadId: lead.id }),
        lastMessageAt: lastAt,
        lastMessagePreview: last.body.slice(0, 255),
        unreadCount: thread.unreadCount ?? 0,
        optedOut: thread.optedOut ?? false,
      },
      select: { id: true },
    });

    const existing = await prisma.whatsAppMessage.count({ where: { conversationId: conversation.id } });
    if (existing === 0) {
      await prisma.whatsAppMessage.createMany({
        data: thread.messages.map((m) => ({
          orgId: org.id,
          conversationId: conversation.id,
          direction: m.direction,
          body: m.body,
          status: m.direction === "IN" ? "RECEIVED" : "SENT",
          createdAt: new Date(Date.now() - m.hoursAgo * HOUR),
        })),
      });
    }

    if (thread.optedOut && lead) {
      await prisma.lead.update({ where: { id: lead.id }, data: { whatsappOptOut: true } });
    }

    console.log(`✅ ${thread.phone}${lead ? ` (${lead.name})` : ""} — ${thread.messages.length} messages`);
  }

  console.log("\n🌱 WhatsApp demo seed complete.");
}

main()
  .catch((err) => {
    console.error("❌ WhatsApp demo seed failed", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
