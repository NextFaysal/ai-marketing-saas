/**
 * Design Round 2 (§5): relative time in Bengali digits for
 * the campaign surfaces — "এইমাত্র", "৫ মিনিট আগে",
 * "২ ঘণ্টা আগে", "৩ দিন আগে"; a week or older falls back
 * to the absolute bn-BD date. Callers keep the absolute
 * datetime in a title attribute, so no information is lost.
 * Pure and clock-injectable for tests.
 */
export function relTimeBn(
  iso: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diffSec = Math.floor((now.getTime() - t) / 1000);
  if (diffSec < 60) return "এইমাত্র";
  const bn = (n: number) => n.toLocaleString("bn-BD");
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${bn(min)} মিনিট আগে`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${bn(hrs)} ঘণ্টা আগে`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${bn(days)} দিন আগে`;
  return new Date(t).toLocaleDateString("bn-BD");
}
