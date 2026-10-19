"use client";
import React from "react";
import { createOrganizationSchema } from "@repo/contracts";
import { apiFetch } from "@/lib/api";
import { slugifyShopName, localSlugProblem, SHOP_ADDRESS_SUFFIX } from "@/lib/shop-slug";
import { useLocale } from "@/lib/i18n/provider";

/**
 * OU1 item 2: the "নতুন Organization তৈরি" form inside the
 * dashboard switcher. It posts ONLY the fields the real
 * POST /organizations DTO accepts and requires — name + slug
 * (country/timezone/currency keep their server defaults BD /
 * Asia/Dhaka / BDT; the service then creates the OWNER membership,
 * BusinessProfile and FREE/TRIALING subscription).
 *
 * Slug discipline mirrors onboarding (TD2): local format/reserved
 * verdict instantly, then the authoritative slug-available API
 * verdict (taken / reserved / cooldown). Any other API refusal is
 * shown verbatim — the server's message is the honest error state.
 * On success the parent switches into the new org.
 */
export default function OrgCreateForm({ onBack, onCreated }: { onBack: () => void; onCreated: (orgId: string) => void }) {
  const { dict } = useLocale();
  const [name, setName] = React.useState("");
  const [slug, setSlug] = React.useState("");
  const [slugTouched, setSlugTouched] = React.useState(false);
  const [slugState, setSlugState] = React.useState<"idle" | "checking" | "ok" | "bad" | "unknown">("idle");
  const [slugMsg, setSlugMsg] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [error, setError] = React.useState("");
  const slugSeq = React.useRef(0);

  React.useEffect(() => {
    if (!slug) { setSlugState("idle"); setSlugMsg(""); return; }
    const problem = localSlugProblem(slug);
    if (problem) {
      setSlugState("bad");
      setSlugMsg(problem === "reserved"
        ? dict.shell.slugReservedMsg
        : dict.shell.slugFormatMsg);
      return;
    }
    setSlugState("checking"); setSlugMsg("");
    const seq = ++slugSeq.current;
    const t = setTimeout(async () => {
      try {
        const out = await apiFetch<{ available: boolean; message: string }>(`/organizations/slug-available?slug=${encodeURIComponent(slug)}`);
        if (slugSeq.current !== seq) return;
        setSlugState(out.available ? "ok" : "bad");
        setSlugMsg(out.message);
      } catch {
        if (slugSeq.current !== seq) return;
        setSlugState("unknown");
        setSlugMsg(dict.shell.slugCheckUnknownMsg);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [slug, dict]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const parsed = createOrganizationSchema.safeParse({ name: name.trim(), slug });
    if (!parsed.success) {
      setError(name.trim().length < 2 ? dict.shell.nameTooShortError : dict.shell.slugFixError);
      return;
    }
    if (slugState === "bad") { setError(slugMsg || dict.shell.slugUnusableError); return; }
    setCreating(true);
    try {
      const org = await apiFetch<{ id: string }>("/organizations", {
        method: "POST",
        body: JSON.stringify({ name: parsed.data.name, slug: parsed.data.slug }),
      });
      onCreated(org.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : dict.shell.createOrgErrorFallback);
      setCreating(false);
    }
  };

  return (
    <form onSubmit={submit} className="p-1.5">
      <div className="pb-2 text-[13px] font-bold text-slate-800">{dict.shell.createOrgTitle}</div>
      <label className="block text-xs font-medium text-slate-600">{dict.shell.businessNameLabel}
        <input
          className="input mt-1"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (!slugTouched) setSlug(slugifyShopName(e.target.value));
          }}
          placeholder={dict.shell.businessNamePlaceholder}
          required
          autoFocus
        />
      </label>
      <label className="mt-3 block text-xs font-medium text-slate-600">{dict.shell.shopAddressLabel}
        <span className="mt-1 flex items-stretch overflow-hidden rounded-lg border border-slate-300 bg-white focus-within:border-indigo-500">
          <input
            className="min-w-0 flex-1 px-2.5 py-2 text-[13px] outline-none"
            value={slug}
            onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
            placeholder="dhaka-fashion-house"
            aria-label={dict.shell.shopAddressAria}
          />
          <span className="flex items-center bg-slate-50 px-2 text-[11px] text-slate-500">{SHOP_ADDRESS_SUFFIX}</span>
        </span>
      </label>
      {slugState === "checking" ? <p className="mt-1 text-[11px] text-slate-500">{dict.shell.slugChecking}</p> : null}
      {slugState === "ok" ? <p className="mt-1 text-[11px] text-emerald-600">✓ {slugMsg}</p> : null}
      {slugState === "bad" ? <p className="mt-1 text-[11px] text-red-600">{slugMsg}</p> : null}
      {slugState === "unknown" ? <p className="mt-1 text-[11px] text-amber-600">{slugMsg}</p> : null}
      <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{dict.shell.slugNote}</p>
      {error ? <p className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-[12px] text-red-700">{error}</p> : null}
      <div className="mt-3 flex gap-2">
        <button type="button" className="btn-secondary flex-1" onClick={onBack} disabled={creating}>{dict.shell.backButton}</button>
        <button type="submit" className="btn-primary flex-1" disabled={creating || slugState === "bad"}>{creating ? dict.shell.creatingOrg : dict.shell.createOrgSubmit}</button>
      </div>
    </form>
  );
}
