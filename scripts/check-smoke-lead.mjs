import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'fs'

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
load('.env.local')
load('.env')

const prisma = new PrismaClient()
const org = await prisma.organization.findFirst({
  where: { slug: process.env.PUBLIC_ORG_SLUG || 'airborne-aviation' },
  select: { id: true },
})

const recent = await prisma.lead.findMany({
  where: {
    orgId: org.id,
    deletedAt: null,
    OR: [
      { email: { contains: 'demo-smoke-', mode: 'insensitive' } },
      { source: 'DIRECT', name: { startsWith: 'Demo Smoke' } },
      { name: { startsWith: 'Demo Smoke' } },
    ],
  },
  orderBy: { createdAt: 'desc' },
  take: 5,
  select: { id: true, name: true, email: true, phone: true, source: true, createdAt: true },
})

const qaLeft = await prisma.lead.count({
  where: {
    orgId: org.id,
    deletedAt: null,
    OR: [{ email: { equals: 'qa-probe@example.com', mode: 'insensitive' } }, { phone: { contains: '9999999999' } }],
  },
})

console.log('RECENT_SMOKE', JSON.stringify(recent, null, 2))
console.log('QA_LEFT', qaLeft)
await prisma.$disconnect()
