import { parseProductsCsv } from "./csv";

const HEADER = "name,sku,price,cost,stock,category";

describe("parseProductsCsv", () => {
  it("parses valid rows and converts money to minor units", () => {
    const r = parseProductsCsv(`${HEADER}\nCotton T-Shirt,TS-001,850.00,420,25,Apparel`);
    expect(r.errors).toHaveLength(0);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].priceMinor).toBe(85000n);
    expect(r.rows[0].costMinor).toBe(42000n);
    expect(r.rows[0].stockQuantity).toBe(25);
    expect(r.rows[0].currency).toBe("BDT");
  });
  it("reports a row error for a missing price and keeps other rows", () => {
    const r = parseProductsCsv(`${HEADER}\nGood,SKU-1,100,,10,\nBad,SKU-2,,,5,`);
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].row).toBe(2);
    expect(r.errors[0].message).toContain("price");
  });
  it("reports invalid money instead of guessing", () => {
    const r = parseProductsCsv(`${HEADER}\nThing,SKU-9,abc,,1,`);
    expect(r.rows).toHaveLength(0);
    expect(r.errors[0].message).toContain("Invalid price");
  });
  it("handles quoted commas in names and descriptions", () => {
    const csv = 'name,price,description\n"Shirt, Premium",1200,"Soft, breathable cotton"';
    const r = parseProductsCsv(csv);
    expect(r.rows[0].name).toBe("Shirt, Premium");
    expect(r.rows[0].description).toBe("Soft, breathable cotton");
  });
  it("accepts header aliases like product_name and sale_price", () => {
    const r = parseProductsCsv("product_name,sale_price\nMug,350");
    expect(r.rows[0].name).toBe("Mug");
    expect(r.rows[0].priceMinor).toBe(35000n);
  });
});
