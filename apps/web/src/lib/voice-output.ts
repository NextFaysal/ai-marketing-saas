"use client";
import { useEffect, useRef, useState } from "react";

/**
 * AP7 voice-first mode — read answers aloud with the browser's
 * speech synthesis. Off by default; a per-surface toggle persisted
 * in localStorage. Speech is best-effort browser TTS (bn-BD when
 * the answer is Bengali, en-US otherwise); where synthesis is
 * unavailable the toggle simply does not render. Turning the
 * toggle off (or sending a new message) stops speech at once.
 */

export function speechSynthesisSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Pure: strip markdown so it is spoken, not spelled out. */
export function stripForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
}

export function langForText(text: string): string {
  return /[\u0980-\u09FF]/.test(text) ? "bn-BD" : "en-US";
}

export function speakText(text: string): boolean {
  if (!speechSynthesisSupported()) return false;
  const clean = stripForSpeech(text);
  if (!clean) return false;
  const synth = window.speechSynthesis;
  synth.cancel();
  const utter = new SpeechSynthesisUtterance(clean);
  utter.lang = langForText(clean);
  const voice = synth.getVoices().find((v) => v.lang?.toLowerCase().startsWith(utter.lang.slice(0, 2)));
  if (voice) utter.voice = voice;
  synth.speak(utter);
  return true;
}

export function cancelSpeech(): void {
  if (speechSynthesisSupported()) window.speechSynthesis.cancel();
}

export function useSpeechOutput(storageKey: string) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabledState] = useState(false);
  const lastSpokenRef = useRef<string | null>(null);

  useEffect(() => {
    setSupported(speechSynthesisSupported());
    try { setEnabledState(window.localStorage.getItem(storageKey) === "1"); } catch { /* private mode */ }
  }, [storageKey]);

  function setEnabled(on: boolean) {
    setEnabledState(on);
    try { window.localStorage.setItem(storageKey, on ? "1" : "0"); } catch { /* noop */ }
    if (!on) cancelSpeech();
  }

  /** Speak a completed assistant message once (id-deduped). */
  function speakOnce(messageId: string, text: string) {
    if (!enabled || lastSpokenRef.current === messageId) return;
    lastSpokenRef.current = messageId;
    speakText(text);
  }

  return { supported, enabled, setEnabled, speakOnce, cancel: cancelSpeech };
}
