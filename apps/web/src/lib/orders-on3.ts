/**
 * ON3 (Orders Next): Order Surgery — pure helpers for the item
 * editor on the order detail panel (edit items with a server
 * preview, split, merge). Side-effect free, unit-testable.
 *
 * Money is minor-unit STRINGS everywhere (the API contract);
 * taka <-> minor conversion reuses lib/orders-on1 (takaToMinor /
 * minorToTaka) — never re-implemented here.
 *
 * OMISSION SEMANTICS (API contract): an existing order line that
 * is NOT present in the PATCH/preview items array is REMOVED by
 * the server. So the draft list IS the desired final list: a
 * removed draft line simply isn't sent, and every line that must
 * survive (gift lines included) must stay in the draft.
 */

export interface DraftLine {
  orderItemId?: string;
  productId?: string;
  variantId?: string;
  name: string;
  /** Minor-unit string. Staff edit it through a taka input in
   * the page (converted with orders-on1 helpers); a value that
   * is not a plain non-negative integer string is a validation
   * error, never silently repaired. */
  unitPriceMinor: string;
  /** UI-only: the raw taka text of the price input while staff
   * are typing (so "250." doesn't fight the minor conversion).
   * Never sent; validation reads unitPriceMinor only. */
  priceText?: string;
  quantity: number;
  isGift: boolean;
  bundleId?: string | null;
  bundleName?: string | null;
  kind: "line" | "bundle";
  /** Display-only: the line's current total (minor string) as
   * the server last reported it. Never sent back. */
  lineTotalMinor?: string;
  /** Bundle drafts only: the component lines grouped under the
   * bundle (display only — the group moves/edits as one). */
  components?: { name: string; quantity: number }[];
}

export interface EditItemsBodyEntry {
  orderItemId?: string;
  productId?: string;
  variantId?: string;
  quantity: number;
  unitPriceMinor?: string;
  bundleId?: string;
}
export interface EditItemsBody {
  items: EditItemsBodyEntry[];
  couponCode?: string | null;
  recalculateDelivery?: boolean;
}

export interface PreviewLine {
  key: string; name: string; quantity: number;
  unitPriceMinor: string; totalMinor: string;
  isGift: boolean; bundleId?: string | null;
}
export interface PreviewResult {
  lines: PreviewLine[];
  subtotalMinor: string;
  promotionDiscountMinor: string;
  promotionsApplied: { name: string; amountMinor: string }[];
  couponMinor: string;
  couponDropped: boolean;
  couponPinnedMinor: string;
  referralDiscountMinor: string;
  referralDropped: boolean;
  discountMinor: string;
  taxMinor: string;
  shippingMinor: string;
  totalMinor: string;
  warnings: string[];
}
export interface PatchItemsResult {
  order: unknown;
  couponDropped: boolean;
  couponPinnedMinor: string;
  referralDropped: boolean;
  warnings: string[];
  overpaidMinor: string;
  stockDelta: { adjusted: number; skipped: number };
}

/** The statuses in which the surgery toggle may show. The
 * server remains the authority — it refuses anything else with
 * a verbatim Bengali error, this only avoids offering a dead
 * action. Terminal statuses (completed / cancelled / refunded /
 * failed / returned) never offer surgery. */
export const SURGERY_STATUSES = ["pending", "on-hold", "processing"] as const;

/** Why surgery is (not) offered for an order. WooCommerce /
 * Shopify orders are refused client-side with a note (their
 * lines are owned by the store); the server would refuse too. */
export function surgeryAvailability(order: { status: string; source?: string | null }): { allowed: boolean; note?: string } {
  if (order.source === "woocommerce" || order.source === "shopify") {
    return { allowed: false, note: "স্টোরের অর্ডারের আইটেম এখান থেকে সম্পাদনা করা যায় না" };
  }
  if (!SURGERY_STATUSES.includes(order.status as (typeof SURGERY_STATUSES)[number])) {
    return { allowed: false, note: "এই অবস্থার অর্ডারে আইটেম সম্পাদনা করা যায় না" };
  }
  return { allowed: true };
}

