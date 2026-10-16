import { Module } from "@nestjs/common";
import { BlockedPhoneService } from "./blocked-phone.service";
import { IdentifierListsService } from "./identifier-lists.service";
import { FraudAttemptLogService } from "./fraud-attempt-log.service";
import { TurnstileVerifier } from "./turnstile.service";
import { CheckoutGuardService } from "./checkout-guard.service";
import { FraudRulesService } from "./fraud-rules.service";
import { IdempotencyService } from "./idempotency.service";

/**
 * ON4 — FraudModule imports NOTHING: PrismaService and
 * AuditService are both @Global, so the blocklist service is
 * available to Orders / Inbox / checkout modules without any
 * import cycle.
 *
 * GB3 (GC9): the module stays a leaf on the same terms — the
 * identifier lists, attempt log, Turnstile verifier, checkout
 * guard and fraud-rules services depend only on the globals
 * (plus pure helpers), so checkout modules can import this
 * module without a cycle.
 */
@Module({
  providers: [
    BlockedPhoneService,
    IdentifierListsService,
    FraudAttemptLogService,
    TurnstileVerifier,
    CheckoutGuardService,
    FraudRulesService,
    IdempotencyService,
  ],
  exports: [
    BlockedPhoneService,
    IdentifierListsService,
    FraudAttemptLogService,
    TurnstileVerifier,
    CheckoutGuardService,
    FraudRulesService,
    IdempotencyService,
  ],
})
export class FraudModule {}
