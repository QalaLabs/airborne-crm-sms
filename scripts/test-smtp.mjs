/**
 * One-shot SMTP verify + test send. Loads admin/.env.local then .env.
 * Usage: node --import tsx scripts/test-smtp.mjs [to@email]
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const p = resolve(root, file);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") process.env[key] = val;
  }
}

loadEnv(".env");
loadEnv(".env.local");

const host = process.env.SMTP_HOST?.trim();
const port = Number(process.env.SMTP_PORT ?? "587");
const user = process.env.SMTP_USER?.trim();
const pass = (process.env.SMTP_PASS ?? "").replace(/\s+/g, "");
const from = process.env.SMTP_FROM?.trim() || user;
const secure = process.env.SMTP_SECURE === "true" || port === 465;
const to = process.argv[2] || user;

if (!host || !user || !pass) {
  console.error("FAIL: SMTP_HOST / SMTP_USER / SMTP_PASS missing");
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure,
  requireTLS: !secure && port === 587,
  auth: { user, pass },
  connectionTimeout: 15_000,
  greetingTimeout: 15_000,
  socketTimeout: 20_000,
});

console.log(`Connecting ${host}:${port} as ${user} (secure=${secure})…`);
try {
  await transporter.verify();
  console.log("VERIFY: OK — server accepted auth");
} catch (err) {
  console.error("VERIFY: FAIL —", err instanceof Error ? err.message : err);
  process.exit(1);
}

try {
  const info = await transporter.sendMail({
    from,
    to,
    subject: `[Airborne] SMTP test ${new Date().toISOString()}`,
    text: "SMTP test from Airborne Admin. If you received this, Gmail SMTP is working.",
  });
  console.log(`SEND: OK — messageId=${info.messageId} to=${to}`);
} catch (err) {
  console.error("SEND: FAIL —", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  transporter.close();
}
