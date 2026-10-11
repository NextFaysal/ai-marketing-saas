/**
 * Pure cohort / churn computations (M56).
 * Receives already-filtered revenue facts — no Nest, no prisma, no
 * imports from the analytics service.
 */

export interface RevenueOrderFact {
  customerId: string;
  at: Date;
  totalMinor: bigint;
}

export function monthKey(d: Date): string {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

function monthIndexOf(key: string): number {
  const [y, m] = key.split("-").map((v) => parseInt(v, 10));
  return y * 12 + (m - 1);
}

function monthKeyFromIndex(idx: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function monthDiff(fromKey: string, toKey: string): number {
  return monthIndexOf(toKey) - monthIndexOf(fromKey);
}

export const MAX_MONTH_INDEX = 11;

export function buildCohortReport(facts: RevenueOrderFact[]): {
  cohorts: {
    cohort: string;
    size: number;
    totalRevenueMinor: string;
    retentionPercent: (number | null)[];
    cumulativeLtvMinor: (string | null)[];
  }[];
  maxMonthIndex: number;
  totalCustomers: number;
} {
  if (!facts.length) {
    return { cohorts: [], maxMonthIndex: 0, totalCustomers: 0 };
  }

  // Group facts by customer.
  const byCustomer = new Map<string, RevenueOrderFact[]>();
  for (const f of facts) {
    const list = byCustomer.get(f.customerId) ?? [];
    list.push(f);
    byCustomer.set(f.customerId, list);
  }

  // Cohort per customer = month of earliest fact.
  const cohortOfCustomer = new Map<string, string>();
  let latestMonth: string | null = null;
  for (const f of facts) {
    const k = monthKey(f.at);
    if (latestMonth === null || k > latestMonth) latestMonth = k;
  }
  for (const [customerId, list] of byCustomer) {
    let earliest = list[0];
    for (const f of list) {
      if (f.at.getTime() < earliest.at.getTime()) earliest = f;
    }
    cohortOfCustomer.set(customerId, monthKey(earliest.at));
  }

  const cohortKeys = [...new Set(cohortOfCustomer.values())].sort();
  const earliestCohortOverall = cohortKeys[0];
  // latestMonth is non-null because facts is non-empty.
  const latest = latestMonth as string;
  const maxMonthIndex = Math.min(
    MAX_MONTH_INDEX,
    monthDiff(earliestCohortOverall, latest),
  );

  // Group customers by cohort.
  const customersByCohort = new Map<string, string[]>();
  for (const [customerId, cohort] of cohortOfCustomer) {
    const list = customersByCohort.get(cohort) ?? [];
    list.push(customerId);
    customersByCohort.set(cohort, list);
  }

  const cohorts = cohortKeys.map((cohort) => {
    const customerIds = customersByCohort.get(cohort) ?? [];
    const size = customerIds.length;
    const customerSet = new Set(customerIds);
    const cohortFacts = facts.filter((f) => customerSet.has(f.customerId));

    const totalRevenueMinor = cohortFacts
      .reduce((s, f) => s + f.totalMinor, 0n)
      .toString();

    const retentionPercent: (number | null)[] = [];
    const cumulativeLtvMinor: (string | null)[] = [];

    for (let m = 0; m <= maxMonthIndex; m++) {
      if (monthDiff(cohort, latest) < m) {
        retentionPercent.push(null);
        cumulativeLtvMinor.push(null);
        continue;
      }
      const targetKey = monthKeyFromIndex(monthIndexOf(cohort) + m);
      // Retention: customers with >=1 fact in target month.
      let retained = 0;
      for (const cid of customerIds) {
        const list = byCustomer.get(cid) ?? [];
        if (list.some((f) => monthKey(f.at) === targetKey)) retained++;
      }
      const pct = size ? (retained / size) * 100 : 0;
      retentionPercent.push(Math.round(pct * 10) / 10);

      // Cumulative LTV: sum of facts with monthIndex <= m, / size.
      let sum = 0n;
      for (const f of cohortFacts) {
        const idx = monthDiff(cohort, monthKey(f.at));
        if (idx <= m) sum += f.totalMinor;
      }
      const ltv = size ? sum / BigInt(size) : 0n;
      cumulativeLtvMinor.push(ltv.toString());
    }

    return { cohort, size, totalRevenueMinor, retentionPercent, cumulativeLtvMinor };
  });

  return { cohorts, maxMonthIndex, totalCustomers: byCustomer.size };
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export const CHURN_RULE_TEXT =
  "নিয়ম: শেষ কেনার পর কত দিন কেটেছে, তা তুলনা করা হয় কেনার স্বাভাবিক ব্যবধানের সঙ্গে — গ্রাহকের নিজের অন্তত ৩টি অর্ডার থাকলে তার নিজের অর্ডারগুলোর মাঝের ব্যবধানের মধ্যমা, না থাকলে পুরো দোকানের সব গ্রাহকের ব্যবধানের মধ্যমা। অনুপাত ১-এর কম = কম ঝুঁকি, ১ থেকে ২-এর কম = মাঝারি ঝুঁকি, ২ বা তার বেশি = বেশি ঝুঁকি। ব্যবধানের কোনো তথ্যই না থাকলে ফলাফল 'তথ্য নেই'। ব্যবধান হিসাব হয় পূর্ণ দিনে (একই দিনের পুনঃঅর্ডারে ব্যবধান ন্যূনতম ১ দিন)।";

export interface ChurnRow {
  customerId: string;
  orders: number;
  lastOrderAt: string;
  daysSinceLastOrder: number;
  referenceGapDays: number | null;
  referenceSource: "own" | "org" | null;
  ratio: number | null;
  band: "low" | "medium" | "high" | "unknown";
}

export function computeChurn(
  inputs: { customerId: string; dates: Date[] }[],
  now: Date,
): { orgMedianGapDays: number | null; rows: ChurnRow[] } {
  // Per-customer sorted dates and gaps.
  const prepared = inputs
    .filter((i) => i.dates.length > 0)
    .map((i) => {
      const sorted = [...i.dates].sort((a, b) => a.getTime() - b.getTime());
      const gaps: number[] = [];
      for (let k = 1; k < sorted.length; k++) {
        const ms = sorted[k].getTime() - sorted[k - 1].getTime();
        gaps.push(Math.max(1, Math.floor(ms / 86400000)));
      }
      return { customerId: i.customerId, sorted, gaps };
    });

  const orgPool: number[] = [];
  for (const p of prepared) orgPool.push(...p.gaps);
  const orgMedianGapDays = median(orgPool);

  const rows: ChurnRow[] = prepared.map((p) => {
    const orders = p.sorted.length;
    const lastDate = p.sorted[p.sorted.length - 1];
    const daysSinceLastOrder = Math.max(
      0,
      Math.floor((now.getTime() - lastDate.getTime()) / 86400000),
    );

    let referenceGapDays: number | null;
    let referenceSource: "own" | "org" | null;
    if (orders >= 3) {
      referenceGapDays = median(p.gaps);
      referenceSource = "own";
    } else {
      referenceGapDays = orgMedianGapDays;
      referenceSource = orgMedianGapDays === null ? null : "org";
    }

    let ratio: number | null = null;
    let band: ChurnRow["band"] = "unknown";
    if (referenceGapDays === null || referenceGapDays <= 0) {
      ratio = null;
      band = "unknown";
      // If reference came from own gaps but was null, keep source as set above?
      // Spec: reference null -> band unknown, ratio null. Source for >=3 with
      // null own median cannot happen (gaps >=2), but keep consistent:
      // if org source and median null, source is already null.
      if (orders >= 3 && referenceGapDays === null) {
        referenceSource = "own";
      }
    } else {
      ratio = Math.round((daysSinceLastOrder / referenceGapDays) * 100) / 100;
      band = ratio < 1 ? "low" : ratio < 2 ? "medium" : "high";
    }

    return {
      customerId: p.customerId,
      orders,
      lastOrderAt: lastDate.toISOString(),
      daysSinceLastOrder,
      referenceGapDays,
      referenceSource,
      ratio,
      band,
    };
  });

  return { orgMedianGapDays, rows };
}
