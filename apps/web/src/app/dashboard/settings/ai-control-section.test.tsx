// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * SA-B13 (W4): the AI Control Center section against a mocked
 * engine API — the queue renders with plain-Bengali labels,
 * approve/reject hit the SA-B10 endpoints with the proposal id
 * and the notice reads the RETURNED row's outcome (a failed
 * execution is said plainly, a money approval is proposal-only),
 * the autonomy matrix PUTs levels with level 3 disabled (D5)
 * and the money badge present, and roles below the API gates
 * see no mutation controls.
 */

const calls: { path: string; method: string; body?: any }[] = [];
let myRole = "OWNER";

const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
const oneHourAgo = new Date(Date.now() - 60 * 60000).toISOString();

const catalog = [
  { id: "close_conversation", surface: "inbox", title: { bn: "কথোপকথন বন্ধ করা", en: "Close conversation" }, riskClass: "low", moneyAdjacent: false, executorKey: "close_conversation", verifierKey: "close_conversation", payloadSummary: "{}", undoable: false, wiring: "b10" },
  { id: "reply_to_comment", surface: "comment", title: { bn: "কমেন্টে উত্তর পোস্ট", en: "Post comment reply" }, riskClass: "medium", moneyAdjacent: false, executorKey: "reply_to_comment", verifierKey: "reply_to_comment", payloadSummary: "{}", undoable: false, wiring: "b12" },
  { id: "request_refund", surface: "inbox", title: { bn: "রিফান্ডের অনুরোধ", en: "Request refund" }, riskClass: "high", moneyAdjacent: true, executorKey: null, verifierKey: null, payloadSummary: "{}", undoable: false, wiring: "never" },
];

const autonomy = [
  { actionId: "close_conversation", surface: "inbox", title: { bn: "কথোপকথন বন্ধ করা", en: "Close conversation" }, riskClass: "low", moneyAdjacent: false, undoable: false, wiring: "b10", level: 2, levelIsDefault: false, updatedById: "u1", updatedAt: oneHourAgo },
  { actionId: "reply_to_comment", surface: "comment", title: { bn: "কমেন্টে উত্তর পোস্ট", en: "Post comment reply" }, riskClass: "medium", moneyAdjacent: false, undoable: false, wiring: "b12", level: 1, levelIsDefault: true, updatedById: null, updatedAt: null },
  { actionId: "request_refund", surface: "inbox", title: { bn: "রিফান্ডের অনুরোধ", en: "Request refund" }, riskClass: "high", moneyAdjacent: true, undoable: false, wiring: "never", level: 1, levelIsDefault: true, updatedById: null, updatedAt: null },
];

const pendingProposal = {
  id: "p-pending", actionId: "close_conversation", surface: "inbox", proposedBy: "ai", autonomyLevel: 1,
  conversationId: "conv-1", title: "কথোপকথন বন্ধের প্রস্তাব", preview: "অর্ডার সম্পন্ন হয়েছে — কথোপকথনটি বন্ধ করা হবে।",
  status: "proposed", decidedById: null, decidedAt: null, executedAt: null, result: null, error: null,
  createdAt: fiveMinAgo, updatedAt: fiveMinAgo,
};
const executedProposal = {
  id: "p-done", actionId: "close_conversation", surface: "inbox", proposedBy: "ai", autonomyLevel: 2,
  conversationId: "conv-2", title: "কথোপকথন বন্ধের প্রস্তাব", preview: "কথোপকথনটি বন্ধ করা হবে।",
  status: "executed", decidedById: "u1", decidedAt: oneHourAgo, executedAt: oneHourAgo,
  result: { outcome: "verified_success", note: "কথোপকথনটি বন্ধ অবস্থায় পাওয়া গেছে।" }, error: null,
  createdAt: oneHourAgo, updatedAt: oneHourAgo,
};
const failedProposal = {
  id: "p-failed", actionId: "assign_conversation", surface: "inbox", proposedBy: "staff", autonomyLevel: 1,
  conversationId: "conv-3", title: "কথোপকথন অ্যাসাইনের প্রস্তাব", preview: "কথোপকথনটি একজন এজেন্টকে দেওয়া হবে।",
  status: "failed", decidedById: "u1", decidedAt: oneHourAgo, executedAt: null,
  result: { outcome: "executor_error" }, error: "অ্যাসাইন করা ব্যক্তি এই Organization-এর সদস্য নন",
  createdAt: oneHourAgo, updatedAt: oneHourAgo,
};
const refundProposal = {
  id: "p-refund", actionId: "request_refund", surface: "inbox", proposedBy: "ai", autonomyLevel: 1,
  conversationId: "conv-4", title: "রিফান্ডের অনুরোধের প্রস্তাব", preview: "অর্ডার #1024-এর রিফান্ড অনুরোধ পাঠানো হবে।",
  status: "approved", decidedById: "u1", decidedAt: oneHourAgo, executedAt: null,
  result: { outcome: "proposal_only", note: "টাকা-সংক্রান্ত কাজ AI নিজে করে না।" }, error: null,
  createdAt: oneHourAgo, updatedAt: oneHourAgo,
};
const recent = [pendingProposal, executedProposal, failedProposal, refundProposal];

