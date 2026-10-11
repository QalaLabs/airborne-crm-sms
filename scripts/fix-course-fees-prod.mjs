import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'

// Load .env.production.local without printing secrets
const raw = readFileSync('.env.production.local', 'utf8')
for (const line of raw.split(/\r?\n/)) {
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

const prisma = new PrismaClient()

const updates = [
  { slug: 'cadet-preparation', fee: 50000 },
  { slug: 'a320-simulator', fee: 10000 },
  { slug: 'airline-preparation', fee: 125000 },
  { slug: 'cabin-crew', fee: 54000 },
]

async function main() {
  for (const u of updates) {
    const before = await prisma.course.findFirst({
      where: { slug: u.slug },
      select: { id: true, slug: true, fee: true, title: true },
    })
    console.log('BEFORE', JSON.stringify(before))
    if (!before) {
      console.log('MISSING', u.slug)
      continue
    }
    const after = await prisma.course.update({
      where: { id: before.id },
      data: { fee: u.fee },
      select: { slug: true, fee: true, title: true },
    })
    console.log('AFTER ', JSON.stringify(after))
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
