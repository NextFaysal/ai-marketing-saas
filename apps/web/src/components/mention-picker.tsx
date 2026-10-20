"use client";
import React, { useEffect, useRef, useState } from "react";
import { MENTION_TYPE_ICON, type MentionItem } from "@/lib/mentions";
import { useLocale } from "@/lib/i18n/provider";

/**
 * G6 @-mention picker — sibling of the PromptPicker with the same
 * keyboard contract: while mounted it owns ArrowUp/ArrowDown/
 * Enter/Escape on a capture-phase window listener, so Enter picks
 * (never sends) and Escape dismisses the picker only. Results come
 * from the server's org-scoped mentions endpoint; the host fetches.
 */
export function MentionPicker({
  items,
  loading,
  onPick,
  onDismiss,
}: {
  items: MentionItem[];
  loading: boolean;
  onPick: (item: MentionItem) => void;
  onDismiss: () => void;
}) {
  const { dict } = useLocale();
  const S = dict.shared;
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActive(0); }, [items]);

  const itemsRef = useRef<MentionItem[]>(items);
  itemsRef.current = items;
  const activeRef = useRef(0);
  activeRef.current = active;
  const callbacksRef = useRef({ onPick, onDismiss });
  callbacksRef.current = { onPick, onDismiss };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const list = itemsRef.current;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        if (list.length === 0) return;
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setActive((cur) => (cur + delta + list.length) % list.length);
      } else if (e.key === "Enter") {
        const item = list[activeRef.current];
        if (!item) return;
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.onPick(item);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        callbacksRef.current.onDismiss();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="prompt-picker" role="listbox" aria-label={S.zzMnpAria}>
      <p className="px-3 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
        {S.zzMnpHeader}
      </p>
      <div ref={listRef} className="max-h-60 overflow-y-auto px-1.5 pb-1.5">
        {loading && items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-slate-400">{S.zzMnpSearching}</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-slate-400">{S.zzMnpEmpty}</p>
        ) : items.map((item, i) => (
          <div
            key={`${item.type}-${item.id}`}
            data-idx={i}
            role="option"
            aria-selected={i === active}
            className={`prompt-picker-row ${i === active ? "prompt-picker-row-active" : ""}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(item)}
          >
            <span aria-hidden="true">{MENTION_TYPE_ICON[item.type]}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-800">{item.label}</span>
              <span className="block truncate text-xs text-slate-400">{item.sub}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
