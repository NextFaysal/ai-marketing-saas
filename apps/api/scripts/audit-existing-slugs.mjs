#!/usr/bin/env node
/**
 * TD1 — existing-slug audit.
 *
 * Runs every EXISTING organization slug against the TD1 rules
 * (strict format + RESERVED_SLUGS + admin/support/official
 * substring rule + the SUPER-added "reservedSlugsExtra" platform
 * setting) and reports conflicts. It NEVER renames or modifies
 * anything — a conflict means "this org's subdomain must not be
 * enabled until the owner decides", per the TD plan.
 *
 * Rules come from the compiled contracts package
 * (packages/contracts/dist/index.js) — the same source of truth
 * the API enforces, never a copy.
 *
 * Modes:
 *   DB mode (default): reads organizations + the
 *     reservedSlugsExtra setting through the @repo/db Prisma
 *     client. Needs DATABASE_URL and built packages
 *     (`pnpm --filter @repo/contracts build && pnpm --filter @repo/db build`,
 *     `pnpm --filter @repo/db generate`).
 *   Fixture mode (for sandboxes without a database):
 *     node apps/api/scripts/audit-existing-slugs.mjs --fixtures slugs.json
 *     where slugs.json is either an array of { "slug": "...", "name": "..." }
 *     or { "organizations": [...], "reservedSlugsExtra": ["..."] }.
 *
 * Exit codes: 0 = audit ran (conflicts are reported, not fatal);
 * 2 = setup problem (dist missing / no DATABASE_URL / bad fixture).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const contractsDist = join(here, "..", "..", "..", "packages", "contracts", "dist", "index.js");
const dbDist = join(here, "..", "..", "..", "packages", "db", "dist", "index.js");

if (!existsSync(contractsDist)) {
  console.error("SETUP: packages/contracts/dist/index.js not found. Run `pnpm --filter @repo/contracts build` first.");
  process.exit(2);
}
const { checkSlugLocally, slugFormatInvalid, isReservedSlug } = await import(contractsDist);

function classify(slug, extras) {
  if (slugFormatInvalid(slug)) return "invalid-format";
  if (isReservedSlug(slug, extras)) return "reserved";
  return null;
}

let organizations = [];
let extras = [];
const fixtureArg = process.argv.indexOf("--fixtures");
if (fixtureArg >= 0) {
  const path = process.argv[fixtureArg + 1];
  if (!path || !existsSync(path)) {
    console.error(`SETUP: fixture file not found: ${path ?? "(missing)"}`);
    process.exit(2);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`SETUP: fixture file is not valid JSON: ${e.message}`);
    process.exit(2);
  }
  organizations = Array.isArray(parsed) ? parsed : parsed.organizations ?? [];
  extras = Array.isArray(parsed) ? [] : parsed.reservedSlugsExtra ?? [];
  console.log(`MODE: fixtures (${path}) — no database was touched.`);
} else {
  if (!process.env.DATABASE_URL) {
    console.error("SETUP: DATABASE_URL is not set. Point it at the database to audit, or use --fixtures <file>.");
    process.exit(2);
  }
  if (!existsSync(dbDist)) {
    console.error("SETUP: packages/db/dist/index.js not found. Run `pnpm --filter @repo/db build` (and `generate`) first.");
    process.exit(2);
  }
  const { PrismaClient } = await import(dbDist);
  const prisma = new PrismaClient();
  try {
    organizations = await prisma.organization.findMany({
      select: { id: true, slug: true, name: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    const row = await prisma.systemSetting
      .findUnique({ where: { key: "reservedSlugsExtra" } })
      .catch(() => null);
    const raw = row?.value;
    extras = (Array.isArray(raw) ? raw : Array.isArray(raw?.slugs) ? raw.slugs : [])
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean);
  } finally {
    await prisma.$disconnect();
  }
  console.log("MODE: database (read-only).");
}

const conflicts = [];
for (const org of organizations) {
  const problem = classify(String(org.slug ?? ""), extras);
  if (problem) conflicts.push({ slug: org.slug, name: org.name ?? null, id: org.id ?? null, problem });
}

console.log(`Checked ${organizations.length} organization slug(s); ${extras.length} SUPER-added extra reserved name(s) applied.`);
if (conflicts.length === 0) {
  console.log("RESULT: no conflicts — every existing slug passes the TD1 rules.");
} else {
  console.log(`RESULT: ${conflicts.length} conflict(s) — these orgs' subdomains must stay disabled until the owner decides (nothing was renamed):`);
  for (const c of conflicts) console.log(`  - ${c.slug} (${c.problem})${c.name ? ` — ${c.name}` : ""}${c.id ? ` [${c.id}]` : ""}`);
  console.log(JSON.stringify({ conflicts }, null, 2));
}