// SA-B25 (T4): fixtures for Item 1's two new endpoints. The
// mock router below was extended MINIMALLY for them (the
// usage + activity routes only) — every pre-existing route
// and assertion is unchanged.
let usageEstimatedCalls = 2;

const failedFeedEvent = {
  id: "proposal:failed:p-failed", kind: "proposal", event: "failed", at: oneHourAgo,
  title: "কথোপকথন অ্যাসাইনের প্রস্তাব", detail: "ডেলিভারি পার্টনার API সাড়া দেয়নি",
  sourceId: "p-failed", meta: { actionId: "assign_conversation" },
};
const learnedAdminEvent = {
  id: "learned:decided:l-admin", kind: "learned", event: "decided", at: oneHourAgo,
  title: "ডেলিভারি সময় নিয়ে শেখা", detail: null,
  sourceId: "l-admin", meta: { decision: "approved", reviewedVia: "admin_console", appliedRef: null },
};
const learnedStaffEvent = {
  id: "learned:decided:l-staff", kind: "learned", event: "decided", at: oneHourAgo,
  title: "দাম নিয়ে শেখা তথ্য", detail: null,
  sourceId: "l-staff", meta: { decision: "approved", reviewedVia: "org", appliedRef: null },
};
const contentFeedEvent = {
  id: "content:draft_created:c-1", kind: "content", event: "draft_created", at: fiveMinAgo,
  title: "ঈদ অফারের ক্যাপশন", detail: null,
  sourceId: "c-1", meta: { autoDraftRef: "ai_content:1", status: "draft" },
};

