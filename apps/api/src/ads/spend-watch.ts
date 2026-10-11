import { formatMinor } from "@repo/contracts";
import { dhakaDayKey } from "../crm/lead-followups";

/**
 * AD4 — account-level spend-watch computation. ONE implementation,
 * used by both the `ad_spend_watchdog` job and
 * `GET ad-accounts/:id/spend-watch`, so the UI and the alerts can
 * never drift apart.
 *
 * Honest rules (mirrored from the org pacing code's discipline):
 * - Only CAMPAIGN-level DailyAdMetric rows count (adExternalId === "");
 *   ad-level rows would double count.
 * - Only rows in the account's OWN currency count — currencies are
 *   never mixed (there is no FX conversion anywhere in the product).
 * - "Today" is the Asia/Dhaka calendar day; today's row is PARTIAL
 *   (syncs land through the day) and is always labelled as such.
 * - The average is over the trailing 7 COMPLETE Dhaka days before
 *   today. A day counts toward the basis only if the account already
 *   existed that day (its creation Dhaka day <= that day); days with
 *   no synced data inside the basis count as 0 spend. The number of
 *   days actually used is returned (avgDaysUsed) and stated in every
 *   alert — the basis is never hidden.
 * - Anomaly uses exact BigInt cross-multiplication:
 *     todaySpend × avgDaysUsed × 100 >= trailingSum × (100 + pct)
 *   so there is no float rounding at the boundary. It can only fire
 *   when there is at least one complete day AND the trailing sum > 0.
 * - The cap fires when todaySpend >= dailyCapMinor.
 * This is ALERTING ONLY — nothing here pauses or stops anything.
 */

export interface SpendWatchComputation {
  accountId: string;
  currency: string;
  enabled: boolean;
  /** Alert threshold in minor units (string — BigInt-safe JSON). */
  dailyCapMinor: string | null;
  anomalyPct: number | null;
  /** Today's spend so far (partial day), minor units as string. */
  todaySpendMinor: string;
  /** Trailing complete-day average (floor division), minor units. */
  avgDailySpendMinor: string;
  /** Complete days actually in the average basis (0..7). */
  avgDaysUsed: number;
  /** Bengali sentence stating the basis honestly. */
  avgBasis: string;
  capCrossed: boolean;
  anomalyTriggered: boolean;
  /** Display threshold for the anomaly (avg × (1+pct/100), rounded). */
  anomalyThresholdMinor: string | null;
  /** Pre-formatted display strings (account currency). */
  todaySpendFormatted: string;
  avgDailySpendFormatted: string;
  dailyCapFormatted: string | null;
  anomalyThresholdFormatted: string | null;
}

const DAY_MS = 86_400_000;

function dayDateUtc(dayKey: string): Date {
  return new Date(`${dayKey}T00:00:00.000Z`);
}

export async function computeSpendWatch(
  prisma: { dailyAdMetric: { findMany: (args: any) => Promise<any[]> } },
  account: {
    id: string;
    organizationId: string;
    currency: string;
    createdAt: Date | string;
    spendWatchEnabled?: boolean | null;
    dailyCapMinor?: bigint | number | string | null;
    anomalyPct?: number | null;
  },
  now: Date = new Date(),
): Promise<SpendWatchComputation> {
  const todayKey = dhakaDayKey(now);
  const todayDate = dayDateUtc(todayKey);
  const windowStart = new Date(todayDate.getTime() - 7 * DAY_MS);
  const createdKey = dhakaDayKey(new Date(account.createdAt));
  const createdDate = dayDateUtc(createdKey);

  const rows = await prisma.dailyAdMetric.findMany({
    where: {
      organizationId: account.organizationId,
      adAccountId: account.id,
      date: { gte: windowStart, lte: todayDate },
    },
    take: 20_000,
  });

  let todaySpend = 0n;
  const completeDaySpend = new Map<number, bigint>(); // day offset 1..7 -> spend
  for (const row of rows as any[]) {
    // Campaign-level rows only, and only the account's own currency.
    if ((row.adExternalId ?? "") !== "") continue;
    if (row.currency !== account.currency) continue;
    const rowTime = new Date(row.date).getTime();
    const spend = typeof row.spendMinor === "bigint" ? row.spendMinor : BigInt(row.spendMinor ?? 0);
    if (rowTime === todayDate.getTime()) {
      todaySpend += spend;
    } else {
      const offset = Math.round((todayDate.getTime() - rowTime) / DAY_MS);
      if (offset >= 1 && offset <= 7) {
        completeDaySpend.set(offset, (completeDaySpend.get(offset) ?? 0n) + spend);
      }
    }
  }

  // Basis: complete days on/after the account's creation Dhaka day.
  let trailingSum = 0n;
  let avgDaysUsed = 0;
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = new Date(todayDate.getTime() - offset * DAY_MS);
    if (day.getTime() < createdDate.getTime()) continue; // account did not exist yet
    avgDaysUsed += 1;
    trailingSum += completeDaySpend.get(offset) ?? 0n; // no data that day = 0 spend
  }

  const avgDaily = avgDaysUsed > 0 ? trailingSum / BigInt(avgDaysUsed) : 0n;
  const cap = account.dailyCapMinor == null ? null : BigInt(account.dailyCapMinor as any);
  const pct = account.anomalyPct ?? null;

  const capCrossed = cap != null && todaySpend >= cap;
  const anomalyTriggered =
    pct != null &&
    avgDaysUsed > 0 &&
    trailingSum > 0n &&
    todaySpend * BigInt(avgDaysUsed) * 100n >= trailingSum * BigInt(100 + pct);

  // Display threshold (rounded to the nearest minor unit); the trigger
  // itself uses the exact cross-multiplication above.
  const thresholdMinor =
    pct != null && avgDaysUsed > 0
      ? (Number(trailingSum) / avgDaysUsed) * ((100 + pct) / 100)
      : null;

  const bnDigits = (n: number) => String(n).replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]);
  const avgBasis =
    avgDaysUsed === 7
      ? "গত ৭টি সম্পূর্ণ দিনের গড়"
      : avgDaysUsed > 0
        ? `শেষ ${bnDigits(avgDaysUsed)}টি সম্পূর্ণ দিনের গড় (Account তৈরি হওয়ার পর থেকে — পুরো ৭ দিনের ইতিহাস এখনো নেই)`
        : "কোনো সম্পূর্ণ দিনের ইতিহাস এখনো নেই";

  const fmt = (v: bigint) => formatMinor(v, account.currency);
  return {
    accountId: account.id,
    currency: account.currency,
    enabled: Boolean(account.spendWatchEnabled),
    dailyCapMinor: cap == null ? null : cap.toString(),
    anomalyPct: pct,
    todaySpendMinor: todaySpend.toString(),
    avgDailySpendMinor: avgDaily.toString(),
    avgDaysUsed,
    avgBasis,
    capCrossed,
    anomalyTriggered,
    anomalyThresholdMinor: thresholdMinor == null ? null : String(Math.round(thresholdMinor)),
    todaySpendFormatted: fmt(todaySpend),
    avgDailySpendFormatted: fmt(avgDaily),
    dailyCapFormatted: cap == null ? null : fmt(cap),
    anomalyThresholdFormatted:
      thresholdMinor == null ? null : formatMinor(BigInt(Math.round(thresholdMinor)), account.currency),
  };
}
