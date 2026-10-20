import { ForbiddenException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { decryptJson } from "../integrations/crypto";
import { verifyTotp } from "../common/totp";
import { forbidden } from "../i18n";

/**
 * CC23 (Connect Center Next) — TOTP step-up for sensitive
 * tenant actions (gateway delete/disable, own-app-config
 * delete, payout-request create).
 *
 * The check reuses the M35 enrolment state and verifier
 * VERBATIM: the acting user's User row (totpEnabled +
 * totpSecretEncrypted, written by the auth module's enrol /
 * confirm flow) and common/totp's verifyTotp (the same
 * function the login challenge uses). Nothing here reimplements
 * TOTP, and no second secret store exists.
 *
 * Semantics, honestly:
 * - User HAS TOTP enabled → a valid `totpCode` is REQUIRED.
 *   Missing or invalid = Bengali 403 and the caller changes
 *   nothing (the check runs before any mutation).
 * - User has NOT enabled TOTP → the action proceeds, but the
 *   result is marked `not_enabled` so the caller surfaces a
 *   `stepUpUnavailable` note in its response — the UI nudges
 *   enrolment instead of pretending a step-up happened.
 */
export type StepUpOutcome = "verified" | "not_enabled";

@Injectable()
export class StepUpService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly verify: typeof verifyTotp = verifyTotp,
  ) {}

  async check(userId: string, totpCode?: string | null): Promise<StepUpOutcome> {
    const delegate = (this.prisma as any).user;
    if (!delegate?.findUnique) return "not_enabled";
    const user = await delegate.findUnique({
      where: { id: userId },
    }).catch(() => null);
    if (!user?.totpEnabled || !user?.totpSecretEncrypted) return "not_enabled";
    const code = String(totpCode ?? "").trim();
    if (!code) {
      throw forbidden("connections.stepUpTotpRequired");
    }
    let secret: string | null = null;
    try {
      secret = (decryptJson(user.totpSecretEncrypted) as { secret?: string })?.secret ?? null;
    } catch { secret = null; }
    if (!secret || !this.verify(secret, code)) {
      throw forbidden("connections.stepUpTotpWrong");
    }
    return "verified";
  }
}

/** Response marker the web layer turns into the enrolment
 * nudge: present (true) exactly when the acting user has no
 * TOTP enrolment, so the UI can say the step-up was NOT
 * performed rather than silently implying it was. */
export function stepUpMarker(outcome: StepUpOutcome): { stepUpUnavailable?: true } {
  return outcome === "not_enabled" ? { stepUpUnavailable: true } : {};
}
