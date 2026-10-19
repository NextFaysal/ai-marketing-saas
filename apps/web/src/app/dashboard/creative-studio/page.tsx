"use client";
import React from "react";
import { fmtMoneyMinor, type UiLocale } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";

interface ProductItem {
  id: string;
  name: string;
  priceMinor: string;
  currency?: string | null;
  category?: string | null;
  stockQuantity?: number | null;
  imageUrl?: string | null;
}

interface AdAccount {
  id: string;
  name: string;
  platform: string;
  integrationId?: string | null;
}

interface PolicyFinding {
  rule: string;
  severity: string;
  snippet: string;
  explanation: string;
  suggestion: string;
}

interface PolicyResult {
  status: "pass" | "flagged";
  findings: PolicyFinding[];
}

interface CreativeVariant {
  headline: string;
  primaryText: string;
  callToAction: string;
  policy: PolicyResult;
}

interface GenerateResponse {
  provider: string;
  isRealLlm: boolean;
  notice?: string;
  product: { id: string; name: string; price: string | number; currency: string };
  variants: CreativeVariant[];
}

interface DraftResponse {
  planId: string;
  status: "draft";
  adSetId: string;
  adId: string;
  policy: PolicyResult;
  note: string;
}

const TONE_OPTIONS = [
  { value: "friendly", label: "বন্ধুসুলভ", labelEn: "Friendly" },
  { value: "professional", label: "পেশাদার", labelEn: "Professional" },
  { value: "offer", label: "আকর্ষণীয় অফার", labelEn: "Attractive offer" },
  { value: "direct", label: "সরাসরি", labelEn: "Direct" },
] as const;

function formatProductPrice(p: ProductItem, locale: UiLocale = "bn"): string {
  try {
    return fmtMoneyMinor(locale, BigInt(p.priceMinor), { currency: p.currency ?? "BDT" });
  } catch {
    return p.priceMinor;
  }
}

function PolicyFindings({ findings }: { findings: PolicyFinding[] }) {
  const { t } = useLocale();
  if (findings.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {findings.map((f, i) => (
        <li key={i} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          {f.snippet ? (
            <p>
              {t("ai.csQuote")} <span className="font-medium">“{f.snippet}”</span>
            </p>
          ) : null}
          <p>{f.explanation}</p>
          <p className="mt-1">
            <span className="font-semibold">{t("ai.csAdvice")}</span>
            {f.suggestion}
          </p>
          <p className="mt-1 text-[11px] text-amber-700">
            {f.rule} · {f.severity}
          </p>
        </li>
      ))}
    </ul>
  );
}

function PolicyBadge({ policy }: { policy: PolicyResult }) {
  const { t } = useLocale();
  if (policy.status === "pass") {
    return (
      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
        {t("ai.csPolicyPass")}
      </span>
    );
  }
  return (
    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      {t("ai.csPolicyWarn")}
    </span>
  );
}

import { BannerStudio } from "./banner-studio";

