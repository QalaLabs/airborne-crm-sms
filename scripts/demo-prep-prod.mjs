/**
 * Demo prep against DATABASE_URL in admin/.env:
 * 1) Delete QA probe lead
 * 2) Ensure one PUBLISHED job, one PUBLISHED resource, one APPROVED testimonial
 */
import { readFileSync, existsSync } from 'fs'
import { PrismaClient } from '@prisma/client'

function loadEnv(file) {
  if (!existsSync(file)) return
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    const key = line.slice(0, i).trim()
    let val = line.slice(i + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnv('.env.local')
loadEnv('.env')

const prisma = new PrismaClient()
const ORG_SLUG = process.env.PUBLIC_ORG_SLUG || 'airborne-aviation'

async function main() {
  const org = await prisma.organization.findFirst({
    where: { slug: ORG_SLUG },
    select: { id: true, name: true },
  })
  if (!org) throw new Error(`Org not found: ${ORG_SLUG}`)
  console.log('ORG', org.name, org.id)

  // ── Delete QA probe lead(s) ──────────────────────────────────────────────
  const qa = await prisma.lead.findMany({
    where: {
      orgId: org.id,
      deletedAt: null,
      OR: [
        { email: { equals: 'qa-probe@example.com', mode: 'insensitive' } },
        { phone: { contains: '9999999999' } },
        { name: { contains: 'Release QA Probe', mode: 'insensitive' } },
      ],
    },
    select: { id: true, name: true, email: true, phone: true },
  })
  console.log('QA_LEADS_FOUND', qa.length, JSON.stringify(qa))
  if (qa.length) {
    const ids = qa.map((l) => l.id)
    await prisma.leadActivity.deleteMany({ where: { leadId: { in: ids } } }).catch(() => {})
    await prisma.leadScoreHistory.deleteMany({ where: { leadId: { in: ids } } }).catch(() => {})
    const soft = await prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: { deletedAt: new Date() },
    })
    console.log('QA_LEADS_SOFT_DELETED', soft.count)
  }

  // ── Demo Job ─────────────────────────────────────────────────────────────
  const jobSlug = 'demo-cadet-pilot-intake-2026'
  const job = await prisma.job.upsert({
    where: { orgId_slug: { orgId: org.id, slug: jobSlug } },
    create: {
      orgId: org.id,
      title: 'IndiGo Cadet Pilot Intake - Guidance Track',
      slug: jobSlug,
      description:
        'Airborne mentoring track for aspirants targeting the next IndiGo cadet pilot selection window. Includes aptitude prep, GD/PI coaching, and Class 1 medical guidance.',
      requirements:
        '10+2 with Physics & Maths · Age 17–30 · DGCA Class 1 medical preferred · Strong English communication',
      location: 'Dwarka, New Delhi',
      isRemote: false,
      jobType: 'full_time',
      salaryMin: 150000,
      salaryMax: 250000,
      currency: 'INR',
      experienceYears: 0,
      status: 'PUBLISHED',
      publishedAt: new Date(),
      tags: ['cadet', 'indigo', 'pilot'],
      metadata: { demo: true, airline: 'IndiGo' },
    },
    update: {
      title: 'IndiGo Cadet Pilot Intake - Guidance Track',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      closesAt: null,
    },
    select: { id: true, slug: true, status: true },
  })
  console.log('JOB', JSON.stringify(job))

  // ── Demo Resource ────────────────────────────────────────────────────────
  const resSlug = 'demo-dgca-cpl-syllabus-overview'
  const resource = await prisma.resource.upsert({
    where: { orgId_slug: { orgId: org.id, slug: resSlug } },
    create: {
      orgId: org.id,
      title: 'DGCA CPL Ground School - Syllabus Overview',
      slug: resSlug,
      description:
        'One-page overview of all 5 DGCA CPL theoretical papers taught at Airborne Aviation Academy, Dwarka.',
      type: 'LINK',
      status: 'PUBLISHED',
      externalUrl: 'https://www.airborneaviation.in/courses/commercial-pilot-license-cpl',
      isGated: false,
      category: 'Syllabus',
      tags: ['dgca', 'cpl', 'syllabus'],
      publishedAt: new Date(),
      metadata: { demo: true },
    },
    update: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      externalUrl: 'https://www.airborneaviation.in/courses/commercial-pilot-license-cpl',
      isGated: false,
    },
    select: { id: true, slug: true, status: true },
  })
  console.log('RESOURCE', JSON.stringify(resource))

  // ── Demo Testimonial ─────────────────────────────────────────────────────
  // No unique slug - find by author + demo metadata, else create
  let testimonial = await prisma.testimonial.findFirst({
    where: {
      orgId: org.id,
      authorName: 'Capt. Nipun Singh',
      source: 'demo-prep',
    },
  })
  if (testimonial) {
    testimonial = await prisma.testimonial.update({
      where: { id: testimonial.id },
      data: {
        status: 'APPROVED',
        isFeatured: true,
        content:
          'Capt. Navrang made DGCA subjects click. Air Regulations and Technical finally made sense - cleared all papers on the first attempt and moved into the cockpit with confidence.',
        authorTitle: 'First Officer · Air India',
        rating: 5,
        batchYear: 2023,
        order: 1,
        reviewedAt: new Date(),
      },
      select: { id: true, authorName: true, status: true },
    })
  } else {
    testimonial = await prisma.testimonial.create({
      data: {
        orgId: org.id,
        authorName: 'Capt. Nipun Singh',
        authorTitle: 'First Officer · Air India',
        content:
          'Capt. Navrang made DGCA subjects click. Air Regulations and Technical finally made sense - cleared all papers on the first attempt and moved into the cockpit with confidence.',
        rating: 5,
        batchYear: 2023,
        status: 'APPROVED',
        isFeatured: true,
        order: 1,
        source: 'demo-prep',
        reviewedAt: new Date(),
        metadata: { demo: true },
      },
      select: { id: true, authorName: true, status: true },
    })
  }
  console.log('TESTIMONIAL', JSON.stringify(testimonial))

  const counts = {
    jobs: await prisma.job.count({ where: { orgId: org.id, status: 'PUBLISHED' } }),
    resources: await prisma.resource.count({ where: { orgId: org.id, status: 'PUBLISHED' } }),
    testimonials: await prisma.testimonial.count({ where: { orgId: org.id, status: 'APPROVED' } }),
    qaLeft: await prisma.lead.count({
      where: {
        orgId: org.id,
        deletedAt: null,
        OR: [
          { email: { equals: 'qa-probe@example.com', mode: 'insensitive' } },
          { phone: { contains: '9999999999' } },
        ],
      },
    }),
  }
  console.log('COUNTS', JSON.stringify(counts))
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
