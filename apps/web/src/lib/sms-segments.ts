/**
 * MS5 — web mirror of the API's sms-segments module
 * (apps/api/src/messaging/sms-segments.ts). Keep the two in sync:
 * the API computes the authoritative parts count for cost
 * estimates; this copy only drives the composer's live hint.
 *
 * GSM-7 (the GSM 03.38 default alphabet): a single SMS holds 160
 * units; concatenated parts hold 153 (the rest is the UDH header).
 * Characters in the extension table (^{}\[~]|€ and form feed) cost
 * 2 units (escape + code). ANY character outside GSM-7 — Bangla
 * included — switches the whole message to Unicode (UCS-2):
 * 70 characters single, 67 per concatenated part.
 */
const GSM7_BASIC = new Set([
  ..."@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà",
]);
const GSM7_EXT = new Set([..."^{}\\[~]|€\f"]);

export interface SmsSegments {
  encoding: "gsm7" | "unicode";
  /** GSM-7 units (extension chars count 2) or Unicode code points. */
  length: number;
  parts: number;
}

export function smsSegments(text: string): SmsSegments {
  const chars = [...String(text ?? "")];
  let units = 0;
  let gsm = true;
  for (const ch of chars) {
    if (GSM7_BASIC.has(ch)) units += 1;
    else if (GSM7_EXT.has(ch)) units += 2;
    else { gsm = false; break; }
  }
  if (gsm) {
    return { encoding: "gsm7", length: units, parts: Math.max(1, units <= 160 ? 1 : Math.ceil(units / 153)) };
  }
  const length = chars.length;
  return { encoding: "unicode", length, parts: Math.max(1, length <= 70 ? 1 : Math.ceil(length / 67)) };
}