export default function CreativeStudioPage() {
  const { t, locale } = useLocale();
  const [activeTab, setActiveTab] = React.useState<"copy" | "banner">("copy");
  const [products, setProducts] = React.useState<ProductItem[]>([]);
  const [productsLoading, setProductsLoading] = React.useState(true);
  const [productId, setProductId] = React.useState("");
  const [goal, setGoal] = React.useState("");
  const [tone, setTone] = React.useState<string>(TONE_OPTIONS[0].value);
  const [language, setLanguage] = React.useState<"bn" | "en">("bn");

  const [generating, setGenerating] = React.useState(false);
  const [generateError, setGenerateError] = React.useState("");
  const [result, setResult] = React.useState<GenerateResponse | null>(null);

  const [adAccounts, setAdAccounts] = React.useState<AdAccount[]>([]);
  const [adAccountId, setAdAccountId] = React.useState("");
  const [linkUrl, setLinkUrl] = React.useState("");

  const [draftingIndex, setDraftingIndex] = React.useState<number | null>(null);
  const [draftResults, setDraftResults] = React.useState<Record<number, DraftResponse>>({});
  const [draftErrors, setDraftErrors] = React.useState<Record<number, string>>({});

  async function onDraftWithBanner(product: ProductItem, bannerHeadline: string, bannerPrimaryText: string) {
    if (!adAccountId || draftingIndex !== null) return;
    const { apiFetch } = await import("@/lib/api");
    const { getOrganizationId } = await import("@/lib/org");
    const orgId = getOrganizationId();
    if (!orgId) return;
    setDraftingIndex(999);
    try {
      const res = await apiFetch<DraftResponse>(
        `/organizations/${orgId}/ai/creative-studio/draft`,
        {
          method: "POST",
          body: JSON.stringify({
            productId: product.id,
            adAccountId,
            headline: bannerHeadline,
            primaryText: bannerPrimaryText,
            callToAction: "SHOP_NOW",
            linkUrl: linkUrl.trim() ? linkUrl.trim() : undefined,
          }),
        },
      );
      setDraftResults((prev) => ({ ...prev, [999]: res }));
      alert(t("ai.csDraftSuccessAlert", { id: res.planId }));
    } catch (e) {
      alert(t("ai.csDraftFailAlert", { error: e instanceof Error ? e.message : "Error" }));
    } finally {
      setDraftingIndex(null);
    }
  }

  React.useEffect(() => {
    (async () => {
      const { apiFetch } = await import("@/lib/api");
      const { getOrganizationId } = await import("@/lib/org");
      const orgId = getOrganizationId();
      if (!orgId) {
        setGenerateError(t("ai.csNoOrg"));
        setProductsLoading(false);
        return;
      }
      try {
        const data = await apiFetch<{ total: number; items: ProductItem[] }>(
          `/organizations/${orgId}/products?pageSize=50`,
        );
        setProducts(data.items);
        if (data.items[0]) setProductId(data.items[0].id);
      } catch (e) {
        setGenerateError(e instanceof Error ? e.message : t("ai.csProductsLoadFail"));
      } finally {
        setProductsLoading(false);
      }
      const list = await apiFetch<AdAccount[]>(`/organizations/${orgId}/ad-accounts`).catch(() => [] as AdAccount[]);
      const meta = list.filter((x) => x.platform === "meta" && x.integrationId);
      setAdAccounts(meta);
      if (meta[0]) setAdAccountId(meta[0].id);
    })();
  }, []);

  async function onGenerate() {
    if (!productId || generating) return;
    const { apiFetch } = await import("@/lib/api");
    const { getOrganizationId } = await import("@/lib/org");
    const orgId = getOrganizationId();
    if (!orgId) return;
    setGenerating(true);
    setGenerateError("");
    setDraftResults({});
    setDraftErrors({});
    try {
      const res = await apiFetch<GenerateResponse>(
        `/organizations/${orgId}/ai/creative-studio/generate`,
        {
          method: "POST",
          body: JSON.stringify({
            productId,
            goal: goal.trim() ? goal.trim() : undefined,
            tone,
            language,
          }),
        },
      );
      setResult(res);
    } catch (e) {
      setResult(null);
      setGenerateError(e instanceof Error ? e.message : t("ai.csCopyFail"));
    } finally {
      setGenerating(false);
    }
  }

  async function onDraft(variant: CreativeVariant, index: number) {
    if (!productId || !adAccountId || draftingIndex !== null) return;
    const { apiFetch } = await import("@/lib/api");
    const { getOrganizationId } = await import("@/lib/org");
    const orgId = getOrganizationId();
    if (!orgId) return;
    setDraftingIndex(index);
    setDraftErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    try {
      const res = await apiFetch<DraftResponse>(
        `/organizations/${orgId}/ai/creative-studio/draft`,
        {
          method: "POST",
          body: JSON.stringify({
            productId,
            adAccountId,
            headline: variant.headline,
            primaryText: variant.primaryText,
            callToAction: variant.callToAction,
            linkUrl: linkUrl.trim() ? linkUrl.trim() : undefined,
          }),
        },
      );
      setDraftResults((prev) => ({ ...prev, [index]: res }));
    } catch (e) {
      setDraftErrors((prev) => ({
        ...prev,
        [index]: e instanceof Error ? e.message : t("ai.csDraftFail"),
      }));
    } finally {
      setDraftingIndex(null);
    }
  }

  const selectedProduct = products.find((p) => p.id === productId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">🎨 AI Creative Studio</h1>
        <p className="text-sm text-slate-500">
          {t("ai.csSubtitle")}
        </p>
      </div>

      {/* Mode Tabs */}
      <div className="flex border-b border-slate-200">
        <button
          type="button"
          onClick={() => setActiveTab("copy")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition ${
            activeTab === "copy"
              ? "border-sky-600 text-sky-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>📝</span>
          <span>{t("ai.csTabCopy")}</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("banner")}
          className={`flex items-center gap-2 border-b-2 px-5 py-3 text-sm font-semibold transition ${
            activeTab === "banner"
              ? "border-sky-600 text-sky-600"
              : "border-transparent text-slate-500 hover:text-slate-800"
          }`}
        >
          <span>🎨</span>
          <span>{t("ai.csTabBanner")}</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
            NEW
          </span>
        </button>
      </div>

      {activeTab === "banner" ? (
        <BannerStudio
          products={products}
          adAccounts={adAccounts}
          selectedAdAccountId={adAccountId}
          onDraftWithBanner={onDraftWithBanner}
        />
      ) : (
        <>
          <div className="card space-y-4 p-5">
            <div className="font-semibold">{t("ai.csCardTitle")}</div>
            {productsLoading ? (
              <p className="text-sm text-slate-500">{t("ai.csLoading")}</p>
            ) : products.length === 0 ? (
              <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                {t("ai.csNoProducts")}
              </p>
            ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="text-sm">
              {t("ai.csProduct")}
              <select
                className="input mt-1 w-full"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatProductPrice(p, locale)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {t("ai.csGoal")}
              <input
                className="input mt-1 w-full"
                placeholder={t("ai.csGoalPlaceholder")}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <label className="text-sm">
              {t("ai.csTone")}
              <select
                className="input mt-1 w-full"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              >
                {TONE_OPTIONS.map((toneOpt) => (
                  <option key={toneOpt.value} value={toneOpt.value}>
                    {locale === "en" ? toneOpt.labelEn : toneOpt.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              {t("ai.csLanguage")}
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${language === "bn" ? "bg-blue-600 text-white" : "border bg-white"}`}
                  onClick={() => setLanguage("bn")}
                >
                  {t("ai.csLangBn")}
                </button>
                <button
                  type="button"
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${language === "en" ? "bg-blue-600 text-white" : "border bg-white"}`}
                  onClick={() => setLanguage("en")}
                >
                  English
                </button>
              </div>
            </div>
          </div>
        )}
        {selectedProduct?.imageUrl ? (
          <p className="text-xs text-slate-400">{t("ai.csSelectedProduct", { name: selectedProduct.name })}</p>
        ) : null}
        <button
          type="button"
          className="btn-primary disabled:opacity-50"
          disabled={generating || !productId || products.length === 0}
          onClick={() => onGenerate()}
        >
          {generating ? t("ai.csGenerating") : t("ai.csGenerate")}
        </button>
        {generateError ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{generateError}</p>
        ) : null}
      </div>

      <div className="card p-4 text-sm text-slate-500">
        {t("ai.csImageNote")}
      </div>

      <div className="card space-y-3 p-5">
        <div className="font-semibold">{t("ai.csDraftTitle")}</div>
        <p className="text-sm text-slate-500">
          {t("ai.csDraftDesc")}
        </p>
        {adAccounts.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            {t("ai.csNeedAccount")}
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="text-sm">
              {t("ai.csMetaAccount")}
              <select
                className="input mt-1 w-full"
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
              >
                {adAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              {t("ai.csLinkUrl")}
              <input
                className="input mt-1 w-full"
                placeholder={t("ai.csLinkPlaceholder")}
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {result ? (
        <div className="space-y-4">
          {result.isRealLlm === false ? (
            <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              {result.notice ?? t("ai.csDevNotice")}
            </p>
          ) : null}
          <div className="text-sm text-slate-500">
            {t("ai.csProductLabel")} <span className="font-medium text-slate-700">{result.product.name}</span>
            {result.product.price !== undefined && result.product.price !== null && result.product.price !== "" ? (
              <span> — {String(result.product.price)} {result.product.currency}</span>
            ) : null}
            <span className="ml-2 text-xs text-slate-400">Provider: {result.provider}</span>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {result.variants.map((v, i) => {
              const draft = draftResults[i];
              const draftError = draftErrors[i];
              return (
                <div key={i} className="card space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h2 className="font-bold">{v.headline}</h2>
                    <PolicyBadge policy={v.policy} />
                  </div>
                  <p className="whitespace-pre-wrap text-sm text-slate-600">{v.primaryText}</p>
                  <div>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
                      {v.callToAction}
                    </span>
                  </div>
                  {v.policy.status === "flagged" ? (
                    <PolicyFindings findings={v.policy.findings} />
                  ) : null}

                  <button
                    type="button"
                    className="btn-primary btn-sm disabled:opacity-50"
                    disabled={!adAccountId || adAccounts.length === 0 || draftingIndex !== null}
                    onClick={() => onDraft(v, i)}
                  >
                    {draftingIndex === i ? t("ai.csDrafting") : t("ai.csUseInCampaign")}
                  </button>

                  {draftError ? (
                    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{draftError}</p>
                  ) : null}

                  {draft ? (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
                        <p>{draft.note}</p>
                        <p className="mt-1">{t("ai.csDraftId", { id: draft.planId })}</p>
                        <p className="mt-1 font-medium">{t("ai.csDraftOnlyNote")}</p>
                        <a className="mt-2 inline-block font-semibold text-blue-700 underline" href="/dashboard/campaign-builder">
                          {t("ai.csOpenInBuilder")}
                        </a>
                      </div>
                      {draft.policy.status === "flagged" ? (
                        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                          <p>{t("ai.csDraftPolicyWarn")}</p>
                          <PolicyFindings findings={draft.policy.findings} />
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
        </>
      )}
    </div>
  );
}
