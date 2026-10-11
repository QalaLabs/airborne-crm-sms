// Syncs the 11 public website courses into the LMS as overview-only courses.
//   node scripts/lms-course-sync.mjs            dry run (read-only plan)
//   node scripts/lms-course-sync.mjs --apply    create the missing courses (single transaction)
//   node scripts/lms-course-sync.mjs --verify   read-only check of stored rows against the plan
// LMS_SYNC_EXPECT_HOST=<host> makes the script refuse any other database host.
// Never updates or deletes existing LMS courses.
import { register } from 'node:module'
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'
import { buildTargets, buildSyncPlan, diffAgainstTarget } from '../src/lib/lms/lms-course-plan.ts'

register('./lib/website-alias-hooks.mjs', import.meta.url)
const { COURSE_SCHEMA } = await import('../../src/lib/schema/courseRegistry.js')
const { LEGACY_COURSE_ITEMS, marketingToApiSlug } = await import('../../src/lib/publicCourses.js')
const { displayCourseFee } = await import('../../src/lib/courseFees.js')

function load(f) {
  if (!existsSync(f)) return
  for (const line of readFileSync(f, 'utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!process.env[k]) process.env[k] = v
  }
}
load('.env')

// cabin-crew-training/page.jsx reads the Admin course with slug "cabin-crew".
const PAGE_MARKETING_SLUG = { 'cabin-crew-training': 'cabin-crew' }
const toMarketingSlug = (slug) => PAGE_MARKETING_SLUG[slug] ?? marketingToApiSlug(slug)

const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--verify') ? 'verify' : 'dry-run'
const orgSlug = process.env.PUBLIC_ORG_SLUG ?? 'airborne-aviation'
const dbHost = (() => {
  try {
    return new URL(process.env.DATABASE_URL).hostname || '(socket)'
  } catch {
    return '(unparseable DATABASE_URL)'
  }
})()
const expectHost = process.env.LMS_SYNC_EXPECT_HOST
if (expectHost && expectHost !== dbHost) {
  console.error(`refusing to run: DATABASE_URL host ${dbHost} != LMS_SYNC_EXPECT_HOST ${expectHost}`)
  process.exit(2)
}

const prisma = new PrismaClient()
try {
  const org = await prisma.organization.findFirst({ where: { slug: orgSlug }, select: { id: true, slug: true } })
  if (!org) throw new Error(`organization "${orgSlug}" not found`)
  console.log(`mode=${mode} dbHost=${dbHost} org=${org.slug} (${org.id})`)

  const marketingCourses = (
    await prisma.course.findMany({
      where: { orgId: org.id },
      select: { id: true, slug: true, status: true, fee: true, duration: true },
    })
  ).map((c) => ({ ...c, fee: c.fee == null ? null : String(c.fee) }))
  const existing = await prisma.lmsCourse.findMany({
    where: { orgId: org.id },
    select: { id: true, slug: true, title: true, status: true, marketingCourseId: true, metadata: true, _count: { select: { stages: true, batches: true, enrollments: true } } },
    orderBy: { createdAt: 'asc' },
  })

  const targets = buildTargets({
    websiteCourses: Object.values(COURSE_SCHEMA),
    catalogItems: LEGACY_COURSE_ITEMS,
    marketingCourses,
    toMarketingSlug,
    feeLabel: displayCourseFee,
  })
  const plan = buildSyncPlan(targets, existing)

  console.log(`\nwebsite courses: ${targets.length}`)
  for (const e of plan.entries) {
    const t = e.target
    console.log(
      `  ${e.action.padEnd(7)} ${t.slug.padEnd(42)} ${t.title} | ${t.metadata.duration ?? '-'} | ${t.metadata.mode ?? '-'} | ${t.metadata.fee ?? '-'} | marketing=${t.marketingSlug ?? 'none'}${e.reason ? ` | ${e.reason}` : ''}`,
    )
  }
  const targetSlugs = new Set(targets.map((t) => t.slug))
  const others = existing.filter((c) => !targetSlugs.has(c.slug))
  console.log(`\nexisting LMS courses outside the website list: ${others.length}`)
  for (const c of others) {
    console.log(`  ${c.slug} | ${c.title} | ${c.status} | stages=${c._count.stages} batches=${c._count.batches} enrollments=${c._count.enrollments}`)
  }
  console.log(`\nsemantic title matches (report only, nothing merged): ${plan.semanticMatches.length}`)
  for (const m of plan.semanticMatches) {
    console.log(`  LMS "${m.lmsTitle}" (${m.lmsSlug}) ~ website "${m.websiteTitle}" (${m.websiteSlug}) score=${m.score.toFixed(2)}`)
  }

  const toCreate = plan.entries.filter((e) => e.action === 'create')
  const blocked = plan.entries.filter((e) => e.action === 'blocked')
  console.log(`\nplan: create=${toCreate.length} exists=${plan.entries.length - toCreate.length - blocked.length} blocked=${blocked.length} problems=${plan.problems.length}`)
  for (const p of plan.problems) console.log(`  PROBLEM: ${p}`)

  if (mode === 'apply') {
    if (plan.problems.length || blocked.length) throw new Error('refusing to apply: plan has problems or blocked entries')
    if (toCreate.length) {
      await prisma.$transaction(
        toCreate.map(({ target: t }) =>
          prisma.lmsCourse.create({
            data: {
              orgId: org.id,
              marketingCourseId: t.marketingCourseId,
              slug: t.slug,
              title: t.title,
              description: t.description,
              status: 'PUBLISHED',
              isPublished: true,
              metadata: t.metadata,
            },
          }),
        ),
      )
    }
    console.log(`created ${toCreate.length} overview-only LMS courses`)
  }

  if (mode === 'verify' || mode === 'apply') {
    const stored = await prisma.lmsCourse.findMany({
      where: { orgId: org.id, slug: { in: [...targetSlugs] } },
      select: { id: true, slug: true, title: true, status: true, isPublished: true, marketingCourseId: true, metadata: true, _count: { select: { stages: true } } },
    })
    const bySlug = new Map(stored.map((s) => [s.slug, s]))
    let failures = 0
    console.log(`\nverify: ${stored.length}/${targets.length} website courses present in LMS`)
    for (const t of targets) {
      const s = bySlug.get(t.slug)
      const diffs = s ? diffAgainstTarget(s, t) : ['missing']
      if (s && s._count.stages > 0) diffs.push(`has ${s._count.stages} stages`)
      if (s && (!s.isPublished || s.status !== 'PUBLISHED')) diffs.push(`status ${s.status}/${s.isPublished}`)
      if (diffs.length) failures++
      console.log(`  ${diffs.length ? 'FAIL' : 'ok  '} ${t.slug}${s ? ` id=${s.id}` : ''}${diffs.length ? ` :: ${diffs.join('; ')}` : ''}`)
    }
    const dupes = await prisma.lmsCourse.groupBy({ by: ['slug'], where: { orgId: org.id }, _count: { _all: true }, having: { slug: { _count: { gt: 1 } } } })
    console.log(`duplicate slugs in org: ${dupes.length}`)
    if (failures || dupes.length) {
      process.exitCode = 1
      console.log(`VERIFY FAILED (${failures} course mismatches)`)
    } else {
      console.log('VERIFY OK')
    }
  }
} finally {
  await prisma.$disconnect()
}
