import { PrismaClient, ContentStatus } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding courses into PostgreSQL database...\n");

  const org = await prisma.organization.findFirst({
    where: { slug: "airborne-aviation" },
  });

  if (!org) {
    console.error("❌ Organization 'airborne-aviation' not found! Run the main seed script first.");
    return;
  }

  console.log(`Found organization: ${org.name} (${org.id})`);

  const coursesData = [
    {
      orgId: org.id,
      slug: "cpl-ground-classes",
      title: "CPL Ground School",
      subtitle: "India's most disciplined DGCA CPL Ground School in Dwarka, New Delhi",
      description: "Our Commercial Pilot License (CPL) ground school program provides structured, mentor-led training under Capt. Navrang Singh. We focus on building deep conceptual clarity rather than rote learning, preparing you for all 5 DGCA exams and your future cockpit career.",
      status: ContentStatus.PUBLISHED,
      category: "Ground School",
      duration: "3–4 Months",
      eligibility: "12th Pass with Physics and Mathematics (minimum 50% marks)",
      fee: 270000.00,
      seoTitle: "CPL Ground Classes Delhi - DGCA CPL Prep | Airborne",
      seoDesc: "DGCA CPL ground classes in Dwarka, Delhi. Led by Capt. Navrang Singh. Complete preparation for Air Navigation, Meteorology, Regulations, Technical, and RTR exams.",
      seoKeywords: ["CPL ground classes", "DGCA CPL training", "pilot ground school delhi", "RTR exam prep"],
      order: 1,
      isFeatured: true,
      publishedAt: new Date(),
      curriculum: [
        { module: "Air Navigation" },
        { module: "Aviation Meteorology" },
        { module: "Air Regulations" },
        { module: "Technical General & Specific" },
        { module: "RTR (Radio Telephony Restricted)" }
      ],
      metadata: {
        image: "/footage/classroom.jpg",
        batch: "Next batch - July 2026",
        highlights: [
          "Founder-led classes under active Airline Captain Navrang Singh",
          "In-house simulated RTR lab for mock wireless communication training",
          "Library access for study hours after lectures",
          "Personalized pacing & weekly doubt-solving sessions",
          "In-house Class 2 medical pre-screening and advisory at the centre",
          "Attendance notifications & weekly performance reports delivered to parents",
          "Exclusive Airborne Goodies (Bag, T-Shirt, Keychain, Notebook, Pen)"
        ]
      }
    },
    {
      orgId: org.id,
      slug: "atpl",
      title: "ATPL Ground School",
      subtitle: "Airline Transport Pilot License Ground School Exam Preparation",
      description: "Airborne Aviation Academy offers ATPL ground school classes in Dwarka, Delhi. Our program prepares commercial pilots for the DGCA ATPL written examinations - the final certification step before command eligibility on scheduled airline operations.",
      status: ContentStatus.PUBLISHED,
      category: "Ground School",
      duration: "4–6 Months",
      eligibility: "CPL holders targeting airline command (PIC) positions",
      fee: 150000.00,
      seoTitle: "ATPL Ground School India - All Subjects | Airborne Aviation",
      seoDesc: "ATPL ground school in Delhi by Airborne Aviation Academy. Complete airline transport pilot license exam preparation - all subjects, DGCA-approved. Enrol now.",
      seoKeywords: ["ATPL ground school", "airline transport pilot license", "ATPL course india", "DGCA ATPL"],
      order: 7,
      isFeatured: false,
      publishedAt: new Date(),
      curriculum: [
        { module: "Air Navigation (Advanced)" },
        { module: "Air Regulation (ATPL-level DGCA rules & ICAO annexures)" },
        { module: "Aviation Meteorology (Advanced synoptic & en-route wx)" },
        { module: "Technical General - Airframe, Engines, Systems" },
        { module: "Technical Specific - Type-specific systems (A320/B737 focus)" },
        { module: "RTR (Radio Telephony Restricted) - if not held" }
      ],
      metadata: {
        image: "/footage/cockpit_pilot_silhouette.jpg",
        batch: "Next batch - July 2026",
        highlights: [
          "Taught by active/retired airline commanders with type ratings on A320 & B737 fleets",
          "DGCA mock test series and past paper analysis",
          "Theory connected directly to real-world commercial operations",
          "Flexible schedules with weekday and weekend batches"
        ]
      }
    },
    {
      orgId: org.id,
      slug: "cadet-preparation",
      title: "Cadet Pilot Program Prep",
      subtitle: "IndiGo, Air India, and Akasa Air Cadet Selection Preparation",
      description: "Airborne Aviation Academy prepares aspiring pilots for the cadet pilot programs of India's leading airlines - IndiGo, Air India, and Akasa Air. Our program covers aptitude testing, psychometric evaluation, group discussions, personal interviews, and the selection pathway.",
      status: ContentStatus.PUBLISHED,
      category: "Cadet Prep",
      duration: "3 Months",
      eligibility: "17–26 years, 10+2 with Physics and Mathematics (min 50%)",
      fee: 50000.00,
      seoTitle: "Cadet Pilot Program Prep - IndiGo, Air India, Akasa | Airborne",
      seoDesc: "Prepare for IndiGo, Air India & Akasa cadet pilot programs at Airborne Aviation Academy, Dwarka. Aptitude tests, GD-PI, type rating pathway - join now.",
      seoKeywords: ["cadet pilot program", "indigo cadet program", "airline cadet program india", "cadet pilot preparation"],
      order: 3,
      isFeatured: false,
      publishedAt: new Date(),
      curriculum: [
        { module: "Aptitude Test Prep (ADAPT, Compass, numerical/verbal/spatial)" },
        { module: "Aviation Knowledge (Aerodynamics, systems, regulations)" },
        { module: "GD & Interview Prep (Airline GDs, panel and HR interview)" },
        { module: "Personality Development (Grooming, communication, confidence)" },
        { module: "Mock Selection Rounds (Full airline selection simulation)" }
      ],
      metadata: {
        image: "/footage/student_overhead_panel.jpg",
        batch: "Next intake starting soon",
        highlights: [
          "Compass and ADAPT aptitude test simulated practice sessions",
          "Interview coaching with ex-airline HR insights",
          "Group Discussion practice using real airline prompts",
          "Class 1 medical fitness guidance & support"
        ]
      }
    },
    {
      orgId: org.id,
      slug: "a320-simulator",
      title: "A320 Simulator Training",
      subtitle: "Airbus A320 Simulator Familiarization and Type Rating Preparation",
      description: "Airborne Aviation Academy offers Airbus A320 simulator sessions at our Dwarka, Delhi facility. Designed for CPL holders and type rating aspirants to practice Standard Operating Procedures (SOPs), FMGS programming, ECAM abnormal drills, and instrument approaches in a high-fidelity cockpit environment.",
      status: ContentStatus.PUBLISHED,
      category: "Simulator",
      duration: "Per hour (in-house FTD)",
      eligibility: "CPL holders or cadet candidates preparing for type rating",
      fee: 10000.00,
      seoTitle: "A320 Simulator Training Delhi - Type Rating Prep | Airborne",
      seoDesc: "A320 simulator sessions at Airborne Aviation Academy, Dwarka Delhi. Hands-on Airbus A320 procedure practice for CPL holders and type rating aspirants. Book now.",
      seoKeywords: ["A320 simulator training", "airbus A320 simulator india", "type rating preparation india"],
      order: 8,
      isFeatured: false,
      publishedAt: new Date(),
      curriculum: [
        { module: "Normal Procedures & Airbus SOP Flows" },
        { module: "FMGS programming (Flight Management and Guidance)" },
        { module: "Abnormal and Emergency Procedures & ECAM drills" },
        { module: "Instrument Approaches (ILS, VOR, RNAV & Raw Data)" },
        { module: "Single-Engine Operations & Engine Failures" }
      ],
      metadata: {
        image: "/footage/simulator-training.jpg",
        batch: "Daily slots available (Monday - Saturday)",
        highlights: [
          "Full procedures cockpit replicating Airbus A320 layout",
          "Interactive FMGS/MCDU trainer block",
          "Reduces cognitive load and improves check-ride success in actual type rating",
          "Flexible hourly booking structures"
        ]
      }
    },
    {
      orgId: org.id,
      slug: "cas-compass-adapt",
      title: "CASS Compass & ADAPT Prep",
      subtitle: "Pilot Aptitude and Psychometric Test Preparation",
      description: "Structured preparation for the ADAPT (Airline Pilot Aptitude Test) and CASS Compass pilot selection tests used by IndiGo, Air India, Akasa Air, and other carriers. We focus on enhancing spatial reasoning, hand-eye coordination, multi-tasking management, and stress profiles.",
      status: ContentStatus.PUBLISHED,
      category: "Cadet Prep",
      duration: "4 Weeks",
      eligibility: "Candidates appearing for airline pilot cadet examinations",
      fee: 30000.00,
      seoTitle: "ADAPT CASS Compass Test Prep - Pilot Aptitude | Airborne Aviation",
      seoDesc: "ADAPT and CASS Compass aptitude test preparation for airline pilot and cadet selection at Airborne Aviation Academy, Dwarka Delhi. Pass first attempt.",
      seoKeywords: ["ADAPT test pilot", "CASS compass test", "pilot aptitude test india"],
      order: 6,
      isFeatured: false,
      publishedAt: new Date(),
      curriculum: [
        { module: "Spatial Orientation & Rotational Visualisation" },
        { module: "Multi-Task Management (MTM) Drills" },
        { module: "Numerical & Arithmetic Reasoning under time pressure" },
        { module: "Verbal Reasoning & English Comprehension" },
        { module: "Psychometric profiling & Situational Judgment Tests" },
        { module: "Hand-Eye Coordination (Tracking simulations & joysticks)" }
      ],
      metadata: {
        image: "/footage/simulator_entry_dark.jpg",
        batch: "Weekly diagnostics starting",
        highlights: [
          "Purpose-built computer labs mimicking actual airline assessment portals",
          "Joystick coordination hardware setup",
          "Aviation-aligned personality mock evaluations",
          "Diagnostic baseline scores tracking with feedback from instructors"
        ]
      }
    },
    {
      orgId: org.id,
      slug: "airline-preparation",
      title: "Airline Interview Preparation",
      subtitle: "Group Discussion, Personal Interview, and Personality Development",
      description: "Our Airline Preparation program equips pilot and cabin crew candidates for the non-technical stages of airline recruitment: Group Discussions (GD), Personal Interviews (PI), and Personality Development (PD). Led by industry veterans with direct airline training and HR backgrounds.",
      status: ContentStatus.PUBLISHED,
      category: "Soft Skills",
      duration: "4 Weeks",
      eligibility: "CPL holders, cadet applicants, and cabin crew aspirants",
      fee: 125000.00,
      seoDesc: "Airline interview and selection preparation at Airborne Aviation Academy, Delhi. GD, personal interview, personality development for pilots & cabin crew. Join now.",
      seoKeywords: ["airline interview preparation", "pilot interview preparation india", "GD PI training aviation"],
      order: 4,
      isFeatured: false,
      publishedAt: new Date(),
      curriculum: [
        { module: "Group Discussion (GD) Strategy & Public Speaking" },
        { module: "Personal Interview (PI) Coaching & HR Question Bank" },
        { module: "Personality Development (PD) & Confidence Building" },
        { module: "Grooming Standards & Mock Selection Assessments" }
      ],
      metadata: {
        image: "/footage/pilot-portrait.jpg",
        batch: "Upcoming batch - July 2026",
        highlights: [
          "GD preparation covering 50+ aviation and current affairs topics",
          "HR mock interview rounds with detailed recorded feedback",
          "Airline grooming standards and professional presence audits",
          "Led by a retired AGM (Training) from Air India and senior crew"
        ]
      }
    },
    {
      orgId: org.id,
      slug: "flying-training",
      title: "Flying Training Abroad & India",
      subtitle: "Comprehensive CPL Flight Training Guidance and Conversion Support",
      description: "Airborne Aviation Academy helps students navigate their flight school selection in India or abroad (USA, South Africa, and the Philippines). We provide pre-departure DGCA ground school prep, flight school evaluations, and complete post-training DGCA license conversion support.",
      status: ContentStatus.PUBLISHED,
      category: "Flight Guidance",
      duration: "12–18 Months",
      eligibility: "Class 12th pass (Physics & Maths), DGCA Class 1 Medical",
      fee: 5500000.00,
      seoDesc: "CPL flying training in India and abroad through Airborne Aviation Academy, Dwarka Delhi. Compare flying schools, costs & timelines for Indian students.",
      seoKeywords: ["CPL flying training india", "pilot training abroad india students", "best country for pilot training"],
      order: 2,
      isFeatured: false,
      publishedAt: new Date(),
      curriculum: [
        { module: "Flying School Comparison & Safety Record Auditing" },
        { module: "Pre-departure ground school preparation" },
        { module: "Foreign CPL License Equivalency Guidance" },
        { module: "DGCA License Conversion Documentation & Support" },
        { module: "DGCA conversion exam & skill test preparation" }
      ],
      metadata: {
        image: "/footage/aircraft-ascending.jpg",
        batch: "Admissions counseling open",
        highlights: [
          "Structured comparison of USA, Philippines, South Africa, and India options",
          "Complete pre-departure ground school to clear all 6 papers before leaving",
          "Post-flying license conversion handling and documentation",
          "Partnerships with ICAO-approved global FTOs"
        ]
      }
    },
    {
      orgId: org.id,
      slug: "gd-pi",
      title: "GD & PI Mastery",
      subtitle: "Group Discussion and Personal Interview Coaching for Airline Selection",
      description: "Focused GD and PI coaching for pilot and cabin crew candidates. Practice real airline prompts, HR panels, and confidence drills before selection day.",
      status: ContentStatus.PUBLISHED,
      category: "Soft Skills",
      duration: "2–4 Weeks",
      eligibility: "CPL holders, cadet applicants, and cabin crew aspirants",
      fee: 30000.00,
      seoTitle: "GD & PI Course for Pilots | Airborne Aviation",
      seoDesc: "GD and personal interview coaching at Airborne Aviation Academy, Dwarka. Airline selection panels, mock GDs, and HR interview practice.",
      seoKeywords: ["GD PI aviation", "pilot interview coaching", "airline GD preparation"],
      order: 5,
      isFeatured: false,
      publishedAt: new Date(),
      curriculum: [
        { module: "Group Discussion strategy & aviation topics" },
        { module: "Personal Interview / HR panel coaching" },
        { module: "Mock selection rounds with feedback" },
      ],
      metadata: {
        image: "/footage/pilot-portrait.jpg",
        batch: "Rolling intakes",
        highlights: [
          "Airline-style GD prompts",
          "HR and technical interview drills",
          "Recorded feedback on delivery and presence",
        ],
      },
    },
    {
      orgId: org.id,
      slug: "cabin-crew",
      title: "Cabin Crew & Aviation Hospitality Training",
      subtitle: "Industry-Focused Flight Attendant Training in Dwarka, Delhi",
      description: "Structured cabin crew preparation for serious aviation aspirants. Taught by airline veterans - including ex-Alliance Air cabin and cockpit crew, and a retired Air India AGM (Training). The program spans 3 pathways: Elite Finishing, Advanced Communication/GD-PI Prep, and Basic Hospitality foundations.",
      status: ContentStatus.PUBLISHED,
      category: "Cabin Crew",
      duration: "3–6 Months",
      eligibility: "12th pass or above, 18-27 years of age, basic English ability",
      fee: 54000.00,
      seoTitle: "Cabin Crew & Aviation Hospitality Training Dwarka | Airborne",
      seoDesc: "Cabin crew course in Delhi by Airborne Aviation Academy. Structured finishing, communication, grooming, safety, and airline placement prep with industry veterans.",
      seoKeywords: ["cabin crew training delhi", "air hostess course dwarka", "aviation hospitality academy"],
      order: 9,
      isFeatured: false,
      publishedAt: new Date(),
      curriculum: [
        { module: "Aviation Fundamentals & Terminology" },
        { module: "Grooming, Makeup & Professional Presentation Protocols" },
        { module: "Aviation Spoken English & Voice Modulation" },
        { module: "Safety, Security & Emergency Evacuation Drills" },
        { module: "First Aid & Medical Emergency Management on board" },
        { module: "Customer Service Excellence & Hospitality Standards" },
        { module: "Airline Interview Prep, GD Strategy & Mock Panels" }
      ],
      metadata: {
        image: "/footage/clouds-above.jpg",
        batch: "Admissions open - July 2026 Batch",
        highlights: [
          "Taught by airline veterans: ex-crew Capt. Mukul Barua & ex-Air India AGM Rajeet Khalsa",
          "Combined 240-Hour program (180h Cabin Crew + 30h Voice & Diction + 30h PD Lab)",
          "Small batch size capped at 20 students for individual attention",
          "A320 mockup cabin setup for practical roleplays & safety drills",
          "Spoken English and pronunciation labs included",
          "Aadhaar, CV, and academic verification support included"
        ]
      }
    }
  ];

  for (const c of coursesData) {
    const course = await prisma.course.upsert({
      where: {
        orgId_slug: { orgId: c.orgId, slug: c.slug }
      },
      update: {
        title: c.title,
        subtitle: c.subtitle,
        description: c.description,
        status: c.status,
        category: c.category,
        duration: c.duration,
        eligibility: c.eligibility,
        fee: c.fee,
        seoTitle: c.seoTitle,
        seoDesc: c.seoDesc,
        seoKeywords: c.seoKeywords,
        order: c.order,
        publishedAt: c.publishedAt,
        curriculum: c.curriculum,
        metadata: c.metadata,
      },
      create: {
        orgId: c.orgId,
        slug: c.slug,
        title: c.title,
        subtitle: c.subtitle,
        description: c.description,
        status: c.status,
        category: c.category,
        duration: c.duration,
        eligibility: c.eligibility,
        fee: c.fee,
        seoTitle: c.seoTitle,
        seoDesc: c.seoDesc,
        seoKeywords: c.seoKeywords,
        order: c.order,
        publishedAt: c.publishedAt,
        curriculum: c.curriculum,
        metadata: c.metadata,
      }
    });

    console.log(`✅ Upserted course: ${course.title} (${course.slug})`);
  }

  console.log("\n🎉 Courses seeding completed successfully!\n");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
