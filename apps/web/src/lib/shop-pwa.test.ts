import { describe, expect, it } from "vitest";
import {
  buildShopIconSvg,
  buildShopManifest,
  escapeXml,
  shopDisplayName,
  validatedHexColor,
  type ShopPwaHome,
} from "./shop-pwa";

function home(overrides: Partial<ShopPwaHome> = {}): ShopPwaHome {
  return {
    settings: { shopName: "সেটিংসের নাম" },
    organization: {
      name: "Org Name",
      brandName: null,
      logoUrl: null,
      primaryColor: null,
    },
    ...overrides,
  };
}

describe("AB8 buildShopManifest", () => {
  it("name resolution: brandName ?? organization.name ?? settings.shopName", () => {
    expect(buildShopManifest(home({ organization: { name: "Org Name", brandName: "Brand Co", logoUrl: null, primaryColor: null } }), "s").name).toBe("Brand Co");
    expect(buildShopManifest(home(), "s").name).toBe("Org Name");
    expect(buildShopManifest(home({ organization: { name: null, brandName: null, logoUrl: null, primaryColor: null } }), "s").name).toBe("সেটিংসের নাম");
    expect(shopDisplayName(null)).toBe("Shop");
    expect(shopDisplayName({})).toBe("Shop");
  });

  it("short_name is the first ≤12 chars of the name", () => {
    const m = buildShopManifest(home({ organization: { name: "Org Name", brandName: "A Very Long Brand Name Here", logoUrl: null, primaryColor: null } }), "s");
    expect(m.short_name).toBe("A Very Long ");
    expect(Array.from(m.short_name).length).toBe(12);
    expect(buildShopManifest(home(), "s").short_name).toBe("Org Name");
  });

  it("urls, display, background and theme color (with fallback)", () => {
    const m = buildShopManifest(home(), "my-shop");
    expect(m.start_url).toBe("/shop/my-shop");
    expect(m.scope).toBe("/shop/my-shop/");
    expect(m.display).toBe("standalone");
    expect(m.background_color).toBe("#ffffff");
    expect(m.theme_color).toBe("#4f46e5");
    const colored = buildShopManifest(home({ organization: { name: "Org", brandName: null, logoUrl: null, primaryColor: "#0ea5e9" } }), "s");
    expect(colored.theme_color).toBe("#0ea5e9");
  });

  it("icons: the shop's own logo wins when present", () => {
    const m = buildShopManifest(home({ organization: { name: "Org", brandName: null, logoUrl: "https://cdn.example/logo.png", primaryColor: null } }), "s");
    expect(m.icons).toEqual([{ src: "https://cdn.example/logo.png", sizes: "any", purpose: "any" }]);
    // …even for a white-label shop.
    const wl = buildShopManifest(home({ organization: { name: "Org", brandName: null, logoUrl: "https://cdn.example/logo.png", primaryColor: null, whiteLabel: true } }), "s");
    expect(wl.icons).toEqual([{ src: "https://cdn.example/logo.png", sizes: "any", purpose: "any" }]);
  });

  it("icons: maskable is never claimed for a merchant logo or the generated icon (ED10)", () => {
    const logo = buildShopManifest(home({ organization: { name: "Org", brandName: null, logoUrl: "https://cdn.example/logo.png", primaryColor: null } }), "s");
    expect(logo.icons.some((i) => i.purpose.includes("maskable"))).toBe(false);
    const wl = buildShopManifest(home({ organization: { name: "Org", brandName: null, logoUrl: null, primaryColor: null, whiteLabel: true } }), "s");
    expect(wl.icons.some((i) => i.purpose.includes("maskable"))).toBe(false);
  });

  it("icons: white-label without a logo gets the generated icon, never the platform mark", () => {
    const m = buildShopManifest(home({ organization: { name: "Org", brandName: null, logoUrl: null, primaryColor: null, whiteLabel: true } }), "ghost-shop");
    expect(m.icons).toEqual([
      { src: "/shop/ghost-shop/icon.svg", sizes: "any", purpose: "any", type: "image/svg+xml" },
    ]);
  });

  it("icons: non-white-label without a logo falls back to the platform PNGs", () => {
    const m = buildShopManifest(home(), "s");
    expect(m.icons).toEqual([
      { src: "/icons/icon-192.png", sizes: "192x192", purpose: "any", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", purpose: "any", type: "image/png" },
      // ED10: the platform's purpose-built maskable asset is
      // the ONLY icon ever declared maskable (see shop-pwa).
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", purpose: "maskable", type: "image/png" },
    ]);
    // whiteLabel present but not exactly true behaves as non-white-label.
    const m2 = buildShopManifest(home({ organization: { name: "Org", brandName: null, logoUrl: null, primaryColor: null, whiteLabel: false } }), "s");
    expect(m2.icons[0].src).toBe("/icons/icon-192.png");
  });
});

describe("AB8 buildShopIconSvg + helpers", () => {
  it("renders a 512 rounded rect in the primary color with the first letter", () => {
    const svg = buildShopIconSvg(home({ organization: { name: "Dhaka Store", brandName: null, logoUrl: null, primaryColor: "#dc2626" } }));
    expect(svg).toContain(`width="512"`);
    expect(svg).toContain(`fill="#dc2626"`);
    expect(svg).toContain(">D</text>");
    expect(svg).toContain(`fill="#ffffff"`);
  });

  it("falls back to the default color for an invalid primary color", () => {
    const svg = buildShopIconSvg(home({ organization: { name: "X Shop", brandName: null, logoUrl: null, primaryColor: "red; } </style><script>" } }));
    expect(svg).toContain(`fill="#4f46e5"`);
    expect(svg).not.toContain("<script>");
    expect(validatedHexColor("#abc")).toBe("#abc");
    expect(validatedHexColor("#A1B2C3")).toBe("#A1B2C3");
    expect(validatedHexColor("blue")).toBe("#4f46e5");
    expect(validatedHexColor(null)).toBe("#4f46e5");
  });

  it("XML-escapes the first letter", () => {
    expect(escapeXml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
    const svg = buildShopIconSvg(home({ organization: { name: "& Sons", brandName: null, logoUrl: null, primaryColor: null } }));
    expect(svg).toContain(">&amp;</text>");
  });
});
