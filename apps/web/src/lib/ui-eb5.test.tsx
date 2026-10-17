// @vitest-environment jsdom
// EB5 kit additions: Breadcrumb (server entry) + PromptProvider/usePrompt
// (client entry, the window.prompt replacement used by ED14).
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(() => cleanup());
import { Breadcrumb } from "@repo/ui";
import { PromptProvider, usePrompt } from "@repo/ui/client";

describe("Breadcrumb", () => {
  it("renders links for ancestors and aria-current on the last item", () => {
    render(
      <Breadcrumb
        items={[
          { label: "ড্যাশবোর্ড", href: "/dashboard" },
          { label: "কমার্স", href: "/dashboard/commerce" },
          { label: "গিফট কার্ড" },
        ]}
      />,
    );
    expect(screen.getByRole("link", { name: "ড্যাশবোর্ড" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.getByRole("link", { name: "কমার্স" }).getAttribute("href")).toBe("/dashboard/commerce");
    const current = screen.getByText("গিফট কার্ড");
    expect(current.getAttribute("aria-current")).toBe("page");
  });
});

function PromptHarness({ onResult }: { onResult: (v: string | null) => void }) {
  const prompt = usePrompt();
  return (
    <button
      type="button"
      onClick={() => {
        void prompt({ title: "কারণ লিখুন", initialValue: "আগের মান" }).then(onResult);
      }}
    >
      খুলুন
    </button>
  );
}

describe("PromptProvider / usePrompt", () => {
  it("resolves with the edited value on submit", async () => {
    const results: (string | null)[] = [];
    render(
      <PromptProvider>
        <PromptHarness onResult={(v) => results.push(v)} />
      </PromptProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "খুলুন" }));
    const input = screen.getByDisplayValue("আগের মান") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "নতুন কারণ" } });
    fireEvent.click(screen.getByRole("button", { name: "ঠিক আছে" }));
    await Promise.resolve();
    expect(results).toEqual(["নতুন কারণ"]);
  });

  it("resolves null on cancel", async () => {
    const results: (string | null)[] = [];
    render(
      <PromptProvider>
        <PromptHarness onResult={(v) => results.push(v)} />
      </PromptProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "খুলুন" }));
    fireEvent.click(screen.getByRole("button", { name: "বাতিল" }));
    await Promise.resolve();
    expect(results).toEqual([null]);
  });
});
