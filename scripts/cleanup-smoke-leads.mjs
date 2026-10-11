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
const r = await prisma.lead.updateMany({
  where: { email: { contains: 'demo-smoke-' }, deletedAt: null },
  data: { deletedAt: new Date() },
})
console.log('soft_deleted', r.count)
await prisma.$disconnect()
