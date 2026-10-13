/**
 * CODE128 (subset B) encoder producing SVG bar data.
 *
 * Subset B covers ASCII 32–126. Encoding:
 *   [quiet 10] Start B (104) · data symbols · checksum · Stop (106) [quiet 10]
 * Checksum = (startValue + Σ position_i × value_i) mod 103,
 * positions are 1-based over the data symbols.
 * Each symbol is 11 modules wide (3 bars + 3 spaces) except the
 * stop symbol which is 13 modules (4 bars). Width patterns below
 * are the standard CODE128 table (bar/space widths alternating,
 * starting with a bar).
 */

const PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312",
  "132212", "221213", "221312", "231212", "112232", "122132", "122231", "113222",
  "123122", "123221", "223211", "221132", "221231", "213212", "223112", "312131",
  "311222", "321122", "321221", "312212", "322112", "322211", "212123", "212321",
  "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121",
  "313121", "211331", "231131", "213113", "213311", "213131", "311123", "311321",
  "331121", "312113", "312311", "332111", "314111", "221411", "431111", "111224",
  "111422", "121124", "121421", "141122", "141221", "112214", "112412", "122114",
  "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112",
  "421211", "212141", "214121", "412121", "111143", "111341", "131141", "114113",
  "114311", "411113", "411311", "113141", "114131", "311141", "411131", "211412",
  "211214", "211232", "2331112",
];

export const CODE128_START_B = 104;
export const CODE128_STOP = 106;

export interface Code128Rect { x: number; w: number }
export interface Code128Svg {
  viewBox: string;
  width: number;
  height: number;
  rects: Code128Rect[];
  /** Ready-to-use inline `<svg>` markup string. */
  svg: string;
  /** Symbol values including start, data, checksum and stop. */
  codes: number[];
  checksum: number;
  totalModules: number;
}

/** Symbol values for `value` (subset B): start, data…, checksum, stop. Throws outside ASCII 32–126 / empty. */
export function code128Codes(value: string): { codes: number[]; checksum: number } {
  if (!value) throw new Error("code128: empty string cannot be encoded");
  const data: number[] = [];
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code > 126) {
      throw new Error(`code128: character ${JSON.stringify(ch)} (U+${code.toString(16).toUpperCase().padStart(4, "0")}) is outside subset B (ASCII 32–126)`);
    }
    data.push(code - 32);
  }
  let sum = CODE128_START_B;
  data.forEach((v, i) => { sum += (i + 1) * v; });
  const checksum = sum % 103;
  return { codes: [CODE128_START_B, ...data, checksum, CODE128_STOP], checksum };
}

export function code128Svg(value: string, height = 48): Code128Svg {
  const { codes, checksum } = code128Codes(value);
  const quiet = 10;
  const rects: Code128Rect[] = [];
  let x = quiet;
  for (const code of codes) {
    const pattern = PATTERNS[code];
    if (!pattern) throw new Error(`code128: no pattern for symbol ${code}`);
    const widths = pattern.split("").map(Number);
    widths.forEach((w, i) => {
      if (i % 2 === 0) rects.push({ x, w }); // even index = bar
      x += w;
    });
  }
  const totalModules = x + quiet;
  const viewBox = `0 0 ${totalModules} ${height}`;
  const rectEls = rects.map((r) => `<rect x="${r.x}" y="0" width="${r.w}" height="${height}"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" preserveAspectRatio="none" fill="#000" role="img" aria-label="${value.replace(/&/g, "&amp;").replace(/</g, "&lt;")}">${rectEls}</svg>`;
  return { viewBox, width: totalModules, height, rects, svg, codes, checksum, totalModules };
}

/** Convenience: only the SVG markup string. */
export function code128SvgString(value: string, height = 48): string {
  return code128Svg(value, height).svg;
}
