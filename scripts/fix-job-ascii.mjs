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
const id = '0475125b-a408-4d68-9f37-e62ae7e20a0c'

await prisma.job.update({
  where: { id },
  data: {
    title: 'IndiGo Cadet Pilot Intake - Guidance Track',
    description:
      'Airborne mentoring track for aspirants targeting the next IndiGo cadet pilot selection window. Includes aptitude prep, GD/PI coaching, and Class 1 medical guidance.',
    requirements:
      '10+2 with Physics & Maths | Age 17-30 | DGCA Class 1 medical preferred | Strong English communication',
  },
})
console.log('job ascii fixed')
await prisma.$disconnect()
