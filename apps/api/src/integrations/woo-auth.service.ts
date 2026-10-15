import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { IntegrationsService } from "./integrations.service";

/**
 * EC12: WooCommerce wc-auth 1-click connect.
 *
 * Flow:
 *  1. Staff calls startAuthorizeUrl() → we persist a WcAuthAttempt
 *     and hand back the store's /wc-auth/v1/authorize URL.
 *  2. The merchant approves inside WooCommerce.
 *  3. Woo POSTs the generated consumer key/secret to our public
 *     callback (see woo-auth.controller.ts), which delegates to
 *     handleCallback() here.
 *  4. handleCallback() verifies the attempt and then connects via
 *     the SHARED IntegrationsService.connectWooCommerce path, so
 *     verify-before-save, encrypted credential storage and webhook
 *     registration behave exactly like the key-paste flow.
 *
 * Attempt binding (see also the WcAuthAttempt model comment):
 * Woo's authorize endpoint takes `user_id` and echoes it back in
 * the callback POST as `user_id`; we set user_id = attempt.id, so
 * that id IS the binding. Verification contract: attempt exists
 * (by user_id), is still pending (not consumed/failed), is not
 * expired, and the store's current URL still matches the
 * storeUrl snapshot taken at start. A random `state` token is
 * also stored and appended to the return_url only — Woo does not
 * round-trip arbitrary state params reliably, so `state` is never
 * relied on for verification.
 */
@Injectable()
export class WooAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly integrations: IntegrationsService,
  ) {}

  async startAuthorizeUrl(orgId: string, actorId: string, dto: { storeId: string }) {
    // The 1-click flow is impossible without a public API address:
    // Woo must be able to POST the generated keys back to us.
    const apiBase = process.env.API_PUBLIC_URL?.replace(/\/+$/, "");
    if (!apiBase) {
      throw new BadRequestException(
        "১-ক্লিক কানেক্টের জন্য API_PUBLIC_URL (API-র পাবলিক ঠিকানা) সেট করা নেই — the 1-click WooCommerce flow needs API_PUBLIC_URL (public API address) configured so WooCommerce can send the generated keys back.",
      );
    }
    const store = await (this.prisma as any).store.findFirst({ where: { id: dto.storeId, organizationId: orgId } });
    if (!store) throw new NotFoundException("Store not found in this organization");
    if (store.platform !== "WOOCOMMERCE") {
      throw new BadRequestException("WooCommerce wc-auth is only available for WooCommerce stores");
    }

    const state = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
    const attempt = await (this.prisma as any).wcAuthAttempt.create({
      data: {
        organizationId: orgId,
        userId: actorId,
        storeId: store.id,
        storeUrl: store.url,
        state,
        status: "pending",
        expiresAt,
      },
    });

    const storeBase = String(store.url).replace(/\/+$/, "");
    // return_url: where Woo sends the merchant's BROWSER after
    // approval. Env choice: WEB_PUBLIC_URL (the dashboard's public
    // address) first, then APP_PUBLIC_URL, then the API base as a
    // last resort. The random state rides along on the return_url
    // only (see the binding note above — never verified).
    const webBase = (process.env.WEB_PUBLIC_URL ?? process.env.APP_PUBLIC_URL ?? apiBase).replace(/\/+$/, "");
    const returnUrl = `${webBase}/dashboard/integrations?state=${state}`;
    const callbackUrl = `${apiBase}/integrations/woo/wc-auth/callback`;
    const appName = process.env.WC_AUTH_APP_NAME ?? "AI Marketing SaaS";
    const authorizeUrl =
      `${storeBase}/wc-auth/v1/authorize?app_name=${encodeURIComponent(appName)}` +
      `&scope=read_write&user_id=${encodeURIComponent(attempt.id)}` +
      `&return_url=${encodeURIComponent(returnUrl)}` +
      `&callback_url=${encodeURIComponent(callbackUrl)}`;

    await this.audit.log({
      organizationId: orgId, userId: actorId, action: "integration.wc_auth_started",
      entityType: "WcAuthAttempt", entityId: attempt.id,
      metadata: { provider: "woocommerce", storeId: store.id },
    });
    return { authorizeUrl, attemptId: attempt.id, expiresAt };
  }

  async handleCallback(payload: { key_id?: unknown; user_id?: unknown; consumer_key?: unknown; consumer_secret?: unknown; key_permissions?: unknown }) {
    if (!payload?.user_id || typeof payload.user_id !== "string") {
      throw new BadRequestException("Unknown wc-auth attempt");
    }
    const attempt = await (this.prisma as any).wcAuthAttempt.findFirst({ where: { id: payload.user_id } });
    if (!attempt) throw new BadRequestException("Unknown wc-auth attempt");

    // Replay / reuse is refused outright: an attempt is single-use.
    if (attempt.status === "consumed") throw new BadRequestException("This wc-auth attempt has already been used");
    if (attempt.status === "failed") {
      throw new BadRequestException(`This wc-auth attempt has already failed${attempt.failureReason ? `: ${attempt.failureReason}` : ""}`);
    }
    if (new Date(attempt.expiresAt).getTime() < Date.now()) {
      await this.markFailed(attempt.id, "expired");
      throw new BadRequestException("This wc-auth attempt has expired");
    }

    const consumerKey = typeof payload.consumer_key === "string" ? payload.consumer_key : "";
    const consumerSecret = typeof payload.consumer_secret === "string" ? payload.consumer_secret : "";
    if (!consumerKey || !consumerSecret) {
      await this.markFailed(attempt.id, "missing_consumer_credentials");
      throw new BadRequestException("WooCommerce callback did not include consumer_key/consumer_secret");
    }

    // Strict permissions: the flow requested read_write (catalog /
    // order write-back needs it). Anything else cannot do the job,
    // so it fails the attempt instead of connecting half-capable.
    if (payload.key_permissions !== undefined && payload.key_permissions !== null && payload.key_permissions !== "read_write") {
      const reason = `unexpected_key_permissions:${String(payload.key_permissions)}`;
      await this.markFailed(attempt.id, reason);
      throw new BadRequestException(`WooCommerce returned unexpected key permissions: ${String(payload.key_permissions)}`);
    }

    const store = await (this.prisma as any).store.findFirst({
      where: { id: attempt.storeId, organizationId: attempt.organizationId },
    });
    const normalize = (u: unknown) => String(u ?? "").replace(/\/+$/, "");
    if (!store || normalize(store.url) !== normalize(attempt.storeUrl)) {
      await this.markFailed(attempt.id, "store_mismatch");
      throw new BadRequestException("Store no longer matches the wc-auth attempt");
    }

    let result: any;
    try {
      // Shared existing path: verify-before-save (a failed test
      // saves nothing), encrypted credentials, webhook registration.
      result = await this.integrations.connectWooCommerce(attempt.organizationId, attempt.userId, {
        storeId: attempt.storeId, consumerKey, consumerSecret,
      } as any);
    } catch (e) {
      const message = e instanceof Error ? e.message : "WooCommerce connection failed";
      await this.markFailed(attempt.id, message);
      throw new BadRequestException(message);
    }

    await (this.prisma as any).wcAuthAttempt.update({
      where: { id: attempt.id }, data: { status: "consumed", consumedAt: new Date() },
    });
    return { connected: true, integrationId: result.id, webhookRegistration: result.webhookRegistration };
  }

  private async markFailed(attemptId: string, failureReason: string) {
    await (this.prisma as any).wcAuthAttempt.update({
      where: { id: attemptId }, data: { status: "failed", failureReason },
    });
  }
}
