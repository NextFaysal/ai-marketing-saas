"use client";
/**
 * G6 @-mentions — shared by the Global Assistant panel and the AI
 * page. The picker searches the server's org-scoped mentions
 * endpoint; picking inserts a visible "@label" token into the
 * composer and records a structured {type, id} ref that rides with
 * the next send. The server loads the record's facts itself — the
 * client never supplies facts.
 */
export interface MentionItem {
  type: "order" | "customer" | "product" | "campaign";
  id: string;
  label: string;
  sub: string;
}

export interface MentionRef {
  type: MentionItem["type"];
  id: string;
  label: string;
}

export const MENTION_TYPE_ICON: Record<MentionItem["type"], string> = {
  order: "🧾",
  customer: "👤",
  product: "📦",
  campaign: "📣",
};

/**
 * The trailing "@query" token of the composer text, if the user is
 * in the middle of typing one: an "@" at the start or after
 * whitespace, with no whitespace since. Returns the query (possibly
 * empty right after "@") and the token's start index.
 */
export function mentionQueryOf(input: string): { query: string; start: number } | null {
  const m = /(?:^|\s)@([^\s@]{0,40})$/.exec(input);
  if (!m) return null;
  return { query: m[1], start: input.length - m[1].length - 1 };
}

/** Replace the trailing @query token with "@<label> " for display. */
export function applyMention(input: string, item: MentionItem): string {
  const found = mentionQueryOf(input);
  if (!found) return input;
  return `${input.slice(0, found.start)}@${item.label} `;
}

import { useEffect, useState } from "react";
import { apiFetch } from "./api";
import { getOrganizationId } from "./org";

/**
 * Debounced mention search against the org-scoped endpoint.
 * Best-effort: a failed search shows an empty picker, never an
 * error in the composer. Pass query=null to disable.
 */
export function useMentionSearch(query: string | null): { items: MentionItem[]; loading: boolean } {
  const [items, setItems] = useState<MentionItem[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (query === null || query.trim().length < 1) { setItems([]); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    const t = setTimeout(() => {
      const orgId = getOrganizationId();
      if (!orgId) { if (alive) { setItems([]); setLoading(false); } return; }
      apiFetch<MentionItem[]>(`/organizations/${orgId}/ai/mentions?q=${encodeURIComponent(query.trim())}`)
        .then((rows) => { if (alive) { setItems(Array.isArray(rows) ? rows : []); setLoading(false); } })
        .catch(() => { if (alive) { setItems([]); setLoading(false); } });
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query]);
  return { items, loading };
}
