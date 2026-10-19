"use client";
// EB5/ED12 — breadcrumb for every /dashboard/commerce/** page, rendered
// once by the commerce layout. Labels come from the same nav data the
// sidebar renders (COMMERCE_NAV_ITEMS / NAV_ITEMS), so the trail can
// never drift from the navigation. Storefront sub-pages (blog/pages/
// search) get their own trailing crumb.
import { usePathname } from "next/navigation";
import { Breadcrumb } from "@repo/ui";
import { NAV_ITEMS, COMMERCE_NAV_ITEMS } from "@/lib/nav";
import { useLocale } from "@/lib/i18n/provider";

const LABEL_BY_HREF = new Map<string, string>(
  [...NAV_ITEMS, ...COMMERCE_NAV_ITEMS].map((i) => [i.href as string, i.label]),
);

// MB2 F3-β: nav items carry a `labelKey` into the shell dictionary;
// the dashboard layout resolves it the same way (`labelOf`), with
// the item's bn label as fallback. Keyed here by href so this map
// stays the single source for the page crumb.
const LABEL_KEY_BY_HREF = new Map<string, string>(
  [...NAV_ITEMS, ...COMMERCE_NAV_ITEMS].map((i) => [i.href as string, i.labelKey]),
);

export function CommerceBreadcrumb() {
  const { dict, t } = useLocale();
  const S = dict.shared;
  const SUBPAGE_LABELS: Record<string, string> = {
    blog: S.zzCbcBlog,
    pages: S.zzCbcPages,
    search: S.zzCbcSearch,
  };
  const pathname = usePathname();
  if (!pathname || pathname === "/dashboard/commerce") return null;
  // Longest nav href that prefixes the path is the page crumb.
  let pageHref = "";
  for (const href of LABEL_BY_HREF.keys()) {
    if (href.startsWith("/dashboard/commerce/") && (pathname === href || pathname.startsWith(`${href}/`)) && href.length > pageHref.length) {
      pageHref = href;
    }
  }
  const items: { label: string; href?: string }[] = [
    { label: dict.shell.dashboard, href: "/dashboard" },
    { label: S.zzCbcCommerce, href: "/dashboard/commerce" },
  ];
  if (pageHref) {
    const key = LABEL_KEY_BY_HREF.get(pageHref);
    items.push({ label: (key ? t(`shell.${key}`) : "") || LABEL_BY_HREF.get(pageHref) || pageHref });
    const rest = pathname.slice(pageHref.length).split("/").filter(Boolean);
    for (const seg of rest) {
      items.push({ label: SUBPAGE_LABELS[seg] ?? seg });
    }
  }
  return <Breadcrumb items={items} className="pt-1" />;
}
