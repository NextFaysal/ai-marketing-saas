import { normalizeWooProduct, normalizeWooOrder, wooMoney } from "./normalize";

describe("wooMoney", () => {
  it("treats empty values as zero and parses decimal strings", () => {
    expect(wooMoney("")).toBe(0n);
    expect(wooMoney(null)).toBe(0n);
    expect(wooMoney("1250.50")).toBe(125050n);
  });
  it("fails loudly on malformed money", () => {
    expect(() => wooMoney("not-money")).toThrow();
  });
});

describe("normalizeWooProduct", () => {
  it("maps a published product with sale price", () => {
    const p = normalizeWooProduct({
      id: 42, name: "T-Shirt", slug: "t-shirt", status: "publish", sku: "TS-1",
      price: "850.00", regular_price: "1000.00", sale_price: "850.00",
      manage_stock: true, stock_quantity: 25,
      categories: [{ name: "Apparel" }], images: [{ src: "https://x/img.jpg" }],
      description: "<p>Soft <b>cotton</b></p>",
    });
    expect(p.externalId).toBe("42");
    expect(p.status).toBe("ACTIVE");
    expect(p.priceMinor).toBe(85000n);
    expect(p.compareAtMinor).toBe(100000n);
    expect(p.stockQuantity).toBe(25);
    expect(p.description).toBe("Soft cotton");
    expect(p.category).toBe("Apparel");
  });
  it("does not subtract stock for unmanaged-stock products", () => {
    const p = normalizeWooProduct({ id: 1, name: "X", status: "publish", price: "10", manage_stock: false, stock_quantity: null });
    expect(p.stockQuantity).toBeNull();
  });
});

describe("normalizeWooOrder", () => {
  it("maps a COD order with items, totals and refunds", () => {
    const o = normalizeWooOrder({
      id: 900, number: "900", status: "processing", payment_method: "cod", currency: "BDT",
      total: "910.00", shipping_total: "60.00", discount_total: "0.00", total_tax: "0.00",
      date_created_gmt: "2026-10-01T05:30:00", customer_id: 7,
      billing: { first_name: "Rahim", last_name: "Uddin", email: "r@example.com", phone: "01700000000" },
      line_items: [{ product_id: 42, variation_id: 0, name: "T-Shirt", sku: "TS-1", quantity: 1, price: "850.00", subtotal: "850.00", total: "850.00" }],
      refunds: [{ total: "-100.00" }],
    });
    expect(o.isCod).toBe(true);
    expect(o.totalMinor).toBe(91000n);
    expect(o.subtotalMinor).toBe(85000n);
    expect(o.shippingMinor).toBe(6000n);
    // Woo refund totals arrive negative; we store the positive amount refunded.
    expect(o.refundedMinor).toBe(10000n);
    expect(o.customer.email).toBe("r@example.com");
    expect(o.items[0].priceMinor).toBe(85000n);
    expect(o.placedAt?.toISOString()).toBe("2026-10-01T05:30:00.000Z");
  });
});
