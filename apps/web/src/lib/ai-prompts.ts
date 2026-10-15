"use client";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "./api";
import { getOrganizationId } from "./org";

/**
 * GV3 (G4) prompt library — shared by the Global Assistant panel
 * and the AI page.
 *
 * STARTER_PROMPTS is the canonical starter pack: exactly the nine
 * suggestions the AI page has always offered. The API planner spec
 * (apps/api/src/ai/planner.spec.ts) asserts each of these strings
 * plans at least one real tool call — keep the lists in sync.
 */
export const STARTER_PROMPTS: string[] = [
  "গত ৭ দিনে বিক্রি কেমন ছিল?",
  "আমার সবচেয়ে ভালো ক্যাম্পেইন কোনগুলো?",
  "কোন অর্ডারগুলোর ফলো-আপ দরকার?",
  "কোনো অস্বাভাবিক কিছু ঘটেছে কি?",
  "কোন পণ্যে সবচেয়ে বেশি লাভ হয়?",
  "কাস্টমার সেগমেন্টগুলো দেখাও",
  "স্টকের অবস্থা কেমন?",
  "কুরিয়ারদের পারফরম্যান্স কেমন?",
  "Which products have the best margin?",
];

export interface SavedPrompt {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface PickerItem {
  kind: "starter" | "saved";
  id: string; // starter body doubles as its id
  title: string;
  body: string;
  saved?: SavedPrompt;
}

/** Pure picker filtering: case-insensitive substring match over the
 *  title and body; an empty query lists everything, starters first. */
export function filterPrompts(starters: readonly string[], saved: readonly SavedPrompt[], query: string): PickerItem[] {
  const q = query.trim().toLowerCase();
  const hit = (title: string, body: string) => !q || title.toLowerCase().includes(q) || body.toLowerCase().includes(q);
  const items: PickerItem[] = [];
  for (const s of starters) {
    if (hit(s, s)) items.push({ kind: "starter", id: s, title: s, body: s });
  }
  for (const s of saved) {
    if (hit(s.title, s.body)) items.push({ kind: "saved", id: s.id, title: s.title, body: s.body, saved: s });
  }
  return items;
}

/**
 * The signed-in user's saved prompts (per-user on the server).
 * Loading is best-effort — a failure leaves an empty library, never
 * a broken composer. Mutations throw; callers surface the server's
 * message (e.g. the 50-prompt cap) in their own error area.
 */
export function useSavedPrompts() {
  const [saved, setSaved] = useState<SavedPrompt[]>([]);

  const reload = useCallback(async () => {
    const orgId = getOrganizationId();
    if (!orgId) return;
    try {
      setSaved(await apiFetch<SavedPrompt[]>(`/organizations/${orgId}/ai/prompts`));
    } catch { /* best-effort library */ }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const create = useCallback(async (title: string, body: string) => {
    const orgId = getOrganizationId();
    if (!orgId) throw new Error("Organization not selected");
    const row = await apiFetch<SavedPrompt>(`/organizations/${orgId}/ai/prompts`, {
      method: "POST",
      body: JSON.stringify({ title, body }),
    });
    setSaved((cur) => [row, ...cur]);
    return row;
  }, []);

  const rename = useCallback(async (id: string, title: string) => {
    const orgId = getOrganizationId();
    if (!orgId) throw new Error("Organization not selected");
    const row = await apiFetch<SavedPrompt>(`/organizations/${orgId}/ai/prompts/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    setSaved((cur) => cur.map((p) => (p.id === id ? row : p)));
    return row;
  }, []);

  const remove = useCallback(async (id: string) => {
    const orgId = getOrganizationId();
    if (!orgId) throw new Error("Organization not selected");
    await apiFetch(`/organizations/${orgId}/ai/prompts/${id}`, { method: "DELETE" });
    setSaved((cur) => cur.filter((p) => p.id !== id));
  }, []);

  return { saved, reload, create, rename, remove };
}
