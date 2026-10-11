/**
 * Sync production course fees to PDF (Airborne_Page_Content_v6) values.
 * Usage (from admin/): npx vercel env pull .env.production.local --yes --environment=production
 *                      node scripts/audit-fix-fees-prod.mjs
 *                      Remove-Item .env.production.local
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'

const raw = readFileSync('.env.production.local', 'utf8')
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const i = line.indexOf('=')
  if (i < 0) continue
  const key = line.slice(0, i).trim()
  let val = line.slice(i + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
  if (!process.env[key]) process.env[key] = val
}

const prisma = new PrismaClient()

/** Must match src/lib/courseFees.js COURSE_FEE_NUMERIC */
const updates = [
  { slug: 'cadet-preparation', fee: 50000 },
  { slug: 'a320-simulator', fee: 10000 },
  { slug: 'atpl', fee: 150000 },
  { slug: 'airline-preparation', fee: 125000 },
  { slug: 'cpl-ground-classes', fee: 270000 },
  { slug: 'cas-compass-adapt', fee: 30000 },
  { slug: 'cabin-crew', fee: 54000 },
  { slug: 'flying-training', fee: 5500000 },
]

async function main() {
  console.log('==== ALL COURSES ====')
  const all = await prisma.course.findMany({
    select: { slug: true, fee: true, title: true, status: true },
    orderBy: { slug: 'asc' },
  })
  for (const c of all) console.log(`${c.slug}\t${c.fee}\t${c.status}\t${c.title}`)

  for (const u of updates) {
    const before = await prisma.course.findFirst({ where: { slug: u.slug }, select: { id: true, slug: true, fee: true } })
    if (!before) { console.log('MISSING', u.slug); continue }
    if (Number(before.fee) === u.fee) { console.log('OK', u.slug, u.fee); continue }
    const after = await prisma.course.update({ where: { id: before.id }, data: { fee: u.fee }, select: { slug: true, fee: true } })
    console.log('UPDATED', before.slug, String(before.fee), '->', String(after.fee))
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
