import { PrismaClient } from "@prisma/client";
import { hash } from "argon2";

async function main() {
  const p = new PrismaClient();
  const org = await p.organization.findFirst({ where: { slug: "airborne-aviation" } });
  if (!org) throw new Error("org missing - run npm run db:seed:lms");
  const passwordHash = await hash("Admin@1234!");
  const admin = await p.user.upsert({
    where: { email_orgId: { email: "admin@airborneaviation.in", orgId: org.id } },
    update: { passwordHash, isActive: true, role: "ADMIN", deletedAt: null },
    create: {
      orgId: org.id,
      name: "Airborne Admin",
      email: "admin@airborneaviation.in",
      passwordHash,
      role: "ADMIN",
      isActive: true,
      emailVerified: new Date(),
    },
  });
  console.log("OK", admin.email, admin.role, org.slug);
  await p.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
