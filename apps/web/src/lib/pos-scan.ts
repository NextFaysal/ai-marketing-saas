// AB4 (AX6) — camera barcode scanning helpers for the POS
// page. Pure logic only: the page owns the <video> element and
// the BarcodeDetector loop; everything testable lives here.

/**
 * Normalize a raw scanned/typed code: strip surrounding
 * whitespace and control characters (hardware scanners append
 * CR/LF; the camera detector can hand back padded values).
 * Interior characters are left exactly as scanned.
 */
export function normalizeScanCode(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw)
    .replace(/^[\s\u0000-\u001f\u007f]+/, "")
    .replace(/[\s\u0000-\u001f\u007f]+$/, "");
}

/**
 * Debounce predicate: the same code seen again inside the
 * window is a duplicate frame from the camera, not a second
 * scan. A DIFFERENT code is always accepted immediately.
 */
export function shouldAcceptScan(
  lastCode: string | null,
  lastAt: number | null,
  code: string,
  now: number,
  windowMs: number = 1500,
): boolean {
  const normalized = normalizeScanCode(code);
  if (!normalized) return false;
  if (lastCode === null || lastAt === null) return true;
  if (normalizeScanCode(lastCode) !== normalized) return true;
  return now - lastAt >= windowMs;
}

/** Stateful wrapper over shouldAcceptScan for the scan loop. */
export class ScanDebouncer {
  private lastCode: string | null = null;
  private lastAt: number | null = null;

  constructor(private readonly windowMs: number = 1500) {}

  /** Returns true (and records the scan) when this code should
   * be acted on; false for duplicate frames inside the window. */
  accept(code: string, now: number = Date.now()): boolean {
    const normalized = normalizeScanCode(code);
    if (!shouldAcceptScan(this.lastCode, this.lastAt, normalized, now, this.windowMs)) {
      return false;
    }
    this.lastCode = normalized;
    this.lastAt = now;
    return true;
  }

  reset(): void {
    this.lastCode = null;
    this.lastAt = null;
  }
}

/** BarcodeDetector (Shape Detection API) feature check. */
export function barcodeDetectorSupported(win?: unknown): boolean {
  const w: any = win !== undefined
    ? win
    : (typeof window !== "undefined" ? window : null);
  if (!w) return false;
  try {
    return typeof w.BarcodeDetector === "function";
  } catch {
    return false;
  }
}
