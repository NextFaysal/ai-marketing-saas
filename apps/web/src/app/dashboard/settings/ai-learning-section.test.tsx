// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SA-B6 (P9): the Learn Dashboard section against a mocked API —
 * it must render the brain-overview aggregates as-is, wire every
 * control to the endpoint the API discipline expects (toggles to
 * the business-profile PATCH, review actions to learning-items,
 * answer toggles to answer-store), and offer NO re-activate path
 * for an invalidated answer.
 */

const calls: { path: string; method: string; body?: any }[] = [];

const overview = {
  organizationId: "org-1",
  knowledge: { total: 3, public: 2, internal: 1, websitePages: 1 },
  embeddings: { available: true, reason: null, provider: "openai", model: "text-embedding-3-small", indexedChunks: 12, indexedProducts: 4, retrievalMode: "hybrid" },
  answers: { active: 2, invalidated: 1, disabled: 0, total: 3, totalHits: 7 },
  learning: {
    pendingSuggestions: 1,
    toggles: { conversationLearningEnabled: false, websiteLearningEnabled: true, websiteUrl: "https://shop.example.com" },
    sources: {
      website: { lastRunAt: "2026-10-12T00:00:00Z", lastStatus: "ok", reason: null },
      conversation: null,
      performance: null,
    },
  },
  performance: { lastSnapshotAt: "2026-10-16T00:00:00Z", periodStart: "2026-10-10T00:00:00Z", periodEnd: "2026-10-17T00:00:00Z" },
  brandVoice: { status: "suggested", hasPendingSuggestion: false },
  customerMemories: { count: 1 },
  unanswered: { open: 1 },
  coverage: {
    percent: 88,
    areas: [
      { key: "profile", present: true }, { key: "policies", present: true },
      { key: "knowledge", present: true }, { key: "products", present: true },
      { key: "website", present: true }, { key: "answers", present: true },
      { key: "brandVoice", present: false }, { key: "customerMemory", present: true },
    ],
    gaps: ["brandVoice"],
  },
};

vi.mock("@/lib/org", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init: any = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (path === "/organizations") return [{ id: "org-1", myRole: "OWNER" }];
    if (path.includes("/brain-overview")) return overview;
    if (path.includes("/knowledge-documents")) {
      if (method === "GET") return [{ id: "doc-2", title: "ভেতরের নোট", content: "গোপন", kind: "note", visibility: "internal", source: "paste" }];
      return {};
    }
    if (path.includes("/learning-items")) {
      if (method === "GET") return { items: [{ id: "li-1", kind: "faq_pair", sourceType: "conversation", title: "ডেলিভারি প্রশ্ন", content: { question: "ডেলিভারি কত দিন?", answer: "২-৩ দিন।" }, status: "suggested", createdAt: "2026-10-15T00:00:00Z" }], total: 1 };
      return {};
    }
    if (path.includes("/answer-store")) {
      if (method === "GET") return {
        items: [
          { id: "ans-1", question: "ডেলিভারি চার্জ কত?", answerPreview: "ঢাকার ভিতরে ৬০ টাকা।", channel: "inbox", origin: "autopilot_grounded", status: "active", invalidReason: null, hitCount: 5, updatedAt: "2026-10-10T00:00:00Z" },
          { id: "ans-2", question: "দাম কত?", answerPreview: "৫০০ টাকা।", channel: "inbox", origin: "staff_edited", status: "invalidated", invalidReason: "product_changed", hitCount: 3, updatedAt: "2026-10-10T00:00:00Z" },
        ],
        total: 2,
      };
      return {};
    }
    if (path.includes("/brand-voice")) {
      if (method === "GET") return { status: "suggested", traits: { formality: "friendly", emojiUse: "light", languageMix: "bn", avgSentence: "short" }, pendingTraits: null };
      return {};
    }
    if (path.includes("/unanswered")) {
      if (method === "GET") return [{ id: "uq-1", questionText: "ওয়ারেন্টি কত দিন?", reason: "knowledge_gap", count: 3, status: "open" }];
      return {};
    }
    if (path.includes("/customer-memories")) {
      if (method === "GET") return { items: [{ id: "mem-1", customerKey: "whatsapp:111", displayName: "Rahim", languagePref: "bn", orderCount: 2, lastInteractionAt: "2026-10-11T00:00:00Z" }], total: 1 };
      return { deleted: true };
    }
    if (path.includes("/business-profile")) return {};
    return {};
  }),
}));

