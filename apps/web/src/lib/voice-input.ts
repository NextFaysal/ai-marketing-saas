"use client";
import { useEffect, useRef, useState } from "react";

/**
 * AP2 voice questions — browser speech recognition dictation for
 * the composers (Bengali + English). This is dictation only: the
 * transcript lands in the composer as editable text, nothing is
 * sent until the user presses send. Support is Chrome-family
 * (webkitSpeechRecognition); where unsupported the mic button
 * simply does not render — no fake fallback.
 */

export type VoiceLang = "bn-BD" | "en-US";

export function speechRecognitionCtor(): (new () => any) | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Pure: fold recognition results into final + interim text. */
export function joinVoiceResults(results: Array<{ isFinal: boolean; transcript: string }>): { finalText: string; interimText: string } {
  let finalText = "";
  let interimText = "";
  for (const r of results) {
    if (r.isFinal) finalText += r.transcript;
    else interimText += r.transcript;
  }
  return { finalText: finalText.trim(), interimText: interimText.trim() };
}

export function useVoiceInput(onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [lang, setLang] = useState<VoiceLang>("bn-BD");
  const recRef = useRef<any>(null);
  const baseRef = useRef("");
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => { setSupported(speechRecognitionCtor() !== null); }, []);
  useEffect(() => () => { try { recRef.current?.stop(); } catch { /* noop */ } }, []);

  function start(baseText: string) {
    const Ctor = speechRecognitionCtor();
    if (!Ctor || listening) return;
    const rec = new Ctor();
    baseRef.current = baseText;
    rec.lang = lang;
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (event: any) => {
      const results: Array<{ isFinal: boolean; transcript: string }> = [];
      for (let i = 0; i < event.results.length; i++) {
        results.push({ isFinal: Boolean(event.results[i].isFinal), transcript: event.results[i][0]?.transcript ?? "" });
      }
      const { finalText, interimText } = joinVoiceResults(results);
      const spoken = finalText || interimText;
      if (spoken) {
        const base = baseRef.current;
        onTextRef.current(base ? `${base.replace(/\s+$/, "")} ${spoken}` : spoken);
        if (finalText) baseRef.current = base ? `${base.replace(/\s+$/, "")} ${finalText}` : finalText;
      }
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch { setListening(false); }
  }

  function stop() {
    try { recRef.current?.stop(); } catch { /* noop */ }
    setListening(false);
  }

  return { supported, listening, lang, setLang, start, stop };
}
