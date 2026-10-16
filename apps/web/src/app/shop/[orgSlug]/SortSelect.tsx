"use client";
import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import type { ShopSort } from "@/lib/storefront-server";

export function SortSelect({
  orgSlug,
  locale = "bn",
  value,
  q = "",
  category = "",
  brand = "",
}: {
  orgSlug: string;
  locale?: ShopLocale | string;
  value: ShopSort;
  q?: string;
  category?: string;
  brand?: string;
}) {
  const t = shopT(locale);
  const router = useRouter();
  const pathname = usePathname();
  const options: { value: ShopSort; label: string }[] = [
    { value: "featured", label: t.sort.featured },
    { value: "newest", label: t.sort.newest },
    { value: "price_asc", label: t.sort.priceAsc },
    { value: "price_desc", label: t.sort.priceDesc },
    { value: "best_selling", label: t.sort.bestSelling },
    { value: "name_asc", label: t.sort.nameAsc },
  ];
  return (
    <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
      <span>{t.sort.label}</span>
      <select
        value={value}
        onChange={(e) => {
          const sort = e.target.value;
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (category) params.set("category", category);
          if (brand) params.set("brand", brand);
          if (sort && sort !== "featured") params.set("sort", sort);
          // dropping page: sorting returns to page 1
          const qs = params.toString();
          router.push(`${pathname ?? `/shop/${orgSlug}`}${qs ? `?${qs}` : ""}`);
        }}
        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 focus:border-indigo-600 focus:outline-none"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
