"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { STARTER_PROMPTS, filterPrompts, type PickerItem, type SavedPrompt } from "@/lib/ai-prompts";

/**
 * GV3 (G4) "/" prompt picker — shared by the Global Assistant panel
 * and the AI page composer. Rendered by the host when the composer
 * text starts with "/"; the text after "/" is the filter query.
 *
 * Keyboard contract: while mounted, the picker owns ArrowUp /
 * ArrowDown / Enter / Escape on a capture-phase window listener, so
 * Enter picks instead of sending and Escape dismisses the picker
 * without closing the panel (the panel's own Esc handler is
 * bubble-phase and never sees the event). Picking inserts the body
 * into the composer — it never sends by itself.
 */
export function PromptPicker({
  saved,
  query,
  onPick,
  onDismiss,
  onRenameSaved,
  onDeleteSaved,
}: {
  saved: SavedPrompt[];
  query: string;
  onPick: (body: string) => void;
  onDismiss: () => void;
  onRenameSaved: (p: SavedPrompt) => void;
  onDeleteSaved: (p: SavedPrompt) => void;
}) {
  const items = useMemo(() => filterPrompts(STARTER_PROMPTS, saved, query), [saved, query]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setActive(0); }, [query, items.length]);

  const itemsRef = useRef<PickerItem[]>(items);
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
        callbacksRef.current.onPick(item.body);
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
    <div className="prompt-picker" role="listbox" aria-label="Prompt লাইব্রেরি">
      <p className="px-3 pb-1 pt-2.5 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
        Prompt লাইব্রেরি — ↑↓ বেছে Enter চাপুন
      </p>
      <div ref={listRef} className="max-h-60 overflow-y-auto px-1.5 pb-1.5">
        {items.length === 0 ? (
          <p className="px-2 py-3 text-sm text-slate-400">কোনো prompt মেলেনি</p>
        ) : items.map((item, i) => (
          <div
            key={`${item.kind}-${item.id}`}
            data-idx={i}
            role="option"
            aria-selected={i === active}
            className={`prompt-picker-row ${i === active ? "prompt-picker-row-active" : ""}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(item.body)}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-800">{item.title}</span>
              {item.kind === "saved" && item.title !== item.body ? (
                <span className="block truncate text-xs text-slate-400">{item.body}</span>
              ) : null}
            </span>
            {item.kind === "starter" ? (
              <span className="badge badge-slate shrink-0">Starter</span>
            ) : (
              <span className="flex shrink-0 gap-1">
                <button
                  type="button"
                  className="ai3-act-btn"
                  title="নাম বদলান"
                  onClick={(e) => { e.stopPropagation(); if (item.saved) onRenameSaved(item.saved); }}
                >✎</button>
                <button
                  type="button"
                  className="ai3-act-btn ai3-act-btn-danger"
                  title="মুছে ফেলুন"
                  onClick={(e) => { e.stopPropagation(); if (item.saved) onDeleteSaved(item.saved); }}
                >🗑</button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
