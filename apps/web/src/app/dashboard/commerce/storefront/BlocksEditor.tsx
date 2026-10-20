"use client";
import React, { useState } from "react";
import { useLocale } from "@/lib/i18n/provider";

// AB6: shared block editor — extracted from the content-pages
// manager so the blog editor uses exactly the same block UI.
// The parent owns the blocks state and any save-time cleaning;
// this component only edits the array in place (via onChange).

export interface EditableBlock { type: string; data: Record<string, any> }

export const BLOCK_TYPES = ["heading", "paragraph", "list", "faq", "image", "contact_info"] as const;
export const BLOCK_LABEL: Record<string, string> = {
  heading: "title",
  paragraph: "paragraph",
  list: "list",
  faq: "fAQ",
  image: "image",
  contact_info: "contactInformation",
};

export function defaultBlockData(type: string): Record<string, any> {
  switch (type) {
    case "heading": return { text: "", level: 2 };
    case "paragraph": return { text: "" };
    case "list": return { items: [] };
    case "faq": return { items: [] };
    case "image": return { url: "", alt: "" };
    default: return {};
  }
}

/** Normalize a stored block ({type,data} or legacy flat fields) into the editor shape. */
export function normalizeBlock(b: unknown): EditableBlock {
  const raw = (b ?? {}) as Record<string, any>;
  const data = raw.data && typeof raw.data === "object"
    ? { ...raw.data }
    : Object.fromEntries(Object.entries(raw).filter(([k]) => k !== "type"));
  return { type: String(raw.type ?? ""), data };
}

/** Save-time cleaning shared by pages + blog (list/faq items). */
export function cleanBlocks(blocks: EditableBlock[]): EditableBlock[] {
  return blocks.map((b) => {
    if (b.type === "list") {
      return { ...b, data: { ...b.data, items: (Array.isArray(b.data.items) ? b.data.items : []).map((x: any) => String(x).trim()).filter(Boolean) } };
    }
    if (b.type === "faq") {
      return { ...b, data: { ...b.data, items: (Array.isArray(b.data.items) ? b.data.items : []).filter((it: any) => (it.q ?? "").trim() || (it.a ?? "").trim()) } };
    }
    return b;
  });
}

