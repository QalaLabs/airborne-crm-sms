/**
 * Fee/payment financial-integrity reconciliation (report-first).
 *
 * Usage (from admin/):
 *   node scripts/reconcile-fees.mjs                     # report only, read-only
 *   node scripts/reconcile-fees.mjs --fix               # recompute feePaid/feeBalance (see FIXES at bottom)
 *
 * SAFETY: never run --fix against production. The script refuses to execute
 * --fix when the database host looks like a production/supabase/cloud-sql
 * endpoint unless RECONCILE_FORCE=1 is set. Report mode is read-only and safe.
 */
import { readFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'

const raw = readFileSync(process.env.DOTENV_FILE ?? '.env.local', 'utf8')
for (const line of raw.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue
  const i = line.indexOf('=')
  if (i < 0) continue
  const key = line.slice(0, i).trim()
  let val = line.slice(i + 1).trim()
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
  if (!process.env[key]) process.env[key] = val
}

const WANT_FIX = process.argv.includes('--fix')
const dbUrl = process.env.DATABASE_URL ?? ''
const looksProd = /supabase|cloudsql|cloud\.sql|unix|production/i.test(dbUrl)
if (WANT_FIX && looksProd && process.env.RECONCILE_FORCE !== '1') {
  console.error('REFUSING: --fix against a production-looking database. Report only.')
  process.exit(1)
}

const prisma = new PrismaClient()

const NET_CONTRIBUTING = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUNDED']
const ROUND2 = (n) => Math.round(n * 100) / 100

function fmt(n) {
  return typeof n === 'bigint' ? Number(n).toLocaleString('en-IN') : (n ?? 0).toLocaleString('en-IN')
}

async function main() {
  const admissions = await prisma.admission.findMany({
    select: {
      id: true,
      applicationNo: true,
      feeAmount: true,
      feeDiscount: true,
      feePaid: true,
      feeBalance: true,
      payments: {
        select: { id: true, amount: true, status: true, refundedAmount: true, refundedAt: true, paidAt: true, createdAt: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const paymentErrs = []
  const idempotent = new Map()
  const allPayments = await prisma.paymentTransaction.findMany({ select: { id: true, idempotencyKey: true } })
  for (const p of allPayments) {
    if (!p.idempotencyKey) continue
    const k = p.idempotencyKey
    if (!idempotent.has(k)) idempotent.set(k, [])
    idempotent.get(k).push(p.id)
  }

  for (const p of await prisma.paymentTransaction.findMany({
    select: { id: true, receiptNo: true, amount: true, status: true, refundedAmount: true, refundedAt: true, refundedBy: true, paidAt: true },
  })) {
    const r = Number(p.refundedAmount ?? 0)
    const a = Number(p.amount ?? 0)
    if (p.status === 'REFUNDED' && r !== a) paymentErrs.push({ id: p.id, receipt: p.receiptNo, msg: `REFUNDED but refundedAmount=${r} /= amount=${a}` })
    if (p.status === 'COMPLETED' && r > 0) paymentErrs.push({ id: p.id, receipt: p.receiptNo, msg: `COMPLETED but refundedAmount=${r} > 0` })
    if (p.status !== 'REFUNDED' && p.status !== 'PARTIALLY_REFUNDED' && (r > 0 || p.refundedAt != null || p.refundedBy != null)) {
      paymentErrs.push({ id: p.id, receipt: p.receiptNo, msg: `status=${p.status} but refund fields populated` })
    }
    if (p.refundedAt != null && r === 0) paymentErrs.push({ id: p.id, receipt: p.receiptNo, msg: 'refundedAt set but refundedAmount = 0' })
    if (p.status === 'PARTIALLY_REFUNDED') paymentErrs.push({ id: p.id, receipt: p.receiptNo, msg: 'legacy PARTIALLY_REFUNDED row - backfilled refund math is provisional, manual review' })
  }

  let mismatches = 0
  let outstanding = 0
  let credit = 0
  let fullyPaid = 0
  const mismatchedRows = []

  for (const ad of admissions) {
    const feeFinal = ad.feeAmount != null ? ROUND2(Number(ad.feeAmount) - Number(ad.feeDiscount ?? 0)) : null
    const netPaid = ad.payments.reduce((s, p) => {
      if (!NET_CONTRIBUTING.includes(p.status)) return s
      return s + Math.max(0, Number(p.amount ?? 0) - Number(p.refundedAmount ?? 0))
    }, 0)
    const recomputed = feeFinal == null ? { feePaid: 0, feeBalance: 0 } : { feePaid: ROUND2(netPaid), feeBalance: ROUND2(feeFinal - netPaid) }
    const storedPaid = Number(ad.feePaid ?? 0)
    const storedBalance = Number(ad.feeBalance ?? 0)
    const paidOk = Math.abs(storedPaid - recomputed.feePaid) < 0.01
    const balOk = Math.abs(storedBalance - recomputed.feeBalance) < 0.01
    if (!paidOk || !balOk) {
      mismatches++
      mismatchedRows.push({ id: ad.id, app: ad.applicationNo, storedPaid, storedBalance, recomputed })
    }
    if (feeFinal != null && recomputed.feeBalance > 0) outstanding++
    else if (feeFinal != null && recomputed.feeBalance < 0) credit++
    else if (feeFinal != null) fullyPaid++
  }

  const idempotentDupes = [...idempotent.entries()].filter(([, ids]) => ids.length > 1)

  const seqCheck = await prisma.$queryRawUnsafe(
    `SELECT last_value FROM payment_receipt_seq`,
  )
  const seqRaw = Array.isArray(seqCheck) ? seqCheck : [seqCheck]
  const seqVal = Number(seqRaw?.[0]?.last_value ?? 0)

  const latestReceipt = await prisma.paymentTransaction.findFirst({
    where: { receiptNo: { not: null } },
    select: { receiptNo: true },
    orderBy: { createdAt: 'desc' },
  })
  let latestSeq = 0
  const m = latestReceipt?.receiptNo?.match(/^RCP-[0-9]{6}-([0-9]+)$/)
  if (m) latestSeq = Number(m[1])

  console.log('==== FEE / PAYMENT RECONCILIATION (report) ====')
  console.log(`Admissions checked:        ${admissions.length}`)
  console.log(`Fee+balance mismatches:    ${mismatches}`)
  if (mismatchedRows.length) {
    for (const r of mismatchedRows) {
      console.log(`  MISMATCH ${r.app} stored paid=${fmt(r.storedPaid)} bal=${fmt(r.storedBalance)} recomputed paid=${fmt(r.recomputed.feePaid)} bal=${fmt(r.recomputed.feeBalance)}`)
    }
  }
  console.log(`Outstanding (bal>0):       ${outstanding}`)
  console.log(`Credit (bal<0):            ${credit}`)
  console.log(`Fully paid:                ${fullyPaid}`)
  console.log(`Payment field anomalies:   ${paymentErrs.length}`)
  for (const p of paymentErrs) console.log(`  FLAG ${p.receipt ?? p.id} ${p.msg}`)
  console.log(`Idempotency duplicate keys:${idempotentDupes.length}`)
  for (const [k, ids] of idempotentDupes) console.log(`  DUPE ${k} -> ${ids.length} rows`)
  console.log(`Receipt sequence:          last_value=${fmt(seqVal)} max-receipt-suffix=${latestSeq} ${seqVal < latestSeq ? '!! SEQUENCE BEHIND RECEIPTS - COLLISION RISK' : 'OK'}`)

  if (WANT_FIX) {
    console.log('\n==== APPLYING FIXES (feePaid/feeBalance recompute) ====')
    for (const r of mismatchedRows) {
      await prisma.admission.update({
        where: { id: r.id },
        data: { feePaid: r.recomputed.feePaid, feeBalance: r.recomputed.feeBalance },
      })
      console.log(`  FIXED ${r.app} -> paid=${fmt(r.recomputed.feePaid)} bal=${fmt(r.recomputed.feeBalance)}`)
    }
    console.log(`Fixed ${mismatchedRows.length} admissions. (Payment fields were NOT mutated; resolve flags manually.)`)
  } else {
    console.log('\nRun with --fix to recompute derived feePaid/feeBalance (not for production).')
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())