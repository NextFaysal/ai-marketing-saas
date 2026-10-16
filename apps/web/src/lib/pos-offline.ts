// AB4 (AX6) — POS offline outbox: a versioned localStorage
// queue of sales taken while the network was down. The outbox
// is ONLY the transport — once a queued sale reaches the
// server, the PosOfflineSync ledger row is the record staff
// act on, and server totals are truth (localTotalMinor here is
// the client's own estimate, kept for variance display).
//
// All helpers are defensive (corrupt JSON → empty queue) and
// take an injectable storage so they can be unit-tested
// without a browser.

export interface PosOfflineSalePayload {
  items: Array<{ productId: string; variantId?: string; quantity: number }>;
  customerPhone?: string;
  customerName?: string;
  couponCode?: string;
  loyaltyPoints?: number;
  giftCardCode?: string;
  idempotencyKey?: string;
  payment: { mode: "paid" | "due"; method?: string; reference?: string };
  [key: string]: unknown;
}

export interface PosOfflineEntry {
  idempotencyKey: string;
  localReceiptNo: string;
  /** Client-computed total in paisa, as a string (BigInt-safe). */
  localTotalMinor: string;
  sale: PosOfflineSalePayload;
  queuedAt: string;
  cashierLabel?: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function outboxKey(orgId: string): string {
  return `qosprey.posOutbox.v1.${orgId}`;
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch { /* storage can throw in locked-down browsers */ }
  return null;
}

function isValidEntry(v: unknown): v is PosOfflineEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Record<string, unknown>;
  return typeof e.idempotencyKey === "string" && e.idempotencyKey.length > 0
    && typeof e.localReceiptNo === "string"
    && typeof e.localTotalMinor === "string"
    && !!e.sale && typeof e.sale === "object"
    && typeof e.queuedAt === "string";
}

export function loadQueue(orgId: string, storage: StorageLike | null = defaultStorage()): PosOfflineEntry[] {
  if (!storage || !orgId) return [];
  try {
    const raw = storage.getItem(outboxKey(orgId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidEntry);
  } catch {
    return [];
  }
}

function saveQueue(orgId: string, queue: PosOfflineEntry[], storage: StorageLike | null): void {
  if (!storage || !orgId) return;
  try {
    if (queue.length === 0) storage.removeItem(outboxKey(orgId));
    else storage.setItem(outboxKey(orgId), JSON.stringify(queue));
  } catch { /* a full/blocked storage must not break the sale flow */ }
}

/** Append an entry (replacing any entry with the same key —
 * a re-queue of the same sale is the same sale). Returns the
 * new queue. */
export function enqueue(
  orgId: string,
  entry: PosOfflineEntry,
  storage: StorageLike | null = defaultStorage(),
): PosOfflineEntry[] {
  const queue = loadQueue(orgId, storage).filter((e) => e.idempotencyKey !== entry.idempotencyKey);
  queue.push(entry);
  saveQueue(orgId, queue, storage);
  return queue;
}

export function removeEntry(
  orgId: string,
  idempotencyKey: string,
  storage: StorageLike | null = defaultStorage(),
): PosOfflineEntry[] {
  const queue = loadQueue(orgId, storage).filter((e) => e.idempotencyKey !== idempotencyKey);
  saveQueue(orgId, queue, storage);
  return queue;
}

/** Drop entries the server has taken over. With explicit keys
 * only those go; with no keys the caller is asserting the
 * whole queue synced, so it clears entirely. */
export function clearSynced(
  orgId: string,
  syncedKeys?: Iterable<string>,
  storage: StorageLike | null = defaultStorage(),
): PosOfflineEntry[] {
  if (!syncedKeys) {
    saveQueue(orgId, [], storage);
    return [];
  }
  const drop = new Set(syncedKeys);
  const queue = loadQueue(orgId, storage).filter((e) => !drop.has(e.idempotencyKey));
  saveQueue(orgId, queue, storage);
  return queue;
}

let receiptSeq = 0;

/** Local receipt numbers: `OFF-{timestamp base36}-{seq}`. */
export function generateLocalReceiptNo(now: number = Date.now(), seq?: number): string {
  const s = seq !== undefined ? seq : ++receiptSeq;
  return `OFF-${Math.max(0, Math.floor(now)).toString(36)}-${s}`;
}
