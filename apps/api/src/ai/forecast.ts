/**
 * AP4 deterministic forecasting — pure functions over a real daily
 * revenue series. No ML, no invented numbers: the method is a named,
 * inspectable blend (trailing-14-day mean + least-squares trend over
 * 28 days), every output is labelled with the method, the band is a
 * fixed ±15% around the projection, and thin data REFUSES instead
 * of guessing (fewer than 14 days with orders → an honest
 * insufficient-data result). Scenario runs restate the user's
 * growth assumption explicitly and keep the baseline beside it.
 */

export interface DailyRevenuePoint { date: string; revenueMinor: number }

export interface ForecastDay { date: string; projectedMinor: number; lowMinor: number; highMinor: number }

export type ForecastResult =
  | {
      available: true;
      method: string;
      basedOnDays: number;
      horizonDays: number;
      dailyBaselineMinor: number;
      trendPctPerDay: number;
      scenarioGrowthPct: number | null;
      totalProjectedMinor: number;
      totalLowMinor: number;
      totalHighMinor: number;
      days: ForecastDay[];
      assumptions: string[];
    }
  | { available: false; reason: string; basedOnDays: number };

export const FORECAST_METHOD =
  "Deterministic blend: trailing-14-day mean revenue blended 50/50 with a least-squares linear trend fitted on up to 28 days; band = ±15%.";

const MIN_DAYS = 14;
const BAND = 0.15;

function isoPlus(baseIso: string, days: number): string {
  const d = new Date(`${baseIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Least-squares slope (per day) of the series, as a fraction of the mean. */
function trendFraction(points: DailyRevenuePoint[]): number {
  const n = points.length;
  if (n < 2) return 0;
  const mean = points.reduce((s, p) => s + p.revenueMinor, 0) / n;
  if (mean <= 0) return 0;
  const xMean = (n - 1) / 2;
  let num = 0;
  let den = 0;
  points.forEach((p, i) => {
    num += (i - xMean) * (p.revenueMinor - mean);
    den += (i - xMean) ** 2;
  });
  if (den === 0) return 0;
  const slopePerDay = num / den;
  // Clamp the trend so one spike cannot explode the projection.
  return Math.max(-0.05, Math.min(0.05, slopePerDay / mean));
}

export function forecastRevenue(
  series: DailyRevenuePoint[],
  horizonDays: number,
  scenarioGrowthPct?: number,
): ForecastResult {
  const points = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const withOrders = points.filter((p) => p.revenueMinor > 0).length;
  if (points.length < MIN_DAYS || withOrders < 7) {
    return {
      available: false,
      reason: `পূর্বাভাসের জন্য অন্তত ${MIN_DAYS} দিনের বিক্রির ডেটা লাগে (পাওয়া গেছে ${points.length} দিন, যার মধ্যে বিক্রি হয়েছে ${withOrders} দিনে) — ডেটা কম থাকলে অনুমান বানানো হয় না।`,
      basedOnDays: points.length,
    };
  }
  const trailing = points.slice(-14);
  const trailingMean = trailing.reduce((s, p) => s + p.revenueMinor, 0) / trailing.length;
  const trend = trendFraction(points.slice(-28));
  const scenarioFactor = scenarioGrowthPct !== undefined ? 1 + scenarioGrowthPct / 100 : 1;

  const days: ForecastDay[] = [];
  let total = 0;
  let totalLow = 0;
  let totalHigh = 0;
  const lastDate = points[points.length - 1].date;
  for (let i = 1; i <= horizonDays; i++) {
    const trendValue = trailingMean * (1 + trend * i);
    const blended = 0.5 * trailingMean + 0.5 * Math.max(0, trendValue);
    const projected = Math.max(0, Math.round(blended * scenarioFactor));
    const low = Math.round(projected * (1 - BAND));
    const high = Math.round(projected * (1 + BAND));
    days.push({ date: isoPlus(lastDate, i), projectedMinor: projected, lowMinor: low, highMinor: high });
    total += projected;
    totalLow += low;
    totalHigh += high;
  }
  return {
    available: true,
    method: FORECAST_METHOD,
    basedOnDays: points.length,
    horizonDays,
    dailyBaselineMinor: Math.round(trailingMean),
    trendPctPerDay: Math.round(trend * 10_000) / 100,
    scenarioGrowthPct: scenarioGrowthPct ?? null,
    totalProjectedMinor: total,
    totalLowMinor: totalLow,
    totalHighMinor: totalHigh,
    days,
    assumptions: [
      "Recent daily revenue pattern continues; no seasonality or campaign effect is modelled.",
      `Band is a fixed ±${Math.round(BAND * 100)}% around the projection — it is a planning range, not a guarantee.`,
      ...(scenarioGrowthPct !== undefined
        ? [`What-if scenario: every projected day is scaled by ${scenarioGrowthPct}% versus the baseline above.`]
        : []),
    ],
  };
}
