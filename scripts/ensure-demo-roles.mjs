/**
 * Idempotent upsert of RC demo ADMIN / TEACHER / STUDENT users.
 * Does NOT reset the DB. Safe to re-run after seed.
 *
 * Usage (from admin/):
 *   node scripts/ensure-demo-roles.mjs
 *
 * Loads admin/.env / .env.local for DATABASE_URL.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adminRoot = resolve(__dirname, "..");

function loadEnv(file) {
  const path = resolve(adminRoot, file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnv(".env.local");
loadEnv(".env");

const ORG_SLUG = process.env.PUBLIC_ORG_SLUG || "airborne-aviation";

const DEMOS = [
  {
    email: "admin@airborneaviation.in",
    name: "Airborne Admin",
    role: "ADMIN",
    password: "Admin@1234!",
  },
  {
    email: "demo.teacher@airborneaviation.in",
    name: "Demo Teacher",
    role: "TEACHER",
    password: "DemoTeacher1!",
  },
  {
    email: "demo.student@airborneaviation.in",
    name: "Arjun Sharma",
    role: "STUDENT",
    password: "DemoStudent1!",
  },
];

async function ensureUser(prisma, orgId, demo) {
  const passwordHash = await hash(demo.password);
  const existing = await prisma.user.findFirst({
    where: { email: demo.email, orgId },
  });

  if (!existing) {
    const created = await prisma.user.create({
      data: {
        orgId,
        email: demo.email,
        name: demo.name,
        passwordHash,
        role: demo.role,
        isActive: true,
        emailVerified: new Date(),
      },
      select: { id: true, email: true, role: true, isActive: true },
    });
    return { action: "created", user: created };
  }

  const updated = await prisma.user.update({
    where: { id: existing.id },
    data: {
      passwordHash,
      role: demo.role,
      isActive: true,
      deletedAt: null,
      name: existing.name || demo.name,
    },
    select: { id: true, email: true, role: true, isActive: true },
  });
  return { action: "updated", user: updated };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing - set it or add admin/.env");
  }

  const prisma = new PrismaClient();
  try {
    const org = await prisma.organization.findFirst({
      where: { slug: ORG_SLUG },
      select: { id: true, slug: true, name: true },
    });
    if (!org) {
      throw new Error(
        `Organization '${ORG_SLUG}' not found. Run npm run db:seed or db:seed:lms first.`,
      );
    }

    console.log(`Org: ${org.name} (${org.slug})`);
    for (const demo of DEMOS) {
      const { action, user } = await ensureUser(prisma, org.id, demo);
      console.log(
        `${action.padEnd(7)} ${user.role.padEnd(8)} ${user.email} active=${user.isActive}`,
      );
    }
    console.log("Done. Passwords not printed (see seed header / docs).");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