/** Minimal item shape the drafts are built from (the getOne /
 * list order shape: unit price rides as `priceMinor`; a stray
 * `unitPriceMinor` is honoured too so a future serializer
 * rename doesn't blank every price). */
export interface OrderItemLike {
  id: string; name: string; quantity: number;
  priceMinor?: string | null; unitPriceMinor?: string | null;
  totalMinor?: string | null;
  productId?: string | null;
  isGift?: boolean; bundleId?: string | null; bundleName?: string | null;
}

/** Build the editor drafts from an order's items. Bundle
 * components collapse into ONE bundle draft (the group is
 * edited / removed / moved as a whole); every other line —
 * gift lines included — becomes its own draft so omission
 * semantics can never drop a line by accident. */
export function draftsFromOrderItems(items: OrderItemLike[]): DraftLine[] {
  const drafts: DraftLine[] = [];
  const bundleAt = new Map<string, number>();
  for (const it of items) {
    if (it.bundleId) {
      const at = bundleAt.get(it.bundleId);
      if (at !== undefined) {
        const d = drafts[at];
        d.components = [...(d.components ?? []), { name: it.name, quantity: it.quantity }];
        try {
          const t = BigInt(d.lineTotalMinor ?? "0") + BigInt(it.totalMinor ?? "0");
          d.lineTotalMinor = t.toString();
        } catch { /* keep the first component's total */ }
        continue;
      }
      bundleAt.set(it.bundleId, drafts.length);
      drafts.push({
        name: it.bundleName ?? "বান্ডল",
        quantity: it.quantity,
        unitPriceMinor: it.priceMinor ?? it.unitPriceMinor ?? "0",
        isGift: false,
        bundleId: it.bundleId,
        bundleName: it.bundleName ?? null,
        kind: "bundle",
        lineTotalMinor: it.totalMinor ?? undefined,
        components: [{ name: it.name, quantity: it.quantity }],
      });
      continue;
    }
    drafts.push({
      orderItemId: it.id,
      productId: it.productId ?? undefined,
      name: it.name,
      quantity: it.quantity,
      unitPriceMinor: it.priceMinor ?? it.unitPriceMinor ?? "0",
      isGift: !!it.isGift,
      bundleId: null,
      kind: "line",
      lineTotalMinor: it.totalMinor ?? undefined,
    });
  }
  return drafts;
}

const isNonNegativeIntString = (v: string) => /^\d+$/.test(v.trim());

/** Validate the draft list before a preview / save. Returns
 * Bengali error strings (empty = valid). Rules: at least one
 * non-gift line must remain, every quantity is an integer ≥ 1,
 * and every editable price is a non-negative integer minor
 * string. Gift lines skip the price check (their price is
 * locked at 0 and never sent). */
export function validateDraft(drafts: DraftLine[]): string[] {
  const errors: string[] = [];
  if (!drafts.some((d) => !d.isGift)) {
    errors.push("কমপক্ষে একটি (উপহার নয়) আইটেম থাকতে হবে — সব আইটেম সরিয়ে অর্ডার সংরক্ষণ করা যাবে না।");
  }
  for (const d of drafts) {
    if (!Number.isInteger(d.quantity) || d.quantity < 1) {
      errors.push(`"${d.name}"-এর পরিমাণ কমপক্ষে ১ হতে হবে (পূর্ণ সংখ্যা)।`);
    }
    if (d.kind === "line" && !d.isGift && !isNonNegativeIntString(d.unitPriceMinor)) {
      errors.push(`"${d.name}"-এর দাম ঠিকভাবে লিখুন (টাকায়, যেমন: 250 বা 250.50)।`);
    }
  }
  return errors;
}

/** Draft list -> the API EditItemsBody. Bundle drafts collapse
 * to ONE { bundleId, quantity } entry (the group quantity);
 * gift drafts keep their (locked) quantity and carry no price;
 * a line with neither orderItemId nor productId is a NEW line
 * (productId set by the product picker). Removed draft lines
 * are simply absent — that absence is what removes them
 * server-side. */
