/**
 * Milestone 50 — COD Fraud / Return Risk Score (deterministic).
 *
 * The score is computed ONLY from the organization's OWN order history
 * for the same phone number. It NEVER blocks, holds or alters an
 * order — it only warns the merchant and may SUGGEST asking for the
 * delivery charge in advance. A phone with no decided history is
 * "unknown" (তথ্য নেই) — never "low".
 *
 * Outcome classification uses the real vocabularies in this codebase:
 * - Order.status is the raw WooCommerce status (pending, processing,
 *   on-hold, completed, cancelled, refunded, failed) plus chat orders
 *   (pending).
 * - CourierShipment.status is the shared courier vocabulary
 *   (in_review, pending, in_transit, delivered, partial_delivered,
 *   cancelled, returned — see courier clients' status mappers).
 */

export type RiskBand = "low" | "medium" | "high" | "unknown";

export interface OrderOutcomeInput {
  status: string;
  isCod?: boolean;
  shipmentStatuses?: string[];
}

export interface PhoneHistory {
  total: number;
  delivered: number;
  returned: number;
  cancelledOrFailed: number;
  refunded: number;
  open: number;
  codOrders: number;
}

export interface RiskAssessment {
  band: RiskBand;
  /** 0..100, higher = riskier. null when the band is unknown. */
  score: number | null;
  history: PhoneHistory;
  decided: number;
  negativeRate: number | null;
  reasons: string[];
  suggestion: string | null;
}

/** Same phone matching the codebase already uses (inbox + leads):
 * digits only, compare on the last 10 digits. */
export function phoneKey(phone?: string | null): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.slice(-10);
}

type Outcome = "delivered" | "returned" | "cancelledOrFailed" | "refunded" | "open";

/** One order's final outcome. Negative signals win over delivered
 * (a returned parcel is a return even if a store status lags), and a
 * shipment return is the strongest return signal we actually record. */
export function classifyOutcome(o: OrderOutcomeInput): Outcome {
  const shipments = (o.shipmentStatuses ?? []).map((s) => String(s).toLowerCase());
  if (shipments.includes("returned")) return "returned";
  const status = String(o.status ?? "").toLowerCase();
  if (status === "cancelled" || status === "failed") return "cancelledOrFailed";
  if (status === "refunded") return "refunded";
  if (status === "completed" || status === "delivered" || shipments.includes("delivered") || shipments.includes("partial_delivered")) return "delivered";
  return "open";
}

export function summarizeHistory(orders: OrderOutcomeInput[]): PhoneHistory {
  const h: PhoneHistory = { total: orders.length, delivered: 0, returned: 0, cancelledOrFailed: 0, refunded: 0, open: 0, codOrders: 0 };
  for (const o of orders) {
    h[classifyOutcome(o)]++;
    if (o.isCod) h.codOrders++;
  }
  return h;
}

const SUGGEST_HIGH = "পরামর্শ: এই অর্ডারে ডেলিভারি চার্জ অগ্রিম নেওয়ার কথা ভাবতে পারেন। স্কোরটি শুধু সতর্কতা — অর্ডারটি আটকানো হয়নি।";
const SUGGEST_MEDIUM = "পরামর্শ: প্রয়োজনে গ্রাহককে ফোনে যাচাই করে ডেলিভারি চার্জ অগ্রিম চাইতে পারেন। স্কোরটি শুধু সতর্কতা — অর্ডারটি আটকানো হয়নি।";

/**
 * Pure scorer. `priorOrders` must EXCLUDE the order being assessed.
 * `sameAddressAsDelivered` is true only on an exact normalized address
 * match with a previously DELIVERED order — location is reported as a
 * reason only; it never adds risk points in v1.
 */
