// @vitest-environment jsdom
// EB5/ED13 — orders decomposition smoke tests. The four panels extracted
// verbatim out of orders/page.tsx must (a) render nothing while closed
// (the exact pre-extraction conditional behaviour) and (b) mount their
// dialog shell when open, with inert props — no API calls happen on
// render in any of them (all fetching lives in the page's handlers).
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/lib/i18n/provider";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitDialog } from "../app/dashboard/orders/components/SplitDialog";
import { MergeDialog } from "../app/dashboard/orders/components/MergeDialog";
import { NotificationSettingsPanel, type NotificationSettingsPanelProps } from "../app/dashboard/orders/components/NotificationSettingsPanel";
import { FraudSettingsPanel, type FraudSettingsPanelProps } from "../app/dashboard/orders/components/FraudSettingsPanel";
import { EMPTY_FRAUD_RULE_DRAFT } from "./orders-gb3";
import type { PanelOrder } from "../app/dashboard/orders/components/types";

afterEach(() => cleanup());

const noop = vi.fn();
const noopAsync = vi.fn(async () => undefined);
const setter = <T,>(): React.Dispatch<React.SetStateAction<T>> => vi.fn() as React.Dispatch<React.SetStateAction<T>>;

const ORDER: PanelOrder = {
  id: "ord_1",
  status: "processing",
  isCod: true,
  totalMinor: "125000",
  items: [{ id: "it_1", name: "শাড়ি", quantity: 2, totalMinor: "125000" }],
} as PanelOrder;

const splitProps = {
  splitError: "",
  splitNotice: "",
  splitCreated: null,
  splitQty: {},
  setSplitQty: setter<Record<string, string>>(),
  splitBundles: [],
  setSplitBundles: setter<string[]>(),
  splitDeliveryTaka: "0",
  setSplitDeliveryTaka: setter<string>(),
  splitBusy: false,
  setSplitOpen: setter<boolean>(),
  doSplit: noopAsync,
  openOrderById: noopAsync,
};

const mergeProps = {
  setMergeOpen: setter<boolean>(),
  mergeError: "",
  items: [ORDER],
  selected: ["ord_1"],
  mergeSurvivor: "",
  setMergeSurvivor: setter<string>(),
  fmtM: (m?: string | null) => `৳${m ?? "0"}`,
  mergeBusy: false,
  doMerge: noopAsync,
};

const notifProps = {
  setNotifPanelOpen: setter<boolean>(),
  notifPanelError: "",
  notifPanelNotice: "",
  notifConfig: null,
  setNotifConfig: vi.fn() as unknown as NotificationSettingsPanelProps["setNotifConfig"],
  notifPanelBusy: "",
  toggleNotifChannel: noop,
  saveNotifSettings: noopAsync,
};

const fraudProps = {
  setFraudPanelOpen: setter<boolean>(),
  fraudPanelError: "",
  fraudPanelNotice: "",
  fraudSettings: null,
  setFraudSettings: vi.fn() as unknown as FraudSettingsPanelProps["setFraudSettings"],
  fraudHighTaka: "",
  setFraudHighTaka: setter<string>(),
  fraudPanelBusy: "",
  saveFraudSettings: noopAsync,
  blockForm: { phone: "", reason: "" },
  setBlockForm: setter<{ phone: string; reason: string }>(),
  blockedPhones: [],
  addBlockedPhone: noopAsync,
  deleteBlockedPhone: noopAsync,
  identTab: "phone" as const,
  setIdentTab: setter<"phone" | "blocked" | "trusted">(),
  blockedIdents: [],
  trustedIdents: [],
  blockedIdentForm: { kind: "email", value: "", reason: "" },
  setBlockedIdentForm: setter<{ kind: string; value: string; reason: string }>(),
  trustedForm: { kind: "phone", value: "", reason: "" },
  setTrustedForm: setter<{ kind: string; value: string; reason: string }>(),
  addBlockedIdent: noopAsync,
  deleteBlockedIdent: noopAsync,
  addTrustedIdent: noopAsync,
  deleteTrustedIdent: noopAsync,
  turnstileSecret: "",
  setTurnstileSecret: setter<string>(),
  fraudAttempts: [],
  fraudRules: [],
  ruleDraft: EMPTY_FRAUD_RULE_DRAFT,
  setRuleDraft: setter<typeof EMPTY_FRAUD_RULE_DRAFT>(),
  createFraudRule: noopAsync,
  toggleFraudRule: noopAsync,
  deleteFraudRule: noopAsync,
};

describe("orders extraction smoke (ED13)", () => {
  it("all four panels render nothing while closed", () => {
    const { container } = render(
      <LocaleProvider>
        <SplitDialog splitOpen={false} actOrder={null} {...splitProps} />
        <MergeDialog mergeOpen={false} {...mergeProps} />
        <NotificationSettingsPanel notifPanelOpen={false} {...notifProps} />
        <FraudSettingsPanel fraudPanelOpen={false} {...fraudProps} />
      </LocaleProvider>,
    );
    expect(container.textContent).toBe("");
  });

  it("SplitDialog mounts its dialog shell when open with an order", () => {
    render(<LocaleProvider><SplitDialog splitOpen actOrder={ORDER} {...splitProps} /></LocaleProvider>);
    expect(screen.getByRole("dialog", { name: /অর্ডার Split/ })).toBeTruthy();
    expect(screen.getByText(/শাড়ি/)).toBeTruthy();
  });

  it("MergeDialog mounts when open and lists the selected order", () => {
    render(<LocaleProvider><MergeDialog mergeOpen {...mergeProps} /></LocaleProvider>);
    expect(screen.getByText(/অর্ডার মার্জ করুন/)).toBeTruthy();
  });

  it("NotificationSettingsPanel mounts its shell when open", () => {
    render(<LocaleProvider><NotificationSettingsPanel notifPanelOpen {...notifProps} /></LocaleProvider>);
    expect(screen.getByRole("dialog", { name: /বিজ্ঞপ্তি সেটিংস/ })).toBeTruthy();
  });

  it("FraudSettingsPanel mounts its shell when open", () => {
    render(<LocaleProvider><FraudSettingsPanel fraudPanelOpen {...fraudProps} /></LocaleProvider>);
    expect(screen.getAllByText(/Fraud Shield|জালিয়াতি/).length).toBeGreaterThan(0);
  });
});