export function buildEditItemsBody(
  drafts: DraftLine[],
  opts: { couponCode?: string | null; recalculateDelivery?: boolean } = {},
): EditItemsBody {
  const items: EditItemsBodyEntry[] = [];
  for (const d of drafts) {
    if (d.kind === "bundle") {
      if (d.bundleId) items.push({ bundleId: d.bundleId, quantity: d.quantity });
      continue;
    }
    const entry: EditItemsBodyEntry = { quantity: d.quantity };
    if (d.orderItemId) entry.orderItemId = d.orderItemId;
    if (d.productId) entry.productId = d.productId;
    if (d.variantId) entry.variantId = d.variantId;
    if (!d.isGift && isNonNegativeIntString(d.unitPriceMinor)) {
      entry.unitPriceMinor = d.unitPriceMinor.trim();
    }
    items.push(entry);
  }
  const body: EditItemsBody = { items };
  if (opts.couponCode !== undefined) body.couponCode = opts.couponCode;
  if (opts.recalculateDelivery) body.recalculateDelivery = true;
  return body;
}

export interface SurgeryMoneyRow {
  key: string;
  label: string;
  /** Minor-unit string, always the unsigned amount; `negative`
   * marks discount rows the UI renders with a − sign. */
  amountMinor: string;
  negative?: boolean;
  note?: string;
  isTotal?: boolean;
}

const isZeroMinor = (v?: string | null) => {
  if (v == null) return true;
  try { return BigInt(v) === 0n; } catch { return v.trim() === "" || v.trim() === "0"; }
};
const isPositiveMinor = (v?: string | null) => {
  if (v == null) return false;
  try { return BigInt(v) > 0n; } catch { return false; }
};

/** PreviewResult -> the totals-panel display rows, in render
 * order: subtotal, one row per applied promotion, the coupon
 * row (with its dropped / pinned notes), the referral row,
 * delivery, tax, total. Discount rows whose amount is 0 and
 * which carry no state note are omitted — EXCEPT a dropped /
 * pinned coupon, which must be said out loud even at 0. */
export function surgeryMoneySummary(preview: PreviewResult): SurgeryMoneyRow[] {
  const rows: SurgeryMoneyRow[] = [
    { key: "subtotal", label: "সাবটোটাল", amountMinor: preview.subtotalMinor },
  ];
  (preview.promotionsApplied ?? []).forEach((p, i) => {
    rows.push({ key: `promo-${i}`, label: `প্রমোশন: ${p.name}`, amountMinor: p.amountMinor, negative: true });
  });
  const couponNote = preview.couponDropped
    ? "কুপন বাতিল হয়েছে"
    : isPositiveMinor(preview.couponPinnedMinor)
      ? "কুপন যাচাই ছাড়া রাখা হয়েছে"
      : undefined;
  if (!isZeroMinor(preview.couponMinor) || couponNote) {
    // A pinned coupon's amount IS the pinned figure — show it
    // even if the plain couponMinor comes back 0.
    const amount = isPositiveMinor(preview.couponPinnedMinor) ? preview.couponPinnedMinor : preview.couponMinor;
    rows.push({
      key: "coupon", label: "কুপন ছাড়", amountMinor: amount,
      negative: !isZeroMinor(amount),
      ...(couponNote ? { note: couponNote } : {}),
    });
  }
  if (!isZeroMinor(preview.referralDiscountMinor) || preview.referralDropped) {
    rows.push({
      key: "referral", label: "রেফারেল ছাড়", amountMinor: preview.referralDiscountMinor,
      negative: !isZeroMinor(preview.referralDiscountMinor),
      ...(preview.referralDropped ? { note: "রেফারেল ছাড় বাতিল হয়েছে" } : {}),
    });
  }
  // No breakdown rows at all but a discount exists: show the
  // plain total discount rather than hiding money.
  if (rows.length === 1 && !isZeroMinor(preview.discountMinor)) {
    rows.push({ key: "discount", label: "ছাড়", amountMinor: preview.discountMinor, negative: true });
  }
  rows.push({ key: "shipping", label: "ডেলিভারি চার্জ", amountMinor: preview.shippingMinor });
  if (!isZeroMinor(preview.taxMinor)) {
    rows.push({ key: "tax", label: "কর / VAT", amountMinor: preview.taxMinor });
  }
  rows.push({ key: "total", label: "মোট", amountMinor: preview.totalMinor, isTotal: true });
  return rows;
}
