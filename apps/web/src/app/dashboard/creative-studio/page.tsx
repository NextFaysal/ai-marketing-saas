"use client";
import React from "react";
import { formatMinor } from "@repo/contracts";

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
  { value: "friendly", label: "বন্ধুসুলভ" },
  { value: "professional", label: "পেশাদার" },
  { value: "offer", label: "আকর্ষণীয় অফার" },
  { value: "direct", label: "সরাসরি" },
] as const;

function formatProductPrice(p: ProductItem): string {
  try {
    return formatMinor(BigInt(p.priceMinor), p.currency ?? "BDT");
  } catch {
    return p.priceMinor;
  }
}

function PolicyFindings({ findings }: { findings: PolicyFinding[] }) {
  if (findings.length === 0) return null;
  return (
    <ul className="mt-2 space-y-2">
      {findings.map((f, i) => (
        <li key={i} className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
          {f.snippet ? (
            <p>
              উদ্ধৃতি: <span className="font-medium">“{f.snippet}”</span>
            </p>
          ) : null}
          <p>{f.explanation}</p>
          <p className="mt-1">
            <span className="font-semibold">পরামর্শ: </span>
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
  if (policy.status === "pass") {
    return (
      <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
        ✅ পলিসি চেক: পাস
      </span>
    );
  }
  return (
    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
      ⚠️ পলিসি সতর্কতা
    </span>
  );
}

export default function CreativeStudioPage() {
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

  React.useEffect(() => {
    (async () => {
      const { apiFetch } = await import("@/lib/api");
      const { getOrganizationId } = await import("@/lib/org");
      const orgId = getOrganizationId();
      if (!orgId) {
        setGenerateError("কোনো Organization নির্বাচিত নেই। আবার লগইন করে Onboarding শেষ করুন।");
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
        setGenerateError(e instanceof Error ? e.message : "পণ্যের তালিকা লোড হয়নি");
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
      setGenerateError(e instanceof Error ? e.message : "কপি তৈরি করা যায়নি");
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
        [index]: e instanceof Error ? e.message : "ড্রাফট তৈরি করা যায়নি",
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
          আসল পণ্যের তথ্য (নাম, দাম, বিবরণ) থেকেই AI বিজ্ঞাপনের কপি বানায় — দাম/ছাড়/দাবি বানিয়ে বলে না; প্রতিটি ভ্যারিয়েন্ট স্বয়ংক্রিয় পলিসি চেকে যাচাই হয়।
        </p>
      </div>

      <div className="card space-y-4 p-5">
        <div className="font-semibold">বিজ্ঞাপনের কপি তৈরি করুন</div>
        {productsLoading ? (
          <p className="text-sm text-slate-500">লোড হচ্ছে...</p>
        ) : products.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            কোনো পণ্য নেই — আগে Products পেজে পণ্য যোগ করুন।
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="text-sm">
              পণ্য
              <select
                className="input mt-1 w-full"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {formatProductPrice(p)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              লক্ষ্য (ঐচ্ছিক)
              <input
                className="input mt-1 w-full"
                placeholder="যেমন: ঈদ বিক্রি বাড়ানো"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </label>
            <label className="text-sm">
              টোন
              <select
                className="input mt-1 w-full"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
              >
                {TONE_OPTIONS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              ভাষা
              <div className="mt-1 flex gap-2">
                <button
                  type="button"
                  className={`rounded-lg px-4 py-2 text-sm font-medium ${language === "bn" ? "bg-blue-600 text-white" : "border bg-white"}`}
                  onClick={() => setLanguage("bn")}
                >
                  বাংলা
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
          <p className="text-xs text-slate-400">নির্বাচিত পণ্য: {selectedProduct.name}</p>
        ) : null}
        <button
          type="button"
          className="btn-primary disabled:opacity-50"
          disabled={generating || !productId || products.length === 0}
          onClick={() => onGenerate()}
        >
          {generating ? "তৈরি হচ্ছে..." : "✨ কপি তৈরি করুন"}
        </button>
        {generateError ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{generateError}</p>
        ) : null}
      </div>

      <div className="card p-4 text-sm text-slate-500">
        🖼️ ছবি তৈরির সুবিধা এখনো যুক্ত হয়নি — Creative Studio এখন শুধু বিজ্ঞাপনের লেখা (কপি) তৈরি করে। ড্রাফটে পণ্যের নিজের ছবি (যদি থাকে) ব্যবহৃত হবে।
      </div>

      <div className="card space-y-3 p-5">
        <div className="font-semibold">ক্যাম্পেইন ড্রাফট</div>
        <p className="text-sm text-slate-500">
          পছন্দের ভ্যারিয়েন্ট থেকে সরাসরি ক্যাম্পেইন ড্রাফট বানানো যাবে — ড্রাফট মানেই শুধু খসড়া, কিছুই প্রকাশ হবে না।
        </p>
        {adAccounts.length === 0 ? (
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
            ক্যাম্পেইন ড্রাফট বানাতে একটি Meta বিজ্ঞাপন অ্যাকাউন্ট দরকার — Ad Accounts পেজে যুক্ত করুন।
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="text-sm">
              Meta বিজ্ঞাপন অ্যাকাউন্ট
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
              ল্যান্ডিং লিংক (ঐচ্ছিক)
              <input
                className="input mt-1 w-full"
                placeholder="ল্যান্ডিং লিংক (না দিলে Business Knowledge-এর ওয়েবসাইট লিংক ব্যবহৃত হবে)"
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
              {result.notice ?? "আসল AI কনফিগার করা হয়নি — এগুলো Dev Template Adapter-এর টেমপ্লেট।"}
            </p>
          ) : null}
          <div className="text-sm text-slate-500">
            পণ্য: <span className="font-medium text-slate-700">{result.product.name}</span>
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
                    {draftingIndex === i ? "ড্রাফট তৈরি হচ্ছে..." : "📝 ক্যাম্পেইনে ব্যবহার করুন"}
                  </button>

                  {draftError ? (
                    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{draftError}</p>
                  ) : null}

                  {draft ? (
                    <div className="space-y-2">
                      <div className="rounded-lg bg-green-50 p-3 text-sm text-green-800">
                        <p>{draft.note}</p>
                        <p className="mt-1">ড্রাফট আইডি: {draft.planId}</p>
                        <p className="mt-1 font-medium">এটি শুধু ড্রাফট — কিছুই প্রকাশ হয়নি।</p>
                        <a className="mt-2 inline-block font-semibold text-blue-700 underline" href="/dashboard/campaign-builder">
                          Campaign Builder-এ খুলুন
                        </a>
                      </div>
                      {draft.policy.status === "flagged" ? (
                        <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                          <p>ড্রাফট তৈরি হয়েছে, তবে এই কপিতে পলিসি সতর্কতা আছে — প্রকাশের আগে ঠিক করুন।</p>
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
    </div>
  );
}
