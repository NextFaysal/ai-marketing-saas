import { BadRequestException } from "@nestjs/common";
import { badRequest } from "../i18n";

/**
 * OU11 — the LEGAL GATE for payout automation.
 *
 * The platform wallet holds TENANT money (platform-gateway
 * payments accumulate in the tenant's wallet until payout). The
 * Connect Center program carries an OPEN item: a legal review
 * of holding tenant funds in the platform wallet. The approved
 * rule for this package is that payout AUTOMATION must not be
 * able to go live until that review exists — so the gate is
 * encoded here, in the service layer, not in any UI:
 *
 * - A SUPER admin records the review's completion in the
 *   PayoutLegalGate record (who confirmed, when, and the
 *   reference — reviewer / law firm / memo). Recording it is an
 *   operator act; this code RECORDS the confirmation, it does
 *   not replace the review itself.
 * - Automation additionally needs the separate explicit
 *   `automationEnabled` switch ON (default OFF). A recorded
 *   confirmation alone enables nothing.
 * - EVERY disbursement execution entry point (issuing a bank
 *   instruction, confirming an execution, for wallet payouts
 *   AND affiliate payouts) calls assertPayoutAutomationAllowed
 *   FIRST and refuses when the gate is not fully open.
 * - The gate is read from the DATABASE on every call — never
 *   from the platform-config snapshot. A legal gate must not
 *   ride a ~30s-stale cache: closing the gate stops the very
 *   next execution attempt.
 * - The existing MANUAL process (admin approve + admin
 *   mark-paid, the CC10/CC23 human chain) is NOT gated: it is
 *   a human paying out by hand, exactly the process that exists
 *   today, and it stays exactly as it is. The gate governs
 *   automation only.
 */

export interface PayoutLegalGateState {
  recorded: boolean;
  confirmedById: string | null;
  confirmedAt: Date | null;
  reference: string | null;
  note: string | null;
  automationEnabled: boolean;
  automationEnabledById: string | null;
  automationEnabledAt: Date | null;
  /** True only when a confirmation is recorded AND the
   * automation switch is on — the single predicate every
   * execution path checks. */
  automationAllowed: boolean;
}

export const PAYOUT_GATE_NO_CONFIRMATION_MSG =
  "Payout automation বন্ধ আছে: প্ল্যাটফর্ম ওয়ালেটে tenant-এর অর্থ রাখার LEGAL REVIEW এখনো রেকর্ড করা হয়নি। একজন SUPER admin আগে Admin Console-এ legal-review confirmation রেকর্ড না করা পর্যন্ত কোনো payout execution (instruction/confirm) চলবে না। Manual mark-paid (মানুষের হাতে করা প্রক্রিয়া) এই gate-এর বাইরে — তা আগের মতোই চলবে।";

export const PAYOUT_GATE_AUTOMATION_OFF_MSG =
  "Payout automation বন্ধ আছে: legal-review confirmation রেকর্ড থাকলেও automation switch OFF আছে। একজন SUPER admin Admin Console-এ payout automation স্পষ্টভাবে ON না করা পর্যন্ত কোনো payout execution চলবে না।";

/** Read the gate row (singleton, scope="platform") through any
 * prisma-like client. A missing table/row reads as NO gate —
 * fail closed, never open. */
export async function readPayoutLegalGate(client: any): Promise<any | null> {
  try {
    const row = await client?.payoutLegalGate?.findUnique?.({ where: { scope: "platform" } });
    return row ?? null;
  } catch {
    return null;
  }
}

export function payoutLegalGateState(row: any | null | undefined): PayoutLegalGateState {
  const recorded = Boolean(row?.legalConfirmedAt && row?.legalConfirmedById);
  const automationEnabled = recorded && row?.automationEnabled === true;
  return {
    recorded,
    confirmedById: row?.legalConfirmedById ?? null,
    confirmedAt: row?.legalConfirmedAt ?? null,
    reference: row?.legalReference ?? null,
    note: row?.legalNote ?? null,
    automationEnabled: row?.automationEnabled === true,
    automationEnabledById: row?.automationEnabledById ?? null,
    automationEnabledAt: row?.automationEnabledAt ?? null,
    automationAllowed: recorded && automationEnabled,
  };
}

/** THE enforcement point. Every disbursement execution entry
 * point calls this before creating or completing anything.
 * Throws BadRequestException naming the exact closed state:
 * (a) no legal confirmation recorded, or (b) confirmation
 * recorded but the automation switch is off. */
export async function assertPayoutAutomationAllowed(client: any): Promise<PayoutLegalGateState> {
  const state = payoutLegalGateState(await readPayoutLegalGate(client));
  if (!state.recorded) throw badRequest("connections.payoutGateNoConfirmation");
  if (!state.automationEnabled) throw badRequest("connections.payoutGateAutomationOff");
  return state;
}
