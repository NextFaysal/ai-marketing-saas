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
    <div className="w-72 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
      <div className="grid max-h-52 grid-cols-8 gap-0.5 overflow-y-auto">
        {EMOJIS.map((e) => (
          <button
            key={e}
            type="button"
            className="rounded-lg p-1 text-lg leading-none hover:bg-slate-100"
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
        <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-600">
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
