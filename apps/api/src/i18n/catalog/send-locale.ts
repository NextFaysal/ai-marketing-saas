/**
 * MB4 (W-3) — send-path / generation-path locale helpers.
 *
 * This is the NON-REQUEST resolver variant the MB4 task calls
 * for: notifications render at SEND time and documents at
 * GENERATION time, where no HTTP request (and therefore no
 * W-1 request-locale resolver) exists. It reads the W-3 catalog
 * namespaces (notifications / documents / messaging / finance)
 * directly and is deliberately self-contained so the send and
 * document paths do not depend on the request pipeline; the
 * coordinator may fold it into the i18n core later.
 *
 * Rules (ML-L6 + D-MB4-2/6/7):
 * - unknown / unset locale → bn (platform default);
 * - CustomerMemory.languagePref "mixed" → bn;
 * - missing catalog key → bn text + a missing-key log line;
 * - params use the API convention {{name}} (D-MB4-10); a param
 *   with no value renders as "" (never invented).
 */
import { NOTIFICATIONS_CATALOG } from "./notifications";
import { DOCUMENTS_CATALOG } from "./documents";
import { MESSAGING_CATALOG } from "./messaging";
import { FINANCE_CATALOG } from "./finance";
import { MESSAGE_CATALOG } from "./index";

export type ApiLocale = "bn" | "en";
export interface CatalogEntry {
  bn: string;
  en: string;
}

const MERGED: Record<string, CatalogEntry> = {
  // Coordinator fold (MB4 finishing pass): the full MESSAGE_CATALOG
  // is the base layer so send/document-path rendering can use ANY
  // catalog namespace (e.g. campaigns.*), not only the four W-3
  // namespaces below; those keep precedence on any key collision
  // (the coordinator verified there are none). catalog/index does
  // not import this module, so there is no import cycle.
  ...(MESSAGE_CATALOG as unknown as Record<string, CatalogEntry>),
  ...(NOTIFICATIONS_CATALOG as unknown as Record<string, CatalogEntry>),
  ...(DOCUMENTS_CATALOG as unknown as Record<string, CatalogEntry>),
  ...(MESSAGING_CATALOG as unknown as Record<string, CatalogEntry>),
  ...(FINANCE_CATALOG as unknown as Record<string, CatalogEntry>),
};

/** "en" → en; EVERYTHING else (bn, mixed, null, garbage) → bn. */
export function normalizeApiLocale(value: unknown): ApiLocale {
  return value === "en" ? "en" : "bn";
}

const PARAM_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

export function renderCatalogEntry(
  entry: CatalogEntry | undefined,
  key: string,
  locale: ApiLocale,
  params?: Record<string, unknown>,
): string {
  if (!entry) {
    // ML-L6 honesty: never hide an untranslated string — log it.
    console.warn(`[i18n] missing catalog key: ${key}`);
    return key;
  }
  const raw = entry[locale] ?? entry.bn;
  if (typeof raw !== "string") return entry.bn;
  return raw.replace(PARAM_RE, (_m, name: string) => {
    const v = params?.[name];
    return v === undefined || v === null ? "" : String(v);
  });
}

/** Render any W-3 catalog key in the given locale. */
export function catalogText(key: string, locale: ApiLocale, params?: Record<string, unknown>): string {
  return renderCatalogEntry(MERGED[key], key, locale, params);
}

/**
 * Service-layer rendering (CD-1): an exception's `.message`
 * is the catalog text in bn, the platform default / source
 * locale; the global filter re-renders into the request
 * locale from code+params where an ApiException carries them.
 */
export function catalogTextBn(key: string, params?: Record<string, unknown>): string {
  return catalogText(key, "bn", params);
}

/** Document header sets are stored in the catalog as one
 * string with "|" separators (one key per header row). */
export function catalogList(key: string, locale: ApiLocale, params?: Record<string, unknown>): string[] {
  return catalogText(key, locale, params).split("|");
}