export function scoreRisk(priorOrders: OrderOutcomeInput[], opts?: { targetIsCod?: boolean; sameAddressAsDelivered?: boolean }): RiskAssessment {
  const history = summarizeHistory(priorOrders);
  const decided = history.delivered + history.returned + history.cancelledOrFailed + history.refunded;
  const negatives = history.returned + history.cancelledOrFailed + history.refunded;
  const reasons: string[] = [];

  if (history.total === 0) {
    reasons.push("এই ফোন নম্বরে আগের কোনো অর্ডারের ইতিহাস পাওয়া যায়নি — তথ্য নেই, তাই ঝুঁকি বলা যাচ্ছে না।");
    return { band: "unknown", score: null, history, decided, negativeRate: null, reasons, suggestion: null };
  }
  reasons.push(`এই ফোনে আগের ${history.total}টি অর্ডার: ডেলিভারি হয়েছে ${history.delivered}টি, রিটার্ন ${history.returned}টি, বাতিল/ব্যর্থ ${history.cancelledOrFailed}টি, রিফান্ড ${history.refunded}টি, এখনো চলমান ${history.open}টি।`);
  if (history.codOrders > 0) reasons.push(`আগের অর্ডারগুলোর মধ্যে ${history.codOrders}টি ছিল ক্যাশ অন ডেলিভারি (COD)।`);

  if (decided === 0) {
    reasons.push("আগের অর্ডারগুলোর কোনোটিরই চূড়ান্ত ফলাফল (ডেলিভারি/রিটার্ন/বাতিল) এখনো জানা যায়নি — তথ্য অপর্যাপ্ত, তাই ঝুঁকি বলা যাচ্ছে না।");
    return { band: "unknown", score: null, history, decided, negativeRate: null, reasons, suggestion: null };
  }

  const negativeRate = negatives / decided;
  const score = Math.round(negativeRate * 100);
  const thin = decided < 3;
  if (thin) reasons.push(`সতর্কতা: মাত্র ${decided}টি অর্ডারের চূড়ান্ত ফলাফলের ওপর ভিত্তি করে স্কোর — প্রমাণ খুবই কম, নিজে যাচাই করে সিদ্ধান্ত নিন।`);
  if (history.returned > 0) reasons.push(`আগের ${history.returned}টি অর্ডার কুরিয়ার থেকে রিটার্ন এসেছে — এটাই সবচেয়ে শক্তিশালী ঝুঁকির signal।`);
  if (history.delivered > 0 && negatives === 0) reasons.push(`আগের সব (${history.delivered}টি) চূড়ান্ত অর্ডারই সফলভাবে ডেলিভারি হয়েছে।`);
  if (opts?.sameAddressAsDelivered) reasons.push("এই অর্ডারের ঠিকানা আগের একটি ডেলিভারি-হওয়া অর্ডারের ঠিকানার সাথে হুবহু মিলেছে (ঠিকানা শুধু তথ্য হিসেবে দেখানো হলো — স্কোরে এর কোনো প্রভাব নেই)।");

  let band: RiskBand;
  if (thin) {
    band = negativeRate >= 1 ? "high" : negativeRate > 0 ? "medium" : "low";
  } else {
    band = negativeRate >= 0.5 ? "high" : negativeRate >= 0.25 ? "medium" : "low";
  }
  if (band === "low") reasons.push("আগের ইতিহাস অনুযায়ী রিটার্ন/বাতিলের হার কম।");
  if (band === "medium") reasons.push(`চূড়ান্ত অর্ডারগুলোর মধ্যে ${Math.round(negativeRate * 100)}% রিটার্ন/বাতিল/রিফান্ড হয়েছে — মাঝারি ঝুঁকি।`);
  if (band === "high") reasons.push(`চূড়ান্ত অর্ডারগুলোর মধ্যে ${Math.round(negativeRate * 100)}% রিটার্ন/বাতিল/রিফান্ড হয়েছে — উচ্চ ঝুঁকি।`);

  return {
    band, score, history, decided, negativeRate,
    reasons,
    suggestion: band === "high" ? SUGGEST_HIGH : band === "medium" ? SUGGEST_MEDIUM : null,
  };
}
