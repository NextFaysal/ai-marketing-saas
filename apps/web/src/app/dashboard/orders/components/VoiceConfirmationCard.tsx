"use client";
import React, { useEffect, useState } from "react";
import { fmtTime, fmtDate } from "@repo/contracts";
import { useLocale } from "@/lib/i18n/provider";
import { apiFetch } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";

export interface VoiceCallLog {
  id: string;
  orderId: string;
  phone: string;
  provider: string;
  callSid?: string | null;
  status: string;
  durationSeconds: number;
  digitsPressed?: string | null;
  outcome: string;
  speechPrompt?: string | null;
  createdAt: string;
}

export function VoiceConfirmationCard({
  orderId,
  isCod,
  codConfirmationStatus,
  codCallAttempts,
  codLastCallAt,
  codLastCallOutcome,
  customerPhone,
  onOrderUpdated,
}: {
  orderId: string;
  isCod?: boolean;
  codConfirmationStatus?: string | null;
  codCallAttempts?: number | null;
  codLastCallAt?: string | null;
  codLastCallOutcome?: string | null;
  customerPhone?: string | null;
  onOrderUpdated?: () => void;
}) {
  const { dict, t, locale } = useLocale();
  const [calls, setCalls] = useState<VoiceCallLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [calling, setCalling] = useState(false);
  const [simulating, setSimulating] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [expandedPromptId, setExpandedPromptId] = useState<string | null>(null);

  const fetchCalls = async () => {
    const orgId = getOrganizationId();
    if (!orgId || !orderId) return;
    try {
      setLoading(true);
      const data = await apiFetch<VoiceCallLog[]>(
        `/organizations/${orgId}/orders/${orderId}/voice-calls`,
      );
      setCalls(data || []);
    } catch (e) {
      // Non-blocking
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCalls();
  }, [orderId]);

  const handleInitiateCall = async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setCalling(true);
    setNotice("");
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/orders/${orderId}/voice-call`, {
        method: "POST",
        body: JSON.stringify({ phone: customerPhone }),
      });
      setNotice(dict.orders.automatedBengaliAIVoiceCall);
      await fetchCalls();
      onOrderUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.voiceCallCouldNotBe);
    } finally {
      setCalling(false);
    }
  };

  const handleSimulateResponse = async (callId: string, digits: "1" | "2") => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    setSimulating(callId);
    setNotice("");
    setError("");
    try {
      await apiFetch(`/organizations/${orgId}/voice/calls/${callId}/simulate`, {
        method: "POST",
        body: JSON.stringify({ digitsPressed: digits }),
      });
      setNotice(
        digits === "1"
          ? dict.orders.simulationSuccessCustomerPressed1
          : dict.orders.simulationSuccessCustomerPressed2,
      );
      await fetchCalls();
      onOrderUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : dict.orders.simulationProblem);
    } finally {
      setSimulating(null);
    }
  };

  if (!isCod) {
    return null;
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-gradient-to-b from-indigo-50/40 to-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-indigo-100/60 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white text-sm shadow-sm">
            📞
          </span>
          <div>
            <h4 className="text-sm font-semibold text-slate-900">
              {dict.orders.aIVoiceCallConfirmationBangla}</h4>
            <p className="text-xs text-slate-500">
              {dict.orders.automaticallyCallTheCustomerIn}</p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleInitiateCall}
          disabled={calling}
          className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          {calling ? (
            <>
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
              <span>{dict.orders.calling}</span>
            </>
          ) : (
            <>
              <span>📞</span>
              <span>{dict.orders.callWithAI}</span>
            </>
          )}
        </button>
      </div>

      {/* Status Bar */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-bold">{dict.orders.confirmationStatus}</span>
          <span className="font-semibold text-slate-700">
            {codConfirmationStatus === "confirmed" ? (
              <span className="text-emerald-700 font-bold">{dict.orders.confirmed}</span>
            ) : codConfirmationStatus === "declined" ? (
              <span className="text-red-700 font-bold">{dict.orders.declined}</span>
            ) : (
              <span className="text-amber-700 font-medium">{dict.orders.pending3}</span>
            )}
          </span>
        </div>

        <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-bold">{dict.orders.callAttempts}</span>
          <span className="font-semibold text-slate-800">
            {codCallAttempts ?? 0} {dict.orders.times}</span>
        </div>

        <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-bold">{dict.orders.lastCallResult}</span>
          <span className="font-semibold text-slate-800">
            {codLastCallOutcome === "confirmed"
              ? dict.orders.customerConfirmed
              : codLastCallOutcome === "rejected"
              ? dict.orders.customerCancelled
              : codLastCallOutcome === "unreachable"
              ? dict.orders.noAnswer
              : codLastCallOutcome || "—"}
          </span>
        </div>

        <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-bold">{dict.orders.lastCall}</span>
          <span className="font-medium text-slate-600">
            {codLastCallAt
              ? fmtTime(locale, new Date(codLastCallAt))
              : "—"}
          </span>
        </div>
      </div>

      {notice && (
        <div className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 border border-emerald-200">
          {notice}
        </div>
      )}

      {error && (
        <div className="mt-3 rounded-lg bg-red-50 p-2.5 text-xs text-red-800 border border-red-200">
          {error}
        </div>
      )}

      {/* Call History */}
      <div className="mt-4">
        <h5 className="text-xs font-semibold text-slate-700 mb-2">{dict.orders.callHistory}{calls.length})</h5>

        {loading && calls.length === 0 ? (
          <p className="text-xs text-slate-400 italic">{dict.orders.callInfoLoading}</p>
        ) : calls.length === 0 ? (
          <p className="text-xs text-slate-400 italic">{dict.orders.noVoiceCallsHaveBeen}</p>
        ) : (
          <div className="space-y-2">
            {calls.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-slate-200/80 bg-white p-2.5 text-xs shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        c.outcome === "confirmed"
                          ? "bg-emerald-500"
                          : c.outcome === "rejected"
                          ? "bg-red-500"
                          : "bg-amber-400"
                      }`}
                    />
                    <span className="font-semibold text-slate-800">
                      {c.phone}
                    </span>
                    <span className="text-slate-400 text-[11px]">
                      ({fmtDate(locale, new Date(c.createdAt))}{" "}
                      {fmtTime(locale, new Date(c.createdAt))})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {c.provider === "mock" ? dict.orders.sandboxMock : "Twilio"}
                    </span>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        c.outcome === "confirmed"
                          ? "bg-emerald-100 text-emerald-800"
                          : c.outcome === "rejected"
                          ? "bg-red-100 text-red-800"
                          : "bg-amber-100 text-amber-800"
                      }`}
                    >
                      {c.outcome === "confirmed"
                        ? dict.orders.confirmedDigit1
                        : c.outcome === "rejected"
                        ? dict.orders.cancelledDigit2
                        : dict.orders.undecided}
                    </span>
                  </div>
                </div>

                {/* Speech prompt expander */}
                {c.speechPrompt && (
                  <div className="mt-2 text-[11px]">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedPromptId(expandedPromptId === c.id ? null : c.id)
                      }
                      className="text-indigo-600 hover:underline font-medium"
                    >
                      {expandedPromptId === c.id ? dict.orders.hideAudioScript : dict.orders.viewVoiceAudioScript}
                    </button>
                    {expandedPromptId === c.id && (
                      <div className="mt-1 rounded bg-slate-50 p-2 text-slate-700 border border-slate-100 leading-relaxed font-sans">
                        "{c.speechPrompt}"
                      </div>
                    )}
                  </div>
                )}

                {/* Mock Simulation Buttons */}
                {c.provider === "mock" && c.outcome === "pending" && (
                  <div className="mt-2.5 flex items-center gap-2 border-t border-slate-100 pt-2">
                    <span className="text-[10px] font-semibold text-slate-500">
                      {dict.orders.simulateSandboxResponse}</span>
                    <button
                      type="button"
                      onClick={() => handleSimulateResponse(c.id, "1")}
                      disabled={simulating === c.id}
                      className="rounded bg-emerald-50 border border-emerald-300 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
                    >
                      {dict.orders.customerPressed1Confirm}</button>
                    <button
                      type="button"
                      onClick={() => handleSimulateResponse(c.id, "2")}
                      disabled={simulating === c.id}
                      className="rounded bg-red-50 border border-red-300 px-2 py-0.5 text-[10px] font-bold text-red-700 hover:bg-red-100"
                    >
                      {dict.orders.customerPressed2Cancel}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
