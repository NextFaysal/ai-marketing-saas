import { parseBdAddress } from "./bd-address";
import { bdPhoneMatchKey, normalizeBdPhone } from "./phone-utils";
import { namesMateriallyDifferent } from "./fraud-score";

/**
 * ON11 — intake warnings for manual / chat order creation.
 * Warnings NEVER block creation: they are advisory labels the
 * staff UI shows next to the freshly created order, plus an
 * address suggestion when the parser is confident and no
 * district was supplied. Every check is failure-isolated in
 * spirit — the callers wrap the whole computation in try/catch
 * and ship an empty warning list on any failure.
 */

export interface IntakeWarning {
  key: string;
  label: string;
}

export interface IntakeResult {
  warnings: IntakeWarning[];
  addressSuggestion: { district: string; thana: string | null; confidence: string } | null;
}

export async function computeIntakeWarnings(
  prisma: any,
  blockedPhones: { isBlocked: (orgId: string, phone: unknown) => Promise<boolean> } | undefined | null,
  orgId: string,
  input: { phone?: string | null; name?: string | null; addressText?: string | null; customerDistrict?: string | null },
): Promise<IntakeResult> {
  const warnings: IntakeWarning[] = [];
  const phone = input.phone ?? null;

  if (phone && normalizeBdPhone(phone) === null) {
    warnings.push({ key: "invalid_phone", label: "ফোন নম্বরটি সঠিক বাংলাদেশি মোবাইল ফরম্যাটে নেই" });
  }

  if (phone && blockedPhones?.isBlocked) {
    const blocked = await blockedPhones.isBlocked(orgId, phone).catch(() => false);
    if (blocked) {
      warnings.push({
        key: "phone_blocked",
        label: "এই ফোন নম্বরটি ব্লকলিস্টে আছে — অর্ডারটি পর্যালোচনার জন্য আটকানো হবে",
      });
    }
  }

  // Phone-matched customer scan — loaded whenever a phone is
  // present (GB6: the blocked-record check needs it even when
  // no name was supplied), and reused by the duplicate-name
  // check below.
  let matchedCustomers: any[] = [];
  if (phone) {
    try {
      const key = bdPhoneMatchKey(phone);
      if (key && prisma?.customer?.findMany) {
        const customers: any[] = ((await prisma.customer.findMany({
          where: { organizationId: orgId },
          take: 5000,
        }).catch(() => [])) ?? []);
        matchedCustomers = customers.filter((c: any) => bdPhoneMatchKey(c.phone ?? null) === key);
      }
    } catch { matchedCustomers = []; /* advisory only */ }
  }

  // GB6 (GC15): a staff-blocked customer record on this phone.
  if (matchedCustomers.some((c: any) => c?.isBlocked === true)) {
    warnings.push({
      key: "customer_blocked",
      label: "এই গ্রাহককে ব্লক করা হয়েছে — অর্ডার দেওয়ার আগে যাচাই করুন",
    });
  }

  // Same phone under a materially different customer name.
  if (phone && input.name) {
    for (const c of matchedCustomers) {
      const storedName = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      if (storedName && namesMateriallyDifferent(storedName, input.name)) {
        warnings.push({
          key: "duplicate_customer_phone",
          label: `এই নম্বরে আগে অন্য নামে ("${storedName}") গ্রাহক আছেন`,
        });
        break;
      }
    }
  }

  const parsed = parseBdAddress(input.addressText ?? "");
  if (!input.customerDistrict && parsed.district === null) {
    warnings.push({
      key: "missing_address_parts",
      label: "ঠিকানা থেকে জেলা বোঝা যাচ্ছে না — জেলা নিশ্চিত করুন",
    });
  }

  const addressSuggestion =
    !input.customerDistrict && (parsed.confidence === "high" || parsed.confidence === "medium") && parsed.district
      ? { district: parsed.district, thana: parsed.thana, confidence: parsed.confidence }
      : null;

  return { warnings, addressSuggestion };
}
