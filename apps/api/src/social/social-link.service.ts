import { Injectable } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { REVENUE_EXCLUDED_STATUSES } from "../analytics/analytics.service";
import { notFound } from "../i18n/api-exception";

/**
 * SU6 — Social link tracking: UTM auto-build, tracked short link
 * (`/public/social/r/:token`) and per-post click → order
 * ASSOCIATION (never claimed as attribution — MS7's honest
 * language, reused verbatim in the stats response).
 *
 * Bot discipline: link-preview / crawler fetches (Meta, WhatsApp,
 * Telegram, Slack, Discord, generic bots) are NOT clicks — they
 * are never recorded, though the redirect itself still happens
 * (a preview fetch that 404s would break the platform's preview).
 * An EMPTY user-agent is counted as human: not every real browser
 * / in-app webview sends one, and dropping those clicks silently
 * would understate the tenant's own numbers (decision recorded
 * in the Batch 3 acceptance doc).
 */

const BOT_UA_RE = /bot|crawler|spider|preview|facebookexternalhit|whatsapp|telegram|slack|discord/i;

/** Pure: is this user-agent a bot / link-preview fetcher? */
export function isBotUserAgent(ua: string | null | undefined): boolean {
  if (!ua) return false;
  return BOT_UA_RE.test(ua);
}

/**
 * Pure: append UTM parameters to a URL. A parameter that is
 * already present is NEVER overwritten (the merchant's own
 * tracking wins — the MS6 pattern); only the missing ones are
 * added. An unparseable URL is returned unchanged.
 */
export function appendUtm(
  url: string,
  utm: { source: string; medium: string; campaign: string },
): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("utm_source")) parsed.searchParams.set("utm_source", utm.source);
    if (!parsed.searchParams.has("utm_medium")) parsed.searchParams.set("utm_medium", utm.medium);
    if (!parsed.searchParams.has("utm_campaign")) parsed.searchParams.set("utm_campaign", utm.campaign);
    return parsed.toString();
  } catch {
    return url;
  }
}

/** The API's public base for tracked URLs, or null when the
 * deployment has not configured one (callers then fall back to
 * the post's raw linkUrl — an honest, untracked link rather than
 * a broken localhost URL). */