import { AiLearningSection } from "./ai-learning-section";

async function renderSection() {
  render(<AiLearningSection />);
  await screen.findByText("জ্ঞানের আওতা: 88%");
}

describe("AiLearningSection (SA-B6 P9)", () => {
  beforeEach(() => { calls.length = 0; });
  afterEach(() => { cleanup(); });

  it("renders the overview aggregates and source states honestly", async () => {
    await renderSection();
    expect(screen.getByText("AI শিখন")).toBeTruthy();
    expect(screen.getByText(/মোট 7 বার/)).toBeTruthy();
    expect(screen.getByText(/এখনো চালানো হয়নি/)).toBeTruthy();
    expect(screen.getByText(/পরের ধাপে আসছে/)).toBeTruthy();
    expect(screen.getByText("ওয়ারেন্টি কত দিন?")).toBeTruthy();
    expect(screen.getByText("Rahim")).toBeTruthy();
    // brand voice suggestion traits rendered in plain language
    expect(screen.getByText("বন্ধুসুলভ ভঙ্গিতে কথা বলে")).toBeTruthy();
  });

  it("conversation-learning toggle PATCHes the business profile", async () => {
    await renderSection();
    const row = screen.getByText("কথোপকথন (Inbox)").closest("li")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "চালু করুন" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "PATCH" && c.path === "/organizations/org-1/business-profile" && c.body?.conversationLearningEnabled === true)).toBe(true);
    });
  });

  it("knowledge visibility toggle PATCHes the document", async () => {
    await renderSection();
    const row = screen.getByText("ভেতরের নোট").closest("li")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "সবার জন্য করুন" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "PATCH" && c.path === "/organizations/org-1/knowledge-documents/doc-2" && c.body?.visibility === "public")).toBe(true);
    });
  });

  it("approve posts to learning-items with no visibility for a faq_pair", async () => {
    await renderSection();
    const row = screen.getByText("ডেলিভারি প্রশ্ন").closest("li")!;
    fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "অনুমোদন করুন" }));
    await waitFor(() => {
      const call = calls.find((c) => c.method === "POST" && c.path === "/organizations/org-1/learning-items/li-1/approve");
      expect(call).toBeTruthy();
      expect(call!.body).toEqual({});
    });
  });

  it("SA-B13: the Answer Store switch PATCHes the business profile (fixture predates storeEnabled → treated as on)", async () => {
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "ভান্ডার বন্ধ করুন" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "PATCH" && c.path === "/organizations/org-1/business-profile" && c.body?.answerStoreEnabled === false)).toBe(true);
    });
  });

  it("answer disable PATCHes the store; an invalidated answer shows its reason and NO enable button", async () => {
    await renderSection();
    const activeRow = screen.getByText("ডেলিভারি চার্জ কত?").closest("li")!;
    fireEvent.click(within(activeRow as HTMLElement).getByRole("button", { name: "বন্ধ করুন" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "PATCH" && c.path === "/organizations/org-1/answer-store/ans-1" && c.body?.status === "disabled")).toBe(true);
    });
    const invalidRow = screen.getByText("দাম কত?").closest("li")!;
    expect(within(invalidRow as HTMLElement).getByText(/বাতিলের কারণ/)).toBeTruthy();
    expect(within(invalidRow as HTMLElement).queryByRole("button", { name: "চালু করুন" })).toBeNull();
  });
});
