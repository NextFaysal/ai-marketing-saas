"use client";

/**
 * Inbox Next-Gen P1 composer extras: a curated emoji picker and a
 * MediaRecorder voice recorder. No new dependencies.
 *
 * Voice honesty notes:
 * - The browser picks the recording container (Chrome: audio/webm,
 *   Safari: audio/mp4). The file goes through the SAME media send
 *   flow as drag-dropped files, so a channel that rejects the
 *   container surfaces the platform's own error — never a fake
 *   "sent". Telegram wants OGG/Opus for voice notes; a webm
 *   recording is sent as an audio file there and may be rejected
 *   by Telegram itself (its error shows verbatim).
 */
import { useEffect, useRef, useState } from "react";
import { API_URL, getToken } from "@/lib/api";
import { getOrganizationId } from "@/lib/org";
import { COURIER_STEP_LABELS, courierStatusView } from "@/lib/courier-status";
import { CHANNEL_DOT, CHANNEL_META, initialsOf, money } from "@/lib/inbox-format";

export const EMOJIS: string[] = [
  "😀", "😁", "😂", "🤣", "😊", "😍", "😘", "🙂", "😉", "😎",
  "🤩", "🥰", "😇", "🙏", "👍", "👎", "👏", "🙌", "💪", "🤝",
  "❤️", "💙", "💚", "💛", "🧡", "💜", "🖤", "💯", "🔥", "⭐",
  "✅", "❌", "⚠️", "❓", "❗", "💡", "📌", "📦", "🚚", "🛵",
  "💰", "💸", "🏷️", "🛍️", "🛒", "📱", "📞", "✉️", "📍", "🏠",
  "🎉", "🎁", "🥳", "👌", "✌️", "🤲", "🌙", "☀️", "🌧️", "⏰",
  "📅", "🔔", "👀", "💬", "📸",
];

export function EmojiPickerPanel({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <div className="w-72 rounded-3xl border border-slate-200/80 bg-white p-2 shadow-pop">
      <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className="rounded-xl p-1 text-lg leading-none transition hover:bg-slate-100 active:scale-95"
            onClick={() => onPick(e)}
            aria-label={`emoji ${e}`}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

const MIME_CANDIDATES = ["audio/ogg;codecs=opus", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
const MAX_RECORD_SECONDS = 300;

function extFor(mime: string): string {
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("mpeg")) return "mp3";
  return "webm";
}

export function VoiceRecorder({
  disabled,
  onSend,
  onError,
}: {
  disabled?: boolean;
  onSend: (file: File) => void;
  onError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "recording" | "preview">("idle");
  const [seconds, setSeconds] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const blobRef = useRef<Blob | null>(null);
  const mimeRef = useRef<string>("audio/webm");
  const startedAtRef = useRef<number>(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function cleanupStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  useEffect(() => () => {
    cleanupStream();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      onError("এই ব্রাউজারে ভয়েস রেকর্ডিং সমর্থিত নয়।");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      onError("মাইক্রোফোনের অনুমতি পাওয়া যায়নি — ব্রাউজারের অ্যাড্রেস বারের পাশে মাইক আইকনে ক্লিক করে অনুমতি দিয়ে আবার চেষ্টা করুন।");
      return;
    }
    streamRef.current = stream;
    const mime = MIME_CANDIDATES.find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) ?? "";
    mimeRef.current = mime || "audio/webm";
    const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    recorderRef.current = recorder;
    chunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeRef.current });
      blobRef.current = blob;
      setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(blob); });
      cleanupStream();
      setPhase("preview");
    };
    recorder.start(250);
    startedAtRef.current = Date.now();
    setSeconds(0);
    setPhase("recording");
    timerRef.current = setInterval(() => {
      const s = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setSeconds(s);
      if (s >= MAX_RECORD_SECONDS) stop();
    }, 500);
  }

  function stop() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") recorderRef.current.stop();
  }

  function discard() {
    blobRef.current = null;
    setPreviewUrl((old) => { if (old) URL.revokeObjectURL(old); return null; });
    setPhase("idle");
  }

  function send() {
    const blob = blobRef.current;
    if (!blob) return;
    const file = new File([blob], `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.${extFor(mimeRef.current)}`, { type: mimeRef.current });
    discard();
    onSend(file);
  }

  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  if (phase === "recording") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600 ring-1 ring-inset ring-red-200">
          <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {mmss} রেকর্ড হচ্ছে…
        </span>
        <button type="button" className="btn-secondary btn-sm" onClick={stop}>⏹ থামান</button>
      </span>
    );
  }
  if (phase === "preview") {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        {previewUrl ? <audio controls src={previewUrl} className="h-9 max-w-56" /> : null}
        <button type="button" className="btn-primary btn-sm" onClick={send}>🎙️ ভয়েস পাঠান</button>
        <button type="button" className="btn-secondary btn-sm" onClick={discard}>🗑 বাদ দিন</button>
      </span>
    );
  }
  return (
    <button type="button" className="btn-secondary btn-sm" disabled={disabled} onClick={() => void start()} title="ভয়েস মেসেজ রেকর্ড করুন">
      🎙️ ভয়েস
    </button>
  );
}

// ---- IN9c: presentational components extracted from the inbox
// page (props-only; no page state is shared — behaviour unchanged).