export function BlocksEditor({
  blocks,
  onChange,
}: {
  blocks: EditableBlock[];
  onChange: (next: EditableBlock[]) => void;
}) {
  const { dict, t, locale } = useLocale();
  // Block drag-reorder state (same pattern as landing sections).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  function patchBlockData(idx: number, patch: Record<string, any>) {
    onChange(blocks.map((b, i) => (i === idx ? { ...b, data: { ...b.data, ...patch } } : b)));
  }
  function moveBlock(idx: number, dir: -1 | 1) {
    const next = [...blocks];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    onChange(next);
  }
  function reorderBlocks(from: number, to: number) {
    if (from === to) return;
    if (from < 0 || to < 0 || from >= blocks.length || to >= blocks.length) return;
    const next = [...blocks];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  }
  function addBlock(type: string) {
    onChange([...blocks, { type, data: defaultBlockData(type) }]);
  }
  function deleteBlock(idx: number) {
    onChange(blocks.filter((_, i) => i !== idx));
  }

  function blockFields(block: EditableBlock, idx: number) {
    const d = block.data ?? {};
    switch (block.type) {
      case "heading":
        return (
          <div className="grid gap-3 md:grid-cols-[1fr_140px]">
            <label className="block text-sm">{dict.commerce.text}<input className="input mt-1" value={d.text ?? ""} onChange={(e) => patchBlockData(idx, { text: e.target.value })} placeholder={dict.commerce.headingText} />
            </label>
            <label className="block text-sm">{dict.commerce.level}<select className="input mt-1" value={String(d.level ?? 2)} onChange={(e) => patchBlockData(idx, { level: Number(e.target.value) })}>
                <option value="1">{dict.commerce.h1Biggest}</option>
                <option value="2">{dict.commerce.h2Medium}</option>
                <option value="3">{dict.commerce.h3Small}</option>
              </select>
            </label>
          </div>
        );
      case "paragraph":
        return (
          <label className="block text-sm">{dict.commerce.text}<textarea className="input mt-1" rows={4} value={d.text ?? ""} onChange={(e) => patchBlockData(idx, { text: e.target.value })} placeholder={dict.commerce.paragraphText} />
          </label>
        );
      case "list": {
        const items: string[] = Array.isArray(d.items) ? d.items : [];
        return (
          <label className="block text-sm">{dict.commerce.itemsOnePerLine}<textarea className="input mt-1" rows={4} value={items.join("\n")}
              onChange={(e) => patchBlockData(idx, { items: e.target.value.split("\n") })}
              placeholder={dict.commerce.firstItemSecondItem} />
          </label>
        );
      }
      case "faq": {
        const items: { q: string; a: string }[] = Array.isArray(d.items) ? d.items : [];
        return (
          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={i} className="flex flex-wrap items-start gap-2">
                <input className="input flex-1" placeholder={dict.commerce.question} value={it.q ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, q: e.target.value } : x));
                  patchBlockData(idx, { items: next });
                }} />
                <input className="input flex-[2]" placeholder={dict.commerce.answer} value={it.a ?? ""} onChange={(e) => {
                  const next = items.map((x, j) => (j === i ? { ...x, a: e.target.value } : x));
                  patchBlockData(idx, { items: next });
                }} />
                <button type="button" className="rounded-lg border px-2 py-2 text-xs font-semibold text-rose-600"
                  onClick={() => patchBlockData(idx, { items: items.filter((_, j) => j !== i) })}>{dict.commerce.delete}</button>
              </div>
            ))}
            <button type="button" className="rounded-lg border px-3 py-1.5 text-xs font-semibold"
              onClick={() => patchBlockData(idx, { items: [...items, { q: "", a: "" }] })}>
              {dict.commerce.addQA}</button>
          </div>
        );
      }
      case "image":
        return (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">{dict.commerce.imageURL}<input className="input mt-1" value={d.url ?? ""} onChange={(e) => patchBlockData(idx, { url: e.target.value })} placeholder="https://…" />
            </label>
            <label className="block text-sm">{dict.commerce.altText}<input className="input mt-1" value={d.alt ?? ""} onChange={(e) => patchBlockData(idx, { alt: e.target.value })} placeholder={dict.commerce.imageDescription} />
            </label>
          </div>
        );
      case "contact_info":
        return <p className="text-xs text-slate-500">{dict.commerce.willBeShownAutomaticallyFrom}</p>;
      default:
        return <p className="text-xs text-slate-400">{dict.commerce.unknownBlockType}{block.type}</p>;
    }
  }

  return (
    <div className="space-y-3">
      {blocks.length === 0 ? (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">{dict.commerce.noBlocksYetAddFrom}</p>
      ) : blocks.map((b, idx) => (
        <div key={idx}
          draggable
          onDragStart={(e) => { setDragIdx(idx); e.dataTransfer.effectAllowed = "move"; }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (dragOverIdx !== idx) setDragOverIdx(idx); }}
          onDragLeave={() => { if (dragOverIdx === idx) setDragOverIdx(null); }}
          onDrop={(e) => { e.preventDefault(); if (dragIdx !== null) reorderBlocks(dragIdx, idx); setDragIdx(null); setDragOverIdx(null); }}
          onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
          className={`rounded-xl border p-4 ${dragIdx === idx ? "opacity-50" : "bg-white"} ${dragOverIdx === idx && dragIdx !== null && dragIdx !== idx ? "border-indigo-400 bg-indigo-50 ring-2 ring-indigo-300" : ""}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <span className="cursor-grab select-none text-slate-400" title={dict.commerce.dragToReorder} aria-label={dict.commerce.dragToReorder}>⠿</span>
              {BLOCK_LABEL[b.type] ? dict.commerce[BLOCK_LABEL[b.type] as keyof typeof dict.commerce] : b.type}
            </div>
            <div className="flex gap-1.5">
              <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-40" disabled={idx === 0} onClick={() => moveBlock(idx, -1)}>{dict.commerce.up}</button>
              <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold disabled:opacity-40" disabled={idx === blocks.length - 1} onClick={() => moveBlock(idx, 1)}>{dict.commerce.down}</button>
              <button type="button" className="rounded-lg border bg-white px-2 py-1 text-xs font-semibold text-rose-600" onClick={() => deleteBlock(idx)}>{dict.commerce.delete}</button>
            </div>
          </div>
          <div className="mt-3">{blockFields(b, idx)}</div>
        </div>
      ))}
      <div>
        <div className="text-sm font-medium">{dict.commerce.addBlock}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {BLOCK_TYPES.map((t) => (
            <button key={t} type="button" onClick={() => addBlock(t)} className="rounded-lg border bg-white px-3 py-1.5 text-xs font-semibold">
              + {dict.commerce[BLOCK_LABEL[t] as keyof typeof dict.commerce]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
