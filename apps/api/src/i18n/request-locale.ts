/**
 * ML10 (MB4, D-MB4-2) — request-locale resolution for API errors.
 *
 * Order (first hit wins):
 *   1. Public / shop routes → the shop's locale (StorefrontSetting
 *      .locale, NF5 `resolveShopLocale` pattern: an explicit
 *      supported `?locale=` shopper choice wins over the setting).
 *   2. Authenticated → `User.preferredLocale` (Prisma lookup by
 *      req.user.userId).
 *   3. A `:organizationId` route param → `Organization
 *      .dashboardLocale`.
 *   4. bn (platform default, ML-L6).
 *
 * The result is cached on the request object (`__apiLocale`) by
 * the LocaleInterceptor; the (synchronous) exception filter reads
 * the cache via `syncRequestLocale`. Every lookup is failure-
 * isolated: a DB hiccup degrades to the next step, never to a
 * failed request.
 */
import { resolveShopLocale } from "../translations/translations";
import { normalizeApiLocale, type ApiLocale } from "./render";

export const REQUEST_LOCALE_KEY = "__apiLocale";

type AnyReq = Record<string, any>;

function requestPath(req: AnyReq): string {
  const raw = String(req?.originalUrl ?? req?.url ?? "");
  return raw.split("?")[0];
}

export function isPublicRoute(req: AnyReq): boolean {
  return requestPath(req).startsWith("/public/");
}

/** The locale already resolved for this request, if any. */
export function syncRequestLocale(req: AnyReq): ApiLocale {
  const cached = req?.[REQUEST_LOCALE_KEY];
  if (cached === "en" || cached === "bn") return cached;
  // Guard-thrown errors happen before the interceptor runs; the
  // JWT payload does not carry a locale, but anything that did
  // attach one to req.user is honoured synchronously here.
  return normalizeApiLocale(req?.user?.preferredLocale);
}

async function shopLocaleForPublicRoute(prisma: any, req: AnyReq): Promise<ApiLocale | null> {
  const params = (req?.params ?? {}) as Record<string, string | undefined>;
  let organizationId: string | null = null;
  if (params.orgSlug) {
    const org = await prisma.organization
      ?.findFirst({ where: { slug: params.orgSlug }, select: { id: true } })
      .catch(() => null);
    organizationId = org?.id ?? null;
  } else if (params.slug) {
    const product = await prisma.product
      ?.findFirst({ where: { slug: params.slug }, select: { organizationId: true } })
      .catch(() => null);
    if (product?.organizationId) {
      organizationId = product.organizationId;
    } else {
      const landing = await prisma.landingPage
        ?.findFirst({ where: { slug: params.slug }, select: { organizationId: true } })
        .catch(() => null);
      organizationId = landing?.organizationId ?? null;
    }
  }
  if (!organizationId) return null;
  const setting = await prisma.storefrontSetting
    ?.findFirst({ where: { organizationId }, select: { locale: true } })
    .catch(() => null);
  const requested = (req?.query as Record<string, unknown> | undefined)?.locale;
  return normalizeApiLocale(resolveShopLocale(requested, setting?.locale ?? null));
}

export async function resolveRequestLocale(prisma: any, req: AnyReq): Promise<ApiLocale> {
  const cached = req?.[REQUEST_LOCALE_KEY];
  if (cached === "en" || cached === "bn") return cached;
  let resolved: ApiLocale = "bn";
  try {
    if (prisma && isPublicRoute(req)) {
      const shop = await shopLocaleForPublicRoute(prisma, req).catch(() => null);
      if (shop) resolved = shop;
    }
    if (resolved === "bn" && prisma) {
      // (If the shop locale resolved to bn we still let the
      // authenticated/org chain run only when this is NOT a
      // public route — shoppers are not staff.)
      if (!isPublicRoute(req)) {
        const userId = req?.user?.userId;
        if (userId) {
          const user = await prisma.user
            ?.findUnique({ where: { id: userId }, select: { preferredLocale: true } })
            .catch(() => null);
          if (user?.preferredLocale === "en" || user?.preferredLocale === "bn") {
            resolved = user.preferredLocale;
          }
        }
        if (resolved === "bn") {
          const organizationId = (req?.params as Record<string, string> | undefined)?.organizationId;
          if (organizationId) {
            const org = await prisma.organization
              ?.findUnique({ where: { id: organizationId }, select: { dashboardLocale: true } })
              .catch(() => null);
            if (org?.dashboardLocale === "en" || org?.dashboardLocale === "bn") {
              resolved = org.dashboardLocale;
            }
          }
        }
      }
    }
  } catch {
    resolved = "bn";
  }
  try {
    if (req && typeof req === "object") req[REQUEST_LOCALE_KEY] = resolved;
  } catch {
    /* a frozen request object must never break the request */
  }
  return resolved;
}