vi.mock("@/lib/org", () => ({ getOrganizationId: () => "org-1" }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(async (path: string, init: any = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    calls.push({ path, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (path === "/organizations") return [{ id: "org-1", myRole }];
    if (path.includes("/ai/activity/usage")) {
      return {
        days: 30, since: oneHourAgo,
        totals: { calls: 5, inputTokens: 1200, outputTokens: 300, estimatedCalls: usageEstimatedCalls },
        features: [
          { feature: "chat", calls: 3, inputTokens: 900, outputTokens: 200, estimatedCalls: 0 },
          { feature: "copilot", calls: 2, inputTokens: 300, outputTokens: 100, estimatedCalls: usageEstimatedCalls },
        ],
        daily: [],
      };
    }
    if (path.includes("/ai/activity")) {
      const kindMatch = path.match(/kind=(\w+)/);
      const offsetMatch = path.match(/offset=(\d+)/);
      const offset = offsetMatch ? Number(offsetMatch[1]) : 0;
      if (kindMatch?.[1] === "learned") {
        return { items: [learnedAdminEvent, learnedStaffEvent], total: 2, limit: 20, offset: 0, days: 30, kind: "learned" };
      }
      if (offset > 0) {
        return { items: [contentFeedEvent], total: 3, limit: 20, offset, days: 30, kind: null };
      }
      return { items: [failedFeedEvent, learnedAdminEvent], total: 3, limit: 20, offset: 0, days: 30, kind: null };
    }
    if (path.includes("/ai/actions/catalog")) return catalog;
    if (path.includes("/ai/actions/autonomy")) {
      if (method === "PUT") return { ok: true };
      return autonomy;
    }
    if (path.includes("/ai/actions/proposals")) {
      if (method === "POST" && path.endsWith("/approve")) {
        return { ...pendingProposal, status: "executed", result: { outcome: "verified_success" } };
      }
      if (method === "POST" && path.endsWith("/reject")) {
        return { ...pendingProposal, status: "rejected" };
      }
      if (path.includes("status=proposed")) return [pendingProposal];
      return recent;
    }
    return {};
  }),
}));

import { AiControlCenterSection } from "./ai-control-section";
import { LocaleProvider } from "@/lib/i18n/provider";

async function renderSection() {
  render(<LocaleProvider><AiControlCenterSection /></LocaleProvider>);
  await screen.findByText("কাজের প্রস্তাব — আপনার সিদ্ধান্তের অপেক্ষায়");
}

describe("AiControlCenterSection (SA-B13 W4)", () => {
  beforeEach(() => { calls.length = 0; myRole = "OWNER"; usageEstimatedCalls = 2; });
  afterEach(() => { cleanup(); });

  it("renders the pending queue with surface/action labels, proposer and age", async () => {
    await renderSection();
    expect(screen.getByText("AI নিয়ন্ত্রণ")).toBeTruthy();
    // (the same title also appears in the decided list below)
    expect(screen.getAllByText("কথোপকথন বন্ধের প্রস্তাব").length).toBeGreaterThan(0);
    expect(screen.getByText("অর্ডার সম্পন্ন হয়েছে — কথোপকথনটি বন্ধ করা হবে।")).toBeTruthy();
    expect(screen.getAllByText("ইনবক্স").length).toBeGreaterThan(0);
    expect(screen.getByText(/AI-এর প্রস্তাব/)).toBeTruthy();
    expect(screen.getByText(/৫ মিনিট আগে/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "অনুমোদন করুন" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "বাতিল করুন" })).toBeTruthy();
  });

  it("approve POSTs to the proposal's approve endpoint and the notice reads the returned executed row", async () => {
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "অনুমোদন করুন" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path === "/organizations/org-1/ai/actions/proposals/p-pending/approve")).toBe(true);
    });
    await waitFor(() => {
      // the notice plus the decided list's executed row carry the same wording
      expect(screen.getAllByText(/কার্যকর হয়েছে — কাজটি আসল পথে করা হয়েছে এবং ফলাফল যাচাই/).length).toBeGreaterThan(0);
    });
  });

  it("reject POSTs to the reject endpoint and says nothing was done", async () => {
    await renderSection();
    fireEvent.click(screen.getByRole("button", { name: "বাতিল করুন" }));
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.path === "/organizations/org-1/ai/actions/proposals/p-pending/reject")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/প্রস্তাবটি বাতিল করা হয়েছে — কিছুই করা হয়নি/)).toBeTruthy();
    });
  });

  it("decided proposals show their recorded outcomes plainly — failure reason verbatim, money approval as proposal-only", async () => {
    await renderSection();
    expect(screen.getByText(/কার্যকর করা যায়নি — কারণ: অ্যাসাইন করা ব্যক্তি এই Organization-এর সদস্য নন/)).toBeTruthy();
    expect(screen.getByText("অনুমোদিত (শুধু প্রস্তাব)")).toBeTruthy();
    expect(screen.getByText(/টাকা-সংক্রান্ত কাজ: AI নিজে এটি কার্যকর করে না/)).toBeTruthy();
    // activity counts come from the fetched window and are labelled as such
    expect(screen.getByText(/সর্বশেষ ৫০টি প্রস্তাবের ওপর ভিত্তি করে/)).toBeTruthy();
  });

  it("autonomy matrix: level change PUTs the level; level 3 is a disabled option; the money row carries its badge", async () => {
    await renderSection();
    const refundRow = screen.getByText("রিফান্ডের অনুরোধ").closest("li")!;
    expect(within(refundRow as HTMLElement).getByText("শুধু প্রস্তাব — AI নিজে করবে না")).toBeTruthy();
    expect(within(refundRow as HTMLElement).getByText(/যেকোনো মাত্রাতেই AI এটি নিজে কার্যকর করে না/)).toBeTruthy();

    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBe(3);
    const l3 = within(selects[0].closest("li") as HTMLElement).getByRole("option", { name: /স্তর ৩/ }) as HTMLOptionElement;
    expect(l3.disabled).toBe(true);

    fireEvent.change(selects[0], { target: { value: "0" } });
    await waitFor(() => {
      expect(calls.some((c) => c.method === "PUT" && c.path === "/organizations/org-1/ai/actions/autonomy/close_conversation" && c.body?.level === 0)).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByText(/মাত্রা বদলানো হয়েছে: বন্ধ/)).toBeTruthy();
    });
  });

  it("a role below the API gates sees no approve/reject buttons and no autonomy selects", async () => {
    myRole = "SUPPORT_AGENT";
    await renderSection();
    expect(screen.queryByRole("button", { name: "অনুমোদন করুন" })).toBeNull();
    expect(screen.queryByRole("button", { name: "বাতিল করুন" })).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.getByText(/সিদ্ধান্ত দেওয়ার অধিকার আপনার ভূমিকায় নেই/)).toBeTruthy();
    expect(screen.getByText(/মাত্রা বদলানোর অধিকার শুধু মালিক\/অ্যাডমিনের/)).toBeTruthy();
  });

  it("MARKETING_MANAGER may decide but may not change autonomy", async () => {
    myRole = "MARKETING_MANAGER";
    await renderSection();
    expect(screen.getByRole("button", { name: "অনুমোদন করুন" })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("SA-B25 usage block: feature labels + counts render, and the estimated note appears when estimatedCalls > 0", async () => {
    await renderSection();
    expect(screen.getByText("AI ব্যবহার")).toBeTruthy();
    expect(screen.getByText(/মোট AI কল: ৫/)).toBeTruthy();
    expect(screen.getByText("চ্যাট")).toBeTruthy();
    expect(screen.getByText("কোপাইলট")).toBeTruthy();
    expect(screen.getByText(/৩টি কল/)).toBeTruthy();
    expect(screen.getByText(/এর মধ্যে ২টি আনুমানিক হিসাবে \(ডেভ অ্যাডাপ্টার\)/)).toBeTruthy();
    expect(calls.some((c) => c.path === "/organizations/org-1/ai/activity/usage?days=30")).toBe(true);
  });

  it("SA-B25 usage block: no estimated note when estimatedCalls is 0; the 7-day toggle refetches usage only", async () => {
    usageEstimatedCalls = 0;
    await renderSection();
    expect(screen.getByText(/মোট AI কল: ৫/)).toBeTruthy();
    expect(screen.queryByText(/আনুমানিক হিসাবে/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "গত ৭ দিন" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path === "/organizations/org-1/ai/activity/usage?days=7")).toBe(true);
    });
  });

  it("SA-B25 activity feed: a failed proposal row shows its recorded error VERBATIM, and the total is the API's real total", async () => {
    await renderSection();
    expect(screen.getByText("AI কার্যকলাপ")).toBeTruthy();
    expect(screen.getByText(/মোট ৩টি ঘটনা \(গত ৩০ দিনে\)/)).toBeTruthy();
    expect(screen.getByText("কারণ: ডেলিভারি পার্টনার API সাড়া দেয়নি")).toBeTruthy();
    expect(screen.getByText("কার্যকর করা যায়নি")).toBeTruthy();
  });

  it("SA-B25 activity feed: an admin-console learned decision carries the badge; a staff decision does not; the kind chip refetches with kind=learned", async () => {
    await renderSection();
    expect(screen.getAllByText("প্ল্যাটফর্ম অ্যাডমিনের সিদ্ধান্ত").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "শেখা" }));
    await waitFor(() => {
      expect(calls.some((c) => c.path.includes("/ai/activity?kind=learned"))).toBe(true);
    });
    await screen.findByText("দাম নিয়ে শেখা তথ্য");
    // still exactly one badge — on the admin-decided row only
    expect(screen.getAllByText("প্ল্যাটফর্ম অ্যাডমিনের সিদ্ধান্ত").length).toBe(1);
    const staffRow = screen.getByText("দাম নিয়ে শেখা তথ্য").closest("li")!;
    expect(within(staffRow as HTMLElement).queryByText("প্ল্যাটফর্ম অ্যাডমিনের সিদ্ধান্ত")).toBeNull();
    const adminRow = screen.getByText("ডেলিভারি সময় নিয়ে শেখা").closest("li")!;
    expect(within(adminRow as HTMLElement).getByText("প্ল্যাটফর্ম অ্যাডমিনের সিদ্ধান্ত")).toBeTruthy();
  });

  it("SA-B25 activity feed: 'আরও দেখুন' appends page 2 and disappears when items reach the total", async () => {
    await renderSection();
    expect(screen.queryByText("ঈদ অফারের ক্যাপশন")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "আরও দেখুন" }));
    await screen.findByText("ঈদ অফারের ক্যাপশন");
    expect(calls.some((c) => c.path.includes("/ai/activity") && c.path.includes("offset=2"))).toBe(true);
    // page 1 rows are still there (appended, not replaced)
    expect(screen.getByText("কারণ: ডেলিভারি পার্টনার API সাড়া দেয়নি")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "আরও দেখুন" })).toBeNull();
  });
});
