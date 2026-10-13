import { describe, expect, it } from "vitest";
import { code128Codes, code128Svg, code128SvgString } from "./code128";

describe("code128 subset B", () => {
  it('encodes "ABC123" with the spec checksum (67) and bar geometry', () => {
    // Subset B values: A=33 B=34 C=35 '1'=17 '2'=18 '3'=19, Start B=104.
    // Checksum = (104 + 1·33 + 2·34 + 3·35 + 4·17 + 5·18 + 6·19) mod 103
    //          = 582 mod 103 = 67 → pattern 141122.
    const { codes, checksum } = code128Codes("ABC123");
    expect(checksum).toBe(67);
    expect(codes).toEqual([104, 33, 34, 35, 17, 18, 19, 67, 106]);

    const out = code128Svg("ABC123");
    // Width: 10 quiet + 8 symbols × 11 + stop 13 + 10 quiet = 121 modules.
    expect(out.totalModules).toBe(121);
    expect(out.viewBox).toBe("0 0 121 48");
    // Bars: 8 non-stop symbols × 3 bars + stop 4 bars = 28 rects.
    expect(out.rects).toHaveLength(28);
    // First bar is Start B (211214): bar widths 2,1,1 starting at x=10 (quiet zone).
    expect(out.rects[0]).toEqual({ x: 10, w: 2 });
    expect(out.rects[1]).toEqual({ x: 13, w: 1 });
    expect(out.rects[2]).toEqual({ x: 16, w: 1 });
    expect(out.svg).toContain("<svg");
    expect(out.svg).toContain('viewBox="0 0 121 48"');
  });

  it("encodes a single space (value 0) and tilde (value 94)", () => {
    expect(code128Codes(" ").codes).toEqual([104, 0, (104 + 0) % 103, 106]);
    expect(code128Codes("~").checksum).toBe((104 + 94) % 103);
  });

  it("svg string helper matches code128Svg", () => {
    expect(code128SvgString("SKU-001")).toBe(code128Svg("SKU-001").svg);
  });

  it("throws on empty string", () => {
    expect(() => code128Svg("")).toThrow(/empty/);
    expect(() => code128Codes("")).toThrow(/empty/);
  });

  it("throws on characters outside subset B (ASCII 32–126)", () => {
    expect(() => code128Svg("বাংলা")).toThrow(/outside subset B/);
    expect(() => code128Svg("a\tb")).toThrow(/outside subset B/);
    expect(() => code128Svg("a\x7fb")).toThrow(/outside subset B/);
    expect(() => code128Svg("line\nbreak")).toThrow(/outside subset B/);
  });
});
