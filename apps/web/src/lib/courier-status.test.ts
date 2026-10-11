import { describe, expect, it } from "vitest";
import { courierStatusView } from "./courier-status";

describe("courierStatusView (documented mapping, no guessing)", () => {
  it("maps the stored lifecycle onto the stepper", () => {
    expect(courierStatusView("in_review")).toMatchObject({ kind: "progress", step: 1 });
    expect(courierStatusView("pending")).toMatchObject({ kind: "progress", step: 1 });
    expect(courierStatusView("in_transit")).toMatchObject({ kind: "progress", step: 2 });
    expect(courierStatusView("out_for_delivery")).toMatchObject({ kind: "progress", step: 3 });
    expect(courierStatusView("delivered")).toMatchObject({ kind: "progress", step: 4, partial: false });
    expect(courierStatusView("created")).toMatchObject({ kind: "progress", step: 0 });
  });

  it("partial delivery reaches the final step but stays flagged partial", () => {
    expect(courierStatusView("partial_delivered")).toMatchObject({ kind: "progress", step: 4, partial: true });
  });

  it("returned / cancelled are terminal side states, not stepper steps", () => {
    expect(courierStatusView("returned")).toEqual({ kind: "returned" });
    expect(courierStatusView("cancelled")).toEqual({ kind: "cancelled" });
  });

  it("normalizes case and separators", () => {
    expect(courierStatusView("In Transit")).toMatchObject({ kind: "progress", step: 2 });
    expect(courierStatusView("OUT-FOR-DELIVERY")).toMatchObject({ kind: "progress", step: 3 });
  });

  it("anything unmapped is unknown — the courier's words stand alone", () => {
    expect(courierStatusView("hub_scan_42")).toEqual({ kind: "unknown" });
    expect(courierStatusView("")).toEqual({ kind: "unknown" });
    expect(courierStatusView(null)).toEqual({ kind: "unknown" });
    expect(courierStatusView(undefined)).toEqual({ kind: "unknown" });
  });
});
