"use client";
import React, { useEffect, useState } from "react";
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
      setNotice("স্বয়ংক্রিয় বাংলা এআই ভয়েস কল শুরু হয়েছে!");
      await fetchCalls();
      onOrderUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ভয়েস কল শুরু করতে সমস্যা হয়েছে");
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
          ? "সিমুলেশন সফল: গ্রাহক ১ চেপে অর্ডার নিশ্চিত করেছেন!"
          : "সিমুলেশন সফল: গ্রাহক ২ চেপে অর্ডার বাতিল করেছেন!",
      );
      await fetchCalls();
      onOrderUpdated?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "সিমুলেশনে সমস্যা হয়েছে");
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
              AI ভয়েস কল কনফার্মেশন (Bangla IVR)
            </h4>
            <p className="text-xs text-slate-500">
              গ্রাহককে স্বয়ংক্রিয় বাংলা ফোন কল করে ১ ও ২ চেপে অর্ডার কনফার্মেশন
            </p>
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
              <span>কল যাচ্ছে...</span>
            </>
          ) : (
            <>
              <span>📞</span>
              <span>AI কল করুন</span>
            </>
          )}
        </button>
      </div>

      {/* Status Bar */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-bold">কনফার্মেশন স্ট্যাটাস</span>
          <span className="font-semibold text-slate-700">
            {codConfirmationStatus === "confirmed" ? (
              <span className="text-emerald-700 font-bold">✅ নিশ্চিত (Confirmed)</span>
            ) : codConfirmationStatus === "declined" ? (
              <span className="text-red-700 font-bold">❌ বাতিল (Declined)</span>
            ) : (
              <span className="text-amber-700 font-medium">⏳ অপেক্ষমাণ (Pending)</span>
            )}
          </span>
        </div>

        <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-bold">কলের প্রচেষ্টা</span>
          <span className="font-semibold text-slate-800">
            {codCallAttempts ?? 0} বার
          </span>
        </div>

        <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-bold">সর্বশেষ কলের ফলাফল</span>
          <span className="font-semibold text-slate-800">
            {codLastCallOutcome === "confirmed"
              ? "✅ গ্রাহক নিশ্চিত করেছেন"
              : codLastCallOutcome === "rejected"
              ? "❌ গ্রাহক বাতিল করেছেন"
              : codLastCallOutcome === "unreachable"
              ? "📵 সাড়া দেননি"
              : codLastCallOutcome || "—"}
          </span>
        </div>

        <div className="rounded-lg bg-slate-50 p-2 border border-slate-100">
          <span className="text-slate-400 block text-[10px] uppercase font-bold">সর্বশেষ কল</span>
          <span className="font-medium text-slate-600">
            {codLastCallAt
              ? new Date(codLastCallAt).toLocaleTimeString("bn-BD", {
                  hour: "2-digit",
                  minute: "2-digit",
                })
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
        <h5 className="text-xs font-semibold text-slate-700 mb-2">কলের ইতিহাস ({calls.length})</h5>

        {loading && calls.length === 0 ? (
          <p className="text-xs text-slate-400 italic">কলের তথ্য লোড হচ্ছে...</p>
        ) : calls.length === 0 ? (
          <p className="text-xs text-slate-400 italic">এই অর্ডারে এখনও কোনো ভয়েস কল করা হয়নি।</p>
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
                      ({new Date(c.createdAt).toLocaleDateString("bn-BD")}{" "}
                      {new Date(c.createdAt).toLocaleTimeString("bn-BD", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })})
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {c.provider === "mock" ? "স্যান্ডবক্স/মক" : "Twilio"}
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
                        ? "নিশ্চিত (ডিজিট ১)"
                        : c.outcome === "rejected"
                        ? "বাতিল (ডিজিট ২)"
                        : "অমীমাংসিত"}
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
                      {expandedPromptId === c.id ? "▲ অডিও স্ক্রিপ্ট লুকান" : "▼ ভয়েস অডিও স্ক্রিপ্ট দেখুন"}
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
                      স্যান্ডবক্স রেসপন্স সিমুলেট:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSimulateResponse(c.id, "1")}
                      disabled={simulating === c.id}
                      className="rounded bg-emerald-50 border border-emerald-300 px-2 py-0.5 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100"
                    >
                      গ্রাহক ১ চাপলেন (নিশ্চিত)
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSimulateResponse(c.id, "2")}
                      disabled={simulating === c.id}
                      className="rounded bg-red-50 border border-red-300 px-2 py-0.5 text-[10px] font-bold text-red-700 hover:bg-red-100"
                    >
                      গ্রাহক ২ চাপলেন (বাতিল)
                    </button>
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
