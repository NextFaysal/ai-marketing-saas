"use client";
import React, { useEffect, useRef, useState } from "react";
import { shopT, type ShopLocale } from "@/lib/shop-i18n";
import { flashOffsetMs, flashRemainingMs, formatCountdown } from "@/lib/shop-flash";

/**
 * GB7 (GC18) — flash-sale countdown on the SERVER clock.
 * The serverNow→client offset is captured once at mount; the
 * component then ticks locally every second and disappears the
 * moment the sale ends (remaining <= 0 renders nothing).
 */
export function FlashCountdown({
  endsAt,
  serverNow,
  locale,
  compact = false,
}: {
  endsAt: string;
  serverNow?: string | null;
  locale?: ShopLocale | string;
  compact?: boolean;
}) {
  const offsetRef = useRef<number | null>(null);
  if (offsetRef.current === null) {
    offsetRef.current = serverNow ? flashOffsetMs(serverNow, Date.now()) : 0;
  }
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remaining = flashRemainingMs(endsAt, offsetRef.current, nowMs);
  if (remaining <= 0) return null;

  const t = shopT(locale);
  const clock = formatCountdown(remaining);
  if (compact) {
    return <span className="font-mono font-bold tabular-nums">⏰ {clock}</span>;
  }
  return (
    <span className="font-bold tabular-nums">
      ⚡ {t.home.flashSale} — {t.home.flashEndsIn} <span className="font-mono">{clock}</span>
    </span>
  );
}