// ---- Unified Inbox U1: channel identity chip ----
export function ChannelChip({ channel, lg }: { channel: string; lg?: boolean }) {
  const m = CHANNEL_META[channel] ?? { label: channel, emoji: "💬", cls: "bg-slate-100 text-slate-600 ring-slate-200" };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ring-1 ${m.cls} ${lg ? "text-xs" : "text-[10px]"}`}>{m.emoji} {m.label}</span>;
}

export function ConvAvatar({ name, phone, channel }: { name?: string | null; phone?: string | null; channel: string }) {
  return (
    <span className="conv-avatar" aria-hidden="true">
      {initialsOf(name ?? phone)}
      <span className={`conv-dot ${CHANNEL_DOT[channel] ?? "bg-slate-400"}`} />
    </span>
  );
}

/**
 * Renders protected inbox media. RB4/RM5 item 3: when object
 * storage is on, the API's media-url endpoint returns a presigned
 * URL and the browser loads the bytes straight from storage —
 * the API byte-proxy below stays as the fallback for local mode
 * (endpoint answers url: null) and for any failure of the signed
 * path, so pre-R2 behaviour is preserved exactly.
 */
export function MediaView({ convId, message }: { convId: string; message: { id: string; type: string; content?: string | null } }) {
  const orgId = getOrganizationId();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    (async () => {
      try {
        const signed = await fetch(`${API_URL}/organizations/${orgId}/inbox/conversations/${convId}/messages/${message.id}/media-url`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        }).catch(() => null);
        if (signed?.ok) {
          const data: any = await signed.json().catch(() => null);
          if (data?.url) {
            if (!cancelled) setUrl(data.url);
            return;
          }
        }
        const res = await fetch(`${API_URL}/organizations/${orgId}/inbox/conversations/${convId}/messages/${message.id}/media`, {
          headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        });
        if (!res.ok) throw new Error("media");
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch { if (!cancelled) setFailed(true); }
    })();
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [orgId, convId, message.id]);

  if (failed) return <span className="text-xs opacity-70">[মিডিয়া লোড হয়নি: {message.type}]</span>;
  if (!url) return <span className="skeleton inline-block h-24 w-44 align-middle" role="status" aria-label="মিডিয়া লোড হচ্ছে" />;
  if (message.type === "image" || message.type === "sticker") return <img src={url} alt={message.content ?? "ছবি"} className="max-h-56 rounded-lg" />;
  if (message.type === "audio") return <audio controls src={url} className="max-w-[240px]" />;
  if (message.type === "video") return <video controls src={url} className="max-h-56 rounded-lg" />;
  return <a href={url} target="_blank" rel="noreferrer" className="underline">📎 ফাইল খুলুন ({message.type})</a>;
}

/** Inbox Next-Gen P2: live courier tracking widget. The status
 * string is the courier's own words (stored verbatim); the
 * stepper follows the documented mapping in lib/courier-status —
 * an unmapped status renders the courier's words alone, with no
 * stepper guess. Sync calls the existing manual sync endpoint and
 * surfaces provider errors verbatim (handled by the caller). */
export function ShipmentWidget({ shipment, currency, syncing, onSync }: {
  shipment: { id: string; trackingCode?: string | null; status: string; provider: string; codAmountMinor?: string | null; lastCheckedAt?: string | null };
  currency: string;
  syncing: boolean;
  onSync: () => void;
}) {
  const view = courierStatusView(shipment.status);
  return (
    <div className="mt-2 rounded-xl bg-slate-50/70 p-2.5 shadow-sm ring-1 ring-slate-200/70">
      <div className="flex flex-wrap items-center justify-between gap-1">
        <span className="font-semibold">🚚 {shipment.provider}{shipment.trackingCode ? ` · ${shipment.trackingCode}` : ""}</span>
        <button className="rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-semibold hover:bg-slate-200 disabled:opacity-50" disabled={syncing} onClick={onSync} title="কুরিয়ারের কাছ থেকে এখনই সর্বশেষ স্ট্যাটাস আনুন">
          {syncing ? "আপডেট হচ্ছে…" : "🔄 এখনই আপডেট করুন"}
        </button>
      </div>
      {view.kind === "progress" ? (
        <div className="mt-2">
          <div className="flex items-center gap-1">
            {COURIER_STEP_LABELS.map((label, i) => (
              <div key={label} className="flex flex-1 flex-col items-center gap-1">
                <div className={`h-1.5 w-full rounded-full shadow-sm ${i <= view.step ? "bg-gradient-to-r from-emerald-500 to-teal-400" : "bg-slate-200"}`} />
                <span className={`text-center text-[9px] leading-tight ${i === view.step ? "font-bold text-emerald-700" : "text-slate-400"}`}>{label}</span>
              </div>
            ))}
          </div>
          {view.partial ? <div className="mt-1 text-[11px] font-medium text-amber-600">আংশিক ডেলিভার্ড — কিছু পণ্য পৌঁছেছে (কুরিয়ারের স্ট্যাটাস: {shipment.status})</div> : null}
        </div>
      ) : view.kind === "returned" ? (
        <div className="mt-1.5 rounded-md bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700">↩️ পার্সেল রিটার্ন এসেছে (কুরিয়ারের স্ট্যাটাস: {shipment.status})</div>
      ) : view.kind === "cancelled" ? (
        <div className="mt-1.5 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-600">✖️ শিপমেন্ট বাতিল হয়েছে (কুরিয়ারের স্ট্যাটাস: {shipment.status})</div>
      ) : (
        <div className="mt-1.5 text-[11px] text-slate-500">কুরিয়ারের স্ট্যাটাস: <b>{shipment.status}</b></div>
      )}
      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
        <span>সর্বশেষ যাচাই: {shipment.lastCheckedAt ? new Date(shipment.lastCheckedAt).toLocaleString("bn-BD") : "এখনো যাচাই হয়নি"}</span>
        {shipment.codAmountMinor && Number(shipment.codAmountMinor) > 0 ? <span>COD: <b className="text-slate-600">{money(shipment.codAmountMinor, currency)}</b></span> : null}
      </div>
    </div>
  );
}
