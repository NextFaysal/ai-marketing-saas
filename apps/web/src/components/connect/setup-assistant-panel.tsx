"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { findingSeverityMeta, type SetupFindingView } from "@/lib/connections";

/**
 * CC20 — Smart Setup Assistant.
 *
 * The findings come from the API, where every one of them is
 * computed from REAL rows (connections, templates, gateways,
 * shipments…) at read time — this panel invents nothing, it only
 * renders the server's evidence and offers the fix link the
 * server named. Dismissing is per user (the server stores it);
 * a dismissed finding returns only if… it doesn't — dismissal
 * hides it for this user while it still fires, and once the
 * underlying gap is fixed the finding stops firing for everyone.
 * When the API returns no findings, the honest empty state is
 * "সব ঠিক আছে" — never a padded list of generic tips.
 */
export function SetupAssistantPanel() {
  const [findings, setFindings] = useState<SetupFindingView[] | null>(null);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState("");

  const load = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      const res = await apiFetch<{ findings: SetupFindingView[] }>(`organizations/${orgId}/connections/assistant`);
      setFindings(res.findings ?? []);
      setError("");
    } catch (e) {
      // A failing assistant must not take the Center down — the
      // panel shows its own failure honestly and stays small.
      setError(e instanceof Error ? e.message : "সেটআপ সহকারী লোড হয়নি");
      setFindings([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const dismiss = useCallback(async (finding: SetupFindingView) => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setBusyKey(finding.key);
    try {
      await apiFetch(`organizations/${orgId}/connections/assistant/dismiss`, {
        method: "POST",
        body: JSON.stringify({ findingKey: finding.key }),
      });
      setFindings((prev) => (prev ?? []).filter((f) => f.key !== finding.key));
    } catch (e) {
      setError(e instanceof Error ? e.message : "বাদ দেওয়া যায়নি");
    } finally {
      setBusyKey("");
    }
  }, []);

  if (findings === null) return null;

  return (
    <section className="card space-y-3 p-4" aria-label="স্মার্ট সেটআপ সহকারী">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-slate-800">🧭 স্মার্ট সেটআপ সহকারী</h2>
        <span className="text-xs text-slate-400">প্রতিটি পরামর্শ আপনার আসল রেকর্ড যাচাই করে তৈরি — অনুমান নয়</span>
      </div>
      {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p> : null}
      {findings.length === 0 ? (
        <p className="rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-700">
          ✅ সব ঠিক আছে — আপনার কানেকশনগুলোতে কোনো ঘাটতি পাওয়া যায়নি।
        </p>
      ) : (
        <ul className="space-y-2">
          {findings.map((f) => {
            const meta = findingSeverityMeta(f.severity);
            return (
              <li key={f.key} className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-inset ring-slate-100">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className={`mr-2 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta.cls}`}>{meta.label}</span>
                    <span className="text-sm font-semibold text-slate-800">{f.title}</span>
                  </div>
                  <button
                    type="button"
                    disabled={busyKey === f.key}
                    onClick={() => void dismiss(f)}
                    className="shrink-0 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-50"
                    title="এই পরামর্শটি আমার জন্য বাদ দিন"
                  >
                    ✕ বাদ দিন
                  </button>
                </div>
                <p className="mt-1.5 text-[13px] text-slate-600">{f.evidence}</p>
                <p className="mt-1 text-xs text-slate-400">যে ফিচারটি আটকে আছে: {f.feature}</p>
                <a href={f.href} className="mt-2 inline-block rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700">
                  {f.actionLabel} →
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
