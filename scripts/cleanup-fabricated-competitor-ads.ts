/**
 * Cleanup: delete CompetitorAd rows that the pre-HF1 multi-platform
 * scanner FABRICATED and persisted as if they were real ads.
 *
 * Synthetic signatures (these id namespaces were only ever produced by
 * the fabricating scanners — real Meta Ad Library archive ids are
 * numeric):
 * - TikTok:  externalAdId starts with "tiktok_" (scanTikTokAds invented
 *   the copy, hashtags and a random start date; it made no network call)
 * - Bing:    externalAdId starts with "bing_" (scanBingAds invented the
 *   copy and a fixed start date; it made no network call)
 * - Google fallback: externalAdId starts with "google_" AND raw carries
 *   `competitorName` with NO `title` — that shape was only produced by
 *   the deleted `fallbackGoogleAd`, pushed whenever the real fetch
 *   failed. (Rows the real DuckDuckGo fetch returned carry title +
 *   snippet in raw and are NOT deleted by this script; since HF1 they
 *   are labeled organic search results, not ads.)
 *
 * Usage (run from the repo root, against YOUR deployment database —
 * this script is intentionally NOT run from the build sandbox):
 *   DATABASE_URL=... pnpm --filter @repo/db exec tsx \
 *     ../../scripts/cleanup-fabricated-competitor-ads.ts          # dry-run
 *   DATABASE_URL=... pnpm --filter @repo/db exec tsx \
 *     ../../scripts/cleanup-fabricated-competitor-ads.ts --apply  # delete
 *
 * Dry-run is the default: it only reports what WOULD be deleted.
 * Idempotent: a second --apply run finds nothing left to delete.
 */
import { createRequire } from "node:module";

export interface FabricatedAdCandidate {
  id: string;
  externalAdId: string;
  raw: unknown;
}

/** Pure classifier — a row is a fabrication only if it matches a
 *  synthetic signature above. Anything else is kept. */
export function fabricatedReason(row: FabricatedAdCandidate): string | null {
  const raw = (row.raw ?? null) as Record<string, unknown> | null;
  if (row.externalAdId.startsWith("tiktok_")) {
    return "tiktok synthetic (fabricated by scanTikTokAds, no network call)";
  }
  if (row.externalAdId.startsWith("bing_")) {
    return "bing synthetic (fabricated by scanBingAds, no network call)";
  }
  if (
    row.externalAdId.startsWith("google_") &&
    raw !== null &&
    typeof raw === "object" &&
    "competitorName" in raw &&
    !("title" in raw)
  ) {
    return "google fallback (fabricated by fallbackGoogleAd after a failed fetch)";
  }
  return null;
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.includes("--help")) {
    console.log("Usage: cleanup-fabricated-competitor-ads.ts [--apply]  (default: dry-run)");
    return;
  }

  // Resolve @prisma/client through packages/db so the script works from
  // the repo-root scripts/ folder (same pattern as packages/db seeds).
  const requireFromDb = createRequire(new URL("../packages/db/package.json", import.meta.url));
  const { PrismaClient } = requireFromDb("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const candidates: FabricatedAdCandidate[] = await prisma.competitorAd.findMany({
      where: {
        OR: [
          { externalAdId: { startsWith: "tiktok_" } },
          { externalAdId: { startsWith: "bing_" } },
          { externalAdId: { startsWith: "google_" } },
        ],
      },
      select: { id: true, externalAdId: true, raw: true },
    });

    const fabricated = candidates
      .map((row) => ({ row, reason: fabricatedReason(row) }))
      .filter((x): x is { row: FabricatedAdCandidate; reason: string } => x.reason !== null);

    console.log(`Scanned ${candidates.length} candidate row(s); ${fabricated.length} match a synthetic signature.`);
    const byReason = new Map<string, number>();
    for (const f of fabricated) byReason.set(f.reason, (byReason.get(f.reason) ?? 0) + 1);
    for (const [reason, count] of byReason) console.log(`  - ${reason}: ${count}`);
    for (const f of fabricated.slice(0, 10)) {
      console.log(`    e.g. id=${f.row.id} externalAdId=${f.row.externalAdId}`);
    }

    if (!apply) {
      console.log("DRY-RUN: nothing deleted. Re-run with --apply to delete these rows.");
      return;
    }

    const ids = fabricated.map((f) => f.row.id);
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500);
      const res = await prisma.competitorAd.deleteMany({ where: { id: { in: batch } } });
      deleted += res.count;
    }
    console.log(`APPLIED: deleted ${deleted} fabricated CompetitorAd row(s).`);
  } finally {
    await prisma.$disconnect();
  }
}

// Run only when executed directly (importing the classifier is inert).
if (process.argv[1]?.endsWith("cleanup-fabricated-competitor-ads.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