// ---------------- recipient / document locale resolvers ----------------

type PrismaLike = any;

async function orgDashboardLocale(prisma: PrismaLike, organizationId?: string | null): Promise<ApiLocale> {
  if (!prisma || !organizationId) return "bn";
  try {
    const table = prisma.organization;
    if (!table) return "bn";
    const row = table.findFirst
      ? await table.findFirst({ where: { id: organizationId } }).catch(() => null)
      : table.findUnique
        ? await table.findUnique({ where: { id: organizationId } }).catch(() => null)
        : null;
    return normalizeApiLocale(row?.dashboardLocale);
  } catch {
    return "bn";
  }
}

/** Merchant/staff recipient: User.preferredLocale → org → bn. */
export async function resolveStaffLocale(
  prisma: PrismaLike,
  userId?: string | null,
  organizationId?: string | null,
): Promise<ApiLocale> {
  if (prisma && userId) {
    try {
      const table = prisma.user;
      const row = table?.findUnique
        ? await table.findUnique({ where: { id: userId } }).catch(() => null)
        : table?.findFirst
          ? await table.findFirst({ where: { id: userId } }).catch(() => null)
          : null;
      if (row?.preferredLocale === "en" || row?.preferredLocale === "bn") {
        return row.preferredLocale as ApiLocale;
      }
    } catch { /* fall through to the org default */ }
  }
  return orgDashboardLocale(prisma, organizationId);
}

/** The document locale for org-generated documents (D-MB4-6). */
export async function resolveDocumentLocale(prisma: PrismaLike, organizationId?: string | null): Promise<ApiLocale> {
  return orgDashboardLocale(prisma, organizationId);
}

function customerKeyOf(conv: any): string | null {
  if (!conv || conv.isPractice) return null;
  const channel = String(conv.channel ?? "").trim();
  const external = String(conv.externalContactId ?? "").trim();
  if (!channel || !external) return null;
  return `${channel}:${external}`;
}

/**
 * Customer recipient: CustomerMemory.languagePref (bn|en;
 * "mixed" → bn, D-MB4-7) → org dashboardLocale → bn.
 * Memory is keyed by channel:externalContactId, so the key is
 * derived from the customer's conversations (the
 * customer-memory.service convention). Any lookup failure
 * degrades to the next level — a locale lookup must never
 * break a send.
 */
export async function resolveCustomerLocale(
  prisma: PrismaLike,
  organizationId: string,
  opts: { customerId?: string | null; conversationId?: string | null } = {},
): Promise<ApiLocale> {
  try {
    const keys = new Set<string>();
    const convTable = prisma?.channelConversation;
    if (opts.conversationId && convTable?.findFirst) {
      const conv = await convTable
        .findFirst({ where: { id: opts.conversationId, organizationId } })
        .catch(() => null);
      const k = customerKeyOf(conv);
      if (k) keys.add(k);
    }
    if (!keys.size && opts.customerId && convTable?.findMany) {
      const convs = await convTable
        .findMany({ where: { organizationId, customerId: opts.customerId }, take: 10 })
        .catch(() => []);
      for (const c of convs ?? []) {
        const k = customerKeyOf(c);
        if (k) keys.add(k);
      }
    }
    const memTable = prisma?.customerMemory;
    if (keys.size && memTable) {
      let row: any = null;
      if (memTable.findFirst) {
        row = await memTable
          .findFirst({ where: { organizationId, customerKey: { in: [...keys] } } })
          .catch(() => null);
      }
      if (!row && memTable.findUnique) {
        for (const k of keys) {
          row = await memTable
            .findUnique({ where: { organizationId_customerKey: { organizationId, customerKey: k } } })
            .catch(() => null);
          if (row) break;
        }
      }
      if (row?.languagePref) return normalizeApiLocale(row.languagePref);
    }
  } catch { /* fall through to the org default */ }
  return orgDashboardLocale(prisma, organizationId);
}
