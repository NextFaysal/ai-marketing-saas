import { createHmac } from "crypto";
import { normalizeShopifyProduct, normalizeShopifyOrder } from "./normalize";
import { verifyShopifyHmac } from "./shopify.service";

describe("Shopify normalization", () => {
  it("product: price from first variant, stock summed across variants", () => {
    const p = normalizeShopifyProduct({
      id: 9001, title: "Silk Hijab", status: "active", product_type: "Clothing",
      body_html: "<p>Soft <b>silk</b></p>",
      images: [{ src: "https://cdn.example/hijab.jpg" }],
      variants: [
        { id: 1, title: "Red", sku: "HJ-R", price: "850.00", compare_at_price: "1000.00", inventory_quantity: 5 },
        { id: 2, title: "Blue", sku: "HJ-B", price: "850.00", inventory_quantity: 7 },
      ],
    }, "BDT");
    expect(p).toMatchObject({ externalId: "9001", name: "Silk Hijab", priceMinor: 85000n, compareAtMinor: 100000n, stockQuantity: 12, status: "ACTIVE", category: "Clothing" });
    expect(p.description).toContain("Soft silk");
  });
  it("order: COD detection, refunds summed, fulfilled+paid = completed", () => {
    const o = normalizeShopifyOrder({
      id: 5001, name: "#1001", order_number: 1001, currency: "BDT", created_at: "2026-10-01T10:00:00Z",
      financial_status: "paid", fulfillment_status: "fulfilled",
      payment_gateway_names: ["Cash on Delivery"],
      current_subtotal_price_set: { shop_money: { amount: "1700.00" } },
      total_shipping_price_set: { shop_money: { amount: "60.00" } },
      total_discounts_set: { shop_money: { amount: "0.00" } },
      total_tax_set: { shop_money: { amount: "0.00" } },
      current_total_price_set: { shop_money: { amount: "1760.00" } },
      refunds: [{ transactions: [{ kind: "refund", status: "success", amount: "100.00" }] }],
      customer: { id: 77, first_name: "Ayesha", last_name: "Rahman", email: "AYESHA@example.com" },
      line_items: [{ product_id: 9001, variant_id: 1, title: "Silk Hijab", sku: "HJ-R", quantity: 2, price: "850.00" }],
    });
    expect(o.status).toBe("completed");
    expect(o.isCod).toBe(true);
    expect(o.totalMinor).toBe(176000n);
    expect(o.refundedMinor).toBe(10000n);
    expect(o.customer.email).toBe("ayesha@example.com");
    expect(o.items[0].totalMinor).toBe(170000n);
  });
  it("cancelled orders map to cancelled regardless of other fields", () => {
    const o = normalizeShopifyOrder({ id: 1, cancelled_at: "2026-10-02T00:00:00Z", financial_status: "paid", currency: "BDT" });
    expect(o.status).toBe("cancelled");
  });
});

describe("verifyShopifyHmac", () => {
  it("accepts the correct base64 HMAC and rejects others", () => {
    const body = JSON.stringify({ id: 1 });
    const secret = "shpss_secret";
    const good = createHmac("sha256", secret).update(body, "utf8").digest("base64");
    expect(verifyShopifyHmac(body, good, secret)).toBe(true);
    expect(verifyShopifyHmac(body, "AAAA", secret)).toBe(false);
    expect(verifyShopifyHmac(body, undefined, secret)).toBe(false);
  });
});
