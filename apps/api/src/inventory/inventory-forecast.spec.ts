import { InventoryService } from "./inventory.service";

describe("InventoryService.getInventoryForecast", () => {
  it("calculates sales velocity, runout days, status, and supplier reorder advice accurately", async () => {
    const DAY = 86400000;
    const NOW = Date.now();

    const products = [
      {
        id: "p-hot",
        name: "Premium Linen Panjabi",
        sku: "PANJABI-01",
        priceMinor: 250000n, // 2500 BDT
        stockQuantity: 10,
        lowStockThreshold: 5,
        imageUrl: "https://example.com/p1.jpg",
        category: "Clothing",
      },
      {
        id: "p-out",
        name: "Casual T-Shirt",
        sku: "TSHIRT-02",
        priceMinor: 80000n, // 800 BDT
        stockQuantity: 0,
        lowStockThreshold: 5,
        imageUrl: null,
        category: "Clothing",
      },
      {
        id: "p-healthy",
        name: "Cotton Formal Shirt",
        sku: "SHIRT-03",
        priceMinor: 150000n, // 1500 BDT
        stockQuantity: 100,
        lowStockThreshold: 10,
        imageUrl: null,
        category: "Clothing",
      },
    ];

    const recentOrders = [
      // p-hot sold 42 units in 14 days => 3.0 units/day => runoutDays = 10 / 3 = 3.3 => 3 days (critical!)
      {
        items: [
          { productId: "p-hot", sku: "PANJABI-01", quantity: 20 },
          { productId: "p-hot", sku: "PANJABI-01", quantity: 22 },
          { productId: "p-out", sku: "TSHIRT-02", quantity: 14 }, // 1 unit/day, but current stock is 0 (out_of_stock)
          { productId: "p-healthy", sku: "SHIRT-03", quantity: 14 }, // 1 unit/day, current stock 100 (healthy)
        ],
      },
    ];

    const prisma: any = {
      product: {
        findMany: async () => products,
      },
      order: {
        findMany: async () => recentOrders,
      },
      organization: {
        findFirst: async () => ({ name: "Dhaka Wardrobe", brandName: "Dhaka Wardrobe" }),
      },
    };

    const service = new InventoryService(prisma, null as any, null as any, null as any);
    const result = await service.getInventoryForecast("org-test", { lookbackDays: 14, targetCoverDays: 21 });

    expect(result.summary.totalProducts).toBe(3);
    expect(result.summary.outOfStockCount).toBe(1);
    expect(result.summary.criticalCount).toBe(1);
    expect(result.summary.healthyCount).toBe(1);

    // Verify p-out
    const outItem = result.items.find((i: any) => i.id === "p-out");
    expect(outItem).toBeDefined();
    expect(outItem?.status).toBe("out_of_stock");
    expect(outItem?.stockQuantity).toBe(0);
    expect(outItem?.suggestedReorder).toBeGreaterThan(0);
    expect(outItem?.supplierMessage).toContain("Dhaka Wardrobe");
    expect(outItem?.supplierMessage).toContain("Casual T-Shirt");

    // Verify p-hot (critical, <= 4 days runout)
    const hotItem = result.items.find((i: any) => i.id === "p-hot");
    expect(hotItem).toBeDefined();
    expect(hotItem?.status).toBe("critical");
    expect(hotItem?.dailyVelocity).toBe(3);
    expect(hotItem?.runoutDays).toBe(3);
    expect(hotItem?.suggestedReorder).toBeGreaterThan(0);
    expect(hotItem?.supplierMessage).toContain("জরুরি ভিত্তিতে");

    // Verify p-healthy
    const healthyItem = result.items.find((i: any) => i.id === "p-healthy");
    expect(healthyItem).toBeDefined();
    expect(healthyItem?.status).toBe("healthy");
    expect(healthyItem?.runoutDays).toBe(100);
  });
});