export function apiPublicBase(): string | null {
  const raw = (process.env.API_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
  return raw ? raw : null;
}

@Injectable()
export class SocialLinkService {
  constructor(private readonly prisma: PrismaService) {}

  private p(): any {
    return this.prisma as any;
  }

  /**
   * The post's tracked-link token, minting and persisting one
   * when absent. Idempotent: an existing token is returned as-is.
   * A unique-token collision retries with a fresh token.
   */
  async ensureLinkToken(organizationId: string, post: any): Promise<string | null> {
    if (!post) return null;
    if (post.linkToken) return post.linkToken as string;
    if (!post.id) return null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = randomBytes(16).toString("base64url");
      try {
        await this.p().socialPost.update({
          where: { id: post.id },
          data: { linkToken: token },
        });
        post.linkToken = token;
        return token;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as any)?.code;
        if (code === "P2002" || /unique/i.test(msg)) continue;
        throw e;
      }
    }
    return null;
  }

  /**
   * The full tracked URL for a post (`<API_PUBLIC_URL>/public/
   * social/r/<token>`), or null when API_PUBLIC_URL is not
   * configured — the caller then uses the raw linkUrl.
   */
  async buildTrackedUrl(post: any, _account?: any): Promise<string | null> {
    const base = apiPublicBase();
    if (!base || !post) return null;
    const token = await this.ensureLinkToken(post.organizationId, post);
    if (!token) return null;
    return `${base}/public/social/r/${token}`;
  }

  /** The redirect target for a post: its linkUrl with UTM
   * (source = the account's platform, medium "social", campaign
   * = the post id). Null when the post carries no link. */
  private async redirectUrlFor(post: any): Promise<string | null> {
    if (!post?.linkUrl) return null;
    const account = await this.p().socialAccount
      ?.findFirst({ where: { id: post.socialAccountId, organizationId: post.organizationId } })
      .catch(() => null);
    const source = account?.platform || "social";
    return appendUtm(post.linkUrl, { source, medium: "social", campaign: post.id });
  }

  /**
   * Record one click on a tracked link and resolve the redirect.
   * Returns null when the token names no post (→ 404). Bot /
   * preview fetches get `{ counted: false }` and NO click row,
   * but still receive the redirect URL.
   */
  async recordClick(
    token: string,
    userAgent?: string | null,
  ): Promise<{ counted: boolean; url: string | null; post: any } | null> {
    if (!token) return null;
    const post = await this.p().socialPost.findFirst({ where: { linkToken: token } });
    if (!post) return null;
    const url = await this.redirectUrlFor(post);
    if (isBotUserAgent(userAgent)) {
      return { counted: false, url, post };
    }
    await this.p().socialLinkClick.create({
      data: {
        organizationId: post.organizationId,
        socialPostId: post.id,
        userAgent: userAgent ? String(userAgent).slice(0, 300) : null,
      },
    });
    return { counted: true, url, post };
  }

  /**
   * Per-post link stats: the recorded (human) click count, the
   * last click time, and the orders ASSOCIATED with the post —
   * an order counts only when a LAST_TOUCH AttributionCredit
   * names a touchpoint whose campaign is this post, AND the
   * order was placed within the org's socialLinkWindowDays
   * after at least one recorded click, AND its status is not a
   * revenue-excluded one. The label states plainly that this is
   * association, not attribution.
   */
  async getLinkStats(organizationId: string, postId: string) {
    const post = await this.p().socialPost.findFirst({
      where: { id: postId, organizationId },
    });
    if (!post) throw notFound("social.socialPostNotFoundInThis");

    const clickRows = (await this.p().socialLinkClick
      ?.findMany({ where: { organizationId, socialPostId: postId } })
      .catch(() => [])) ?? [];
    const clicks = Array.isArray(clickRows) ? clickRows : [];
    const clickTimes = clicks
      .map((c: any) => new Date(c.clickedAt).getTime())
      .filter((t: number) => Number.isFinite(t));
    const lastClickedAt = clickTimes.length
      ? new Date(Math.max(...clickTimes)).toISOString()
      : null;

    let ordersAssociated = 0;
    let revenue = 0n;

    // Association evidence exists only when someone actually
    // clicked — without a click there is nothing to associate.
    if (clicks.length > 0) {
      const org = await this.p().organization
        ?.findFirst({ where: { id: organizationId } })
        .catch(() => null);
      const windowDaysRaw = Number(org?.socialLinkWindowDays);
      const windowDays = Number.isInteger(windowDaysRaw) && windowDaysRaw > 0 ? windowDaysRaw : 7;
      const windowMs = windowDays * 86_400_000;

      const credits = (await this.p().attributionCredit
        ?.findMany({ where: { organizationId, model: "LAST_TOUCH" }, include: { touchpoint: true } })
        .catch(() => [])) ?? [];
      const orderIds = [
        ...new Set(
          (Array.isArray(credits) ? credits : [])
            .filter((c: any) => c.touchpoint && c.touchpoint.campaign === postId)
            .map((c: any) => c.orderId as string),
        ),
      ];
      if (orderIds.length > 0) {
        const orders = (await this.p().order
          ?.findMany({ where: { organizationId, id: { in: orderIds } } })
          .catch(() => [])) ?? [];
        for (const order of Array.isArray(orders) ? orders : []) {
          if (REVENUE_EXCLUDED_STATUSES.includes(order.status)) continue;
          const placed = order.placedAt ?? order.createdAt;
          if (!placed) continue;
          const t = new Date(placed).getTime();
          if (!Number.isFinite(t)) continue;
          const inWindow = clickTimes.some((ct) => t >= ct && t <= ct + windowMs);
          if (!inWindow) continue;
          ordersAssociated++;
          try {
            revenue += BigInt(order.totalMinor ?? 0);
          } catch {
            /* a malformed total contributes nothing */
          }
        }
      }
    }

    return {
      postId,
      clicks: clicks.length,
      lastClickedAt,
      ordersAssociated,
      revenueAssociatedMinor: revenue.toString(),
      associationNote: "association, attribution নয়",
    };
  }
}
