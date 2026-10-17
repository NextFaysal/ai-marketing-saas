// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, Input, ResponsiveTable, Tabs } from "@repo/ui";
import { ConfirmProvider, Modal, ToastProvider, useConfirm, useToast } from "@repo/ui/client";

describe("Button", () => {
  it("primary renders btn-primary class", () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole("button", { name: "Save" });
    expect(btn.className).toContain("btn-primary");
  });

  it("danger contains from-red-600", () => {
    render(<Button variant="danger">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toContain("from-red-600");
  });

  it("size sm adds btn-sm", () => {
    render(<Button size="sm">Small</Button>);
    const btn = screen.getByRole("button", { name: "Small" });
    expect(btn.className).toContain("btn-sm");
  });

  it("loading renders spinner svg with animate-spin and disables button", () => {
    const { container } = render(
      <Button loading>Loading</Button>,
    );
    const btn = screen.getByRole("button", { name: /Loading/ });
    expect(btn).toHaveProperty("disabled", true);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("class") ?? "").toContain("animate-spin");
  });
});

describe("Input", () => {
  it("renders label text", () => {
    render(<Input label="ইমেইল" placeholder="email" />);
    expect(screen.getByText("ইমেইল")).toBeTruthy();
  });

  it("renders error text and control has border-red-400", () => {
    render(<Input label="নাম" error="নাম আবশ্যক" placeholder="name" />);
    expect(screen.getByText("নাম আবশ্যক")).toBeTruthy();
    const input = screen.getByPlaceholderText("name");
    expect(input.className).toContain("border-red-400");
  });
});

describe("Tabs", () => {
  it("clicking second tab calls onChange with its id and aria-selected reflects activeId", () => {
    const onChange = vi.fn();
    render(
      <Tabs
        tabs={[
          { id: "all", label: "সব" },
          { id: "active", label: "সক্রিয়" },
        ]}
        activeId="all"
        onChange={onChange}
      />,
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(tabs[1].getAttribute("aria-selected")).toBe("false");
    fireEvent.click(tabs[1]);
    expect(onChange).toHaveBeenCalledWith("active");
  });
});

describe("ResponsiveTable", () => {
  it("renders both regions with responsive visibility classes", () => {
    const { container } = render(
      <ResponsiveTable table={<div>TableContent</div>} cards={<div>CardContent</div>} />,
    );
    expect(screen.getByText("TableContent")).toBeTruthy();
    expect(screen.getByText("CardContent")).toBeTruthy();
    const wrappers = container.firstElementChild?.children;
    expect(wrappers).toBeTruthy();
    expect(wrappers![0].className).toContain("hidden");
    expect(wrappers![0].className).toContain("md:block");
    expect(wrappers![1].className).toContain("md:hidden");
  });
});

function ToastHarness() {
  const { toast } = useToast();
  return (
    <button
      type="button"
      onClick={() => toast({ title: "সংরক্ষিত হয়েছে", tone: "success", durationMs: 30 })}
    >
      Show toast
    </button>
  );
}

describe("Toast", () => {
  it("shows toast on click and auto-dismisses after duration", async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show toast" }));
    expect(screen.getByText("সংরক্ষিত হয়েছে")).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 90));
    });
    expect(screen.queryByText("সংরক্ষিত হয়েছে")).toBeNull();
  });
});

function ConfirmHarness() {
  const confirm = useConfirm();
  const [result, setResult] = React.useState<string>("");
  return (
    <div>
      <span>{result}</span>
      <button
        type="button"
        onClick={async () => {
          const v = await confirm({ title: "মুছে ফেলবেন?" });
          setResult(String(v));
        }}
      >
        Ask confirm
      </button>
    </div>
  );
}

describe("ConfirmDialog", () => {
  it("resolves true on confirm and false on cancel", async () => {
    render(
      <ConfirmProvider>
        <ConfirmHarness />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Ask confirm" }));
    expect(await screen.findByText("মুছে ফেলবেন?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "নিশ্চিত করুন" }));
    expect(await screen.findByText("true")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Ask confirm" }));
    expect(await screen.findByText("মুছে ফেলবেন?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "বাতিল" }));
    expect(await screen.findByText("false")).toBeTruthy();
  });
});

describe("Modal", () => {
  it("renders dialog when open and Escape closes via onClose", () => {
    const onClose = vi.fn();
    render(
      <Modal open onClose={onClose} title="শিরোনাম">
        <p>Modal body</p>
      </Modal>,
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Modal body")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
