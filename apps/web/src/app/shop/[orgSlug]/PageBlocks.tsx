import React from "react";
import type { ShopPageBlock } from "@/lib/storefront-server";
import { shopT } from "@/lib/shop-i18n";
import { MediaImage } from "@/components/MediaImage";
import { ContactForm } from "./p/[pageSlug]/ContactForm";
import { PageFaq } from "./p/[pageSlug]/PageFaq";

/**
 * AB6 (AX12): shared shop block renderer — extracted from the
 * content-page route (p/[pageSlug]) so blog posts render blocks
 * with exactly the same markup/behaviour as content pages.
 */

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
function strOrNull(v: unknown): string | null {
  const s = str(v).trim();
  return s ? s : null;
}

export function PageBlockView({ block, orgSlug, locale }: { block: ShopPageBlock; orgSlug: string; locale: string }) {
  const t = shopT(locale);
  const d = block.data ?? {};
  switch (block.type) {
    case "heading": {
      const level = Number(d.level ?? 2);
      const text = str(d.text);
      if (!text) return null;
      if (level === 1) return <h1 className="text-3xl font-black text-slate-900">{text}</h1>;
      if (level === 3) return <h3 className="text-lg font-bold text-slate-900">{text}</h3>;
      return <h2 className="text-2xl font-black text-slate-900">{text}</h2>;
    }
    case "paragraph": {
      const text = str(d.text);
      return text ? <p className="whitespace-pre-line text-sm leading-relaxed text-slate-600">{text}</p> : null;
    }
    case "list": {
      const items = Array.isArray(d.items) ? d.items.map((i) => str(i)).filter(Boolean) : [];
      return items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-600">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : null;
    }
    case "image": {
      const url = strOrNull(d.url);
      return url ? (
        <MediaImage src={url} alt={str(d.alt)} width={1280} height={720} aspectRatio="16/9" sizes="(max-width: 768px) 100vw, 768px" className="w-full rounded-2xl border border-slate-200 object-cover" />
      ) : null;
    }
    case "faq": {
      const items = Array.isArray(d.items)
        ? (d.items as Record<string, unknown>[]).map((i) => ({ q: str(i?.q), a: str(i?.a) })).filter((i) => i.q || i.a)
        : [];
      return <PageFaq items={items} />;
    }
    case "contact_info": {
      const phone = strOrNull(d.phone);
      const email = strOrNull(d.email);
      const address = strOrNull(d.address);
      return (
        <section className="space-y-4">
          <div className="space-y-2 rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-lg font-black text-slate-900">{t.pages.contactTitle}</h2>
            <p className="text-sm text-slate-600">{t.pages.contactIntro}</p>
            {phone ? (
              <p className="text-sm text-slate-600">
                {t.pages.callUs}:{" "}
                <a href={`tel:${phone}`} className="font-mono font-semibold text-indigo-700">{phone}</a>
              </p>
            ) : null}
            {email ? (
              <p className="text-sm text-slate-600">
                {t.pages.emailUs}:{" "}
                <a href={`mailto:${email}`} className="font-semibold text-indigo-700">{email}</a>
              </p>
            ) : null}
            {address ? (
              <p className="whitespace-pre-line text-sm text-slate-600">
                <span className="font-semibold">{t.pages.addressLabel}: </span>{address}
              </p>
            ) : null}
          </div>
          <ContactForm orgSlug={orgSlug} locale={locale} />
        </section>
      );
    }
    default:
      return null;
  }
}

/** Render an array of blocks in order (empty/missing → nothing). */
export function PageBlocks({
  blocks,
  orgSlug,
  locale,
}: {
  blocks: ShopPageBlock[] | null | undefined;
  orgSlug: string;
  locale: string;
}) {
  return (
    <>
      {(blocks ?? []).map((block, i) => (
        <PageBlockView key={i} block={block} orgSlug={orgSlug} locale={locale} />
      ))}
    </>
  );
}
