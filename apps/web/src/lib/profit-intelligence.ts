/**
 * Profit Intelligence, Unit Economics, and Waterfall Calculations.
 */

export interface ProfitWaterfall {
  grossRevenue: bigint;
  refunded: bigint;
  netRevenue: bigint;
  cogs: bigint;
  grossProfit: bigint;
  adSpend: bigint;
  contributionProfit: bigint;
  contributionMarginPercent: number | null;
  isProfitable: boolean;
}

export interface UnitEconomics {
  ordersCount: number;
  averageOrderValue: bigint;
  profitPerOrder: bigint;
  adSpendPerOrder: bigint;
  returnLossRatePercent: number | null;
  adSpendRatioPercent: number | null;
  cogsRatioPercent: number | null;
}

export function computeProfitWaterfall(profit: {
  revenueMinor: string;
  refundedMinor: string;
  cogsMinor: string;
  adSpendMinor: string;
  contributionProfitMinor: string;
  contributionMarginPercent: number | null;
}): ProfitWaterfall {
  const grossRevenue = BigInt(profit.revenueMinor || "0");
  const refunded = BigInt(profit.refundedMinor || "0");
  const netRevenue = grossRevenue - refunded;
  const cogs = BigInt(profit.cogsMinor || "0");
  const grossProfit = netRevenue - cogs;
  const adSpend = BigInt(profit.adSpendMinor || "0");
  const contributionProfit = BigInt(profit.contributionProfitMinor || "0");
  const isProfitable = contributionProfit > 0n;

  return {
    grossRevenue,
    refunded,
    netRevenue,
    cogs,
    grossProfit,
    adSpend,
    contributionProfit,
    contributionMarginPercent: profit.contributionMarginPercent,
    isProfitable,
  };
}

export function computeUnitEconomics(
  waterfall: ProfitWaterfall,
  ordersCount: number
): UnitEconomics {
  const count = ordersCount > 0 ? BigInt(ordersCount) : 1n;
  const averageOrderValue = waterfall.grossRevenue / count;
  const profitPerOrder = waterfall.contributionProfit / count;
  const adSpendPerOrder = waterfall.adSpend / count;

  const returnLossRatePercent =
    waterfall.grossRevenue > 0n
      ? Math.round(
          (Number(waterfall.refunded) / Number(waterfall.grossRevenue)) * 1000
        ) / 10
      : null;

  const adSpendRatioPercent =
    waterfall.grossRevenue > 0n
      ? Math.round(
          (Number(waterfall.adSpend) / Number(waterfall.grossRevenue)) * 1000
        ) / 10
      : null;

  const cogsRatioPercent =
    waterfall.grossRevenue > 0n
      ? Math.round(
          (Number(waterfall.cogs) / Number(waterfall.grossRevenue)) * 1000
        ) / 10
      : null;

  return {
    ordersCount,
    averageOrderValue,
    profitPerOrder,
    adSpendPerOrder,
    returnLossRatePercent,
    adSpendRatioPercent,
    cogsRatioPercent,
  };
}

export type DatePresetKey = "today" | "last7" | "last30" | "thisMonth" | "lastMonth";

export function getDateRangePreset(key: DatePresetKey): { from: string; to: string; label: string } {
  const now = new Date();
  const format = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (key === "today") {
    const dStr = format(now);
    return { from: dStr, to: dStr, label: "আজকে (Today)" };
  }

  if (key === "last7") {
    const from = new Date(Date.now() - 6 * 86400000);
    return { from: format(from), to: format(now), label: "গত ৭ দিন (7D)" };
  }

  if (key === "last30") {
    const from = new Date(Date.now() - 29 * 86400000);
    return { from: format(from), to: format(now), label: "গত ৩০ দিন (30D)" };
  }

  if (key === "thisMonth") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    return { from: format(from), to: format(now), label: "চলতি মাস (This Month)" };
  }

  // lastMonth
  const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
  return {
    from: format(firstDayLastMonth),
    to: format(lastDayLastMonth),
    label: "গত মাস (Last Month)",
  };
}
