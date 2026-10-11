/**
 * Milestone 53: genuine Code 128 barcode encoding (ISO/IEC 15417),
 * dependency-free. Produces the symbol value sequence (start,
 * data, checksum, stop) and the bar/space width pattern used to
 * draw the bars as vectors in the hand-rolled PDF generator.
 *
 * Encoding strategy (kept deliberately simple and verifiable):
 *  - Code set C when the whole payload is digits with an even
 *    length >= 4 (dense numeric barcodes - Pathao consignment ids);
 *  - Code set B otherwise (ASCII 32..126 - tracking codes with
 *    letters). Characters outside set B are rejected loudly
 *    rather than silently mangled.
 * Checksum: (start + sum(value_i * i) for i = 1..n) mod 103.
 */

// Bar/space width patterns per symbol value 0..106 (the stop
// pattern 106 has 7 elements). Every non-stop pattern sums to 11
// modules; the stop pattern sums to 13.
export const CODE128_PATTERNS: string[] = [
  "212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
  "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
  "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
  "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
  "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
  "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
  "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
  "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
  "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
  "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
  "114131", "311141", "411131", "211412", "211214", "211232", "2331112",
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

export interface Code128Encoding {
  /** Symbol values incl. start, checksum and stop (106). */
  values: number[];
  /** Code set actually used: "B" or "C". */
  codeSet: "B" | "C";
  /** Flat bar/space widths (modules) across all symbols, bar first. */
  widths: number[];
}

export function encodeCode128(text: string): Code128Encoding {
  const input = String(text ?? "");
  if (!input) throw new Error("Code128: empty payload");
  const useC = /^\d+$/.test(input) && input.length >= 4 && input.length % 2 === 0;
  const values: number[] = [useC ? START_C : START_B];
  if (useC) {
    for (let i = 0; i < input.length; i += 2) values.push(Number(input.slice(i, i + 2)));
  } else {
    for (const ch of input) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error(`Code128: character ${JSON.stringify(ch)} is outside code set B`);
      values.push(code - 32);
    }
  }
  let sum = values[0];
  for (let i = 1; i < values.length; i++) sum += values[i] * i;
  values.push(sum % 103, STOP);
  const widths: number[] = [];
  for (const v of values) for (const d of CODE128_PATTERNS[v]) widths.push(Number(d));
  return { values, codeSet: useC ? "C" : "B", widths };
}
