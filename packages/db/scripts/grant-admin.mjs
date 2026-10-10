#!/usr/bin/env node
/**
 * Grant or revoke platform (super) admin from the server shell.
 * This is the ONLY way the first admin is created — there is no
 * web path to self-grant. Usage:
 *   DATABASE_URL=... node scripts/grant-admin.mjs user@email.com [--tier=SUPER|SUPPORT|FINANCE] [--revoke]
 */
import { PrismaClient } from "@prisma/client";

const email = process.argv[2]?.toLowerCase();
const revoke = process.argv.includes("--revoke");
const tierArg = process.argv.find((a) => a.startsWith("--tier="));
const tier = tierArg ? tierArg.split("=")[1] : "SUPER";
if (!email) { console.error("Usage: grant-admin.mjs <email> [--tier=SUPER] [--revoke]"); process.exit(1); }
if (!["SUPER", "SUPPORT", "FINANCE"].includes(tier)) { console.error("tier must be SUPER, SUPPORT or FINANCE"); process.exit(1); }

const prisma = new PrismaClient();
try {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { console.error(`No user with email ${email}`); process.exit(1); }
  if (revoke) {
    const supers = await prisma.user.count({ where: { isSuperAdmin: true, status: "ACTIVE" } });
    if (user.isSuperAdmin && supers <= 1) { console.error("Refusing: this is the last active super admin."); process.exit(1); }
    await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: false, adminTier: null, tokenVersion: { increment: 1 } } });
    console.log(`Revoked admin from ${email} (token version bumped).`);
  } else {
    await prisma.user.update({ where: { id: user.id }, data: { isSuperAdmin: true, adminTier: tier, status: "ACTIVE", totpEnabled: false, totpSecretEncrypted: null } });
    console.log(`Granted ${tier} admin to ${email}. (Any previous TOTP enrolment was reset — break-glass recovery.)`);
  }
  await prisma.auditLog.create({
    data: { userId: user.id, action: revoke ? "admin.revoked_cli" : "admin.granted_cli", entityType: "User", entityId: user.id, metadata: { tier, via: "cli" } },
  });
} finally {
  await prisma.$disconnect();
}
