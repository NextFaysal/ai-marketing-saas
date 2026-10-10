// Development-only seed. Never use these credentials outside local dev.
import { PrismaClient, Role } from "@prisma/client";
import { hashSync } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "owner@demo.local" },
    update: {},
    create: {
      email: "owner@demo.local",
      name: "Demo Owner",
      passwordHash: hashSync("ChangeMe123!", 10),
    },
  });
  const org = await prisma.organization.upsert({
    where: { slug: "demo-store" },
    update: {},
    create: { name: "Demo Store", slug: "demo-store", country: "BD", currency: "BDT" },
  });
  await prisma.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: {},
    create: { userId: user.id, organizationId: org.id, role: Role.OWNER },
  });
  await prisma.businessProfile.upsert({
    where: { organizationId: org.id },
    update: {},
    create: { organizationId: org.id, industry: "ecommerce", description: "Demo store (development seed only)" },
  });
  console.log("Seeded dev user owner@demo.local / org demo-store");
}

main().finally(() => prisma.$disconnect());
