export interface DailyPoint {
  date: string;
  orders: number;
  revenueMinor: bigint;
  spendMinor: bigint;
}

export interface Anomaly {
  type: "spend_spike" | "orders_drop" | "revenue_drop" | "cpa_spike" | "spend_no_sales" | "tracking_gap";
  severity: "warning" | "critical";
  message: string;
  evidence: { current: string; baseline: string; changePercent: number | null };
}

export interface AnomalyConfig {
  spendSpikePercent?: number;   // default +50
  dropPercent?: number;         // default -40 for orders/revenue
  cpaSpikePercent?: number;     // default +50
  minBaselineOrders?: number;   // default 5: below this, rate anomalies are skipped
  baselineDays?: number;        // default 7
}

const avg = (nums: number[]) => (nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0);
const pctChange = (current: number, baseline: number): number | null =>
  baseline === 0 ? null : Math.round(((current - baseline) / baseline) * 10000) / 100;

/**
 * Compares the most recent day against the average of the previous
 * `baselineDays` days. Sample-size guard: when the baseline has too few
 * orders, order/revenue/CPA anomalies are skipped entirely instead of
 * producing confident-sounding noise from tiny numbers. A separate
 * "insufficient data" note is returned by the caller, not an anomaly.
 */
export function detectAnomalies(series: DailyPoint[], config: AnomalyConfig = {}): { anomalies: Anomaly[]; sufficientData: boolean } {
  const cfg = {
    spendSpikePercent: config.spendSpikePercent ?? 50,
    dropPercent: config.dropPercent ?? -40,
    cpaSpikePercent: config.cpaSpikePercent ?? 50,
    minBaselineOrders: config.minBaselineOrders ?? 5,
    baselineDays: config.baselineDays ?? 7,
  };
  if (series.length < 2) return { anomalies: [], sufficientData: false };
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const current = sorted[sorted.length - 1];
  const baseline = sorted.slice(Math.max(0, sorted.length - 1 - cfg.baselineDays), sorted.length - 1);
  if (baseline.length === 0) return { anomalies: [], sufficientData: false };

  const baseOrders = avg(baseline.map((d) => d.orders));
  const baseRevenue = avg(baseline.map((d) => Number(d.revenueMinor)));
  const baseSpend = avg(baseline.map((d) => Number(d.spendMinor)));
  const curRevenue = Number(current.revenueMinor);
  const curSpend = Number(current.spendMinor);
  const sufficientData = baseOrders * baseline.length >= cfg.minBaselineOrders;
  const anomalies: Anomaly[] = [];

  const spendChange = pctChange(curSpend, baseSpend);
  if (baseSpend > 0 && spendChange !== null && spendChange >= cfg.spendSpikePercent) {
    anomalies.push({
      type: "spend_spike", severity: spendChange >= 100 ? "critical" : "warning",
      message: `Ad spend jumped ${spendChange}% versus the ${baseline.length}-day average.`,
      evidence: { current: String(current.spendMinor), baseline: String(Math.round(baseSpend)), changePercent: spendChange },
    });
  }

  if (sufficientData) {
    const ordersChange = pctChange(current.orders, baseOrders);
    if (ordersChange !== null && ordersChange <= cfg.dropPercent) {
      anomalies.push({
        type: "orders_drop", severity: "warning",
        message: `Orders fell ${Math.abs(ordersChange)}% versus the ${baseline.length}-day average.`,
        evidence: { current: String(current.orders), baseline: String(Math.round(baseOrders * 100) / 100), changePercent: ordersChange },
      });
    }
    const revenueChange = pctChange(curRevenue, baseRevenue);
    if (revenueChange !== null && revenueChange <= cfg.dropPercent) {
      anomalies.push({
        type: "revenue_drop", severity: "warning",
        message: `Revenue fell ${Math.abs(revenueChange)}% versus the ${baseline.length}-day average.`,
        evidence: { current: String(current.revenueMinor), baseline: String(Math.round(baseRevenue)), changePercent: revenueChange },
      });
    }
    // CPA proxy: spend per order. Only when both periods have orders.
    const baseCpa = baseOrders > 0 ? baseSpend / baseOrders : null;
    const curCpa = current.orders > 0 ? curSpend / current.orders : null;
    if (baseCpa !== null && curCpa !== null) {
      const cpaChange = pctChange(curCpa, baseCpa);
      if (cpaChange !== null && cpaChange >= cfg.cpaSpikePercent) {
        anomalies.push({
          type: "cpa_spike", severity: "warning",
          message: `Cost per order rose ${cpaChange}% versus baseline.`,
          evidence: { current: String(Math.round(curCpa)), baseline: String(Math.round(baseCpa)), changePercent: cpaChange },
        });
      }
    }
  }

  if (curSpend > 0 && current.orders === 0 && sufficientData) {
    anomalies.push({
      type: "spend_no_sales", severity: "critical",
      message: "Money was spent on ads today but no orders were recorded. Check tracking and campaign delivery.",
      evidence: { current: String(current.spendMinor), baseline: String(Math.round(baseSpend)), changePercent: spendChange },
    });
  }

  return { anomalies, sufficientData };
}
