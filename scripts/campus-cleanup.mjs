// Lists campuses with reference counts; with --apply, deactivates every campus except Delhi.
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
load('.env')

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient()
const org = await prisma.organization.findFirst({ where: { slug: 'airborne-aviation' }, select: { id: true } })
const campuses = await prisma.campus.findMany({
  where: { orgId: org.id },
  select: {
    id: true, name: true, code: true, city: true, isActive: true,
    _count: { select: { users: true, leads: true, students: true, admissions: true, payments: true } },
  },
  orderBy: { createdAt: 'asc' },
})
for (const c of campuses) {
  console.log(`${c.code}\t${c.name}\t${c.city ?? ''}\tactive=${c.isActive}\t${JSON.stringify(c._count)}`)
}

if (apply) {
  const keep = campuses.filter((c) => /delhi/i.test(`${c.name} ${c.city ?? ''}`) || c.code === 'DEL')
  if (keep.length !== 1) throw new Error(`expected exactly one Delhi campus, found ${keep.length}`)
  const off = campuses.filter((c) => c.id !== keep[0].id && c.isActive)
  if (off.length) {
    await prisma.campus.updateMany({ where: { id: { in: off.map((c) => c.id) } }, data: { isActive: false } })
  }
  console.log(`kept ${keep[0].code}; deactivated: ${off.map((c) => c.code).join(', ') || 'none'}`)
}
await prisma.$disconnect()
