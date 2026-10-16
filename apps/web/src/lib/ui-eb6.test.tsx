// @vitest-environment jsdom
// EB6/ED16 accessibility: focus trap + focus-in for the kit dialogs
// (Modal/Drawer via the shared useDialogChrome hook) and SkipLink.
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());
import { SkipLink } from "@repo/ui";
import { Drawer, Modal } from "@repo/ui/client";

function ModalHarness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        মডাল খুলুন
      </button>
      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        title="শিরোনাম"
      >
        <button type="button">মাঝের বোতাম</button>
        <button type="button">শেষ বোতাম</button>
      </Modal>
    </div>
  );
}

describe("Modal focus trap (EB6)", () => {
  it("moves focus inside on open, traps Tab both ways, Escape closes, focus returns on close", () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);

    const trigger = screen.getByRole("button", { name: "মডাল খুলুন" });
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog");
    const closeBtn = screen.getByRole("button", { name: "বন্ধ করুন" });
    const middleBtn = screen.getByRole("button", { name: "মাঝের বোতাম" });
    const lastBtn = screen.getByRole("button", { name: "শেষ বোতাম" });

    // Focus-in: focus lands inside the dialog (first focusable = close ✕).
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(closeBtn);
    expect(middleBtn).toBeTruthy();

    // Tab from the last focusable wraps to the first.
    lastBtn.focus();
    expect(document.activeElement).toBe(lastBtn);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(closeBtn);

    // Shift+Tab from the first focusable wraps to the last.
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastBtn);

    // Escape fires onClose.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Focus returns to the element focused before the dialog opened.
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Drawer focus-in (EB6)", () => {
  it("moves focus inside the drawer on open", () => {
    render(
      <Drawer open onClose={() => {}} title="ড্রয়ার">
        <button type="button">ভিতরের বোতাম</button>
      </Drawer>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe("SkipLink (EB6)", () => {
  it("renders an anchor with the given href, text and skip-link class", () => {
    render(<SkipLink href="#main-content">মূল কনটেন্টে যান</SkipLink>);
    const link = screen.getByRole("link", { name: "মূল কনটেন্টে যান" });
    expect(link.getAttribute("href")).toBe("#main-content");
    expect(link.className).toContain("skip-link");
  });
});
