/**
 * ED9 (EB3) — shop overlay queue: at most ONE bottom/modal overlay
 * is visible at a time on shop pages.
 *
 * Before ED9 the shop layout mounted four independent overlays
 * (popup modal, install bar, push prompt, social-proof card) plus
 * persistent contact buttons, each with its own trigger state —
 * on a phone they could stack and cover each other and the v2
 * bottom chrome. This module is the coordinator: each overlay
 * keeps its OWN trigger / frequency / dismissal logic exactly as
 * before and merely *requests* a slot here; only the granted
 * (highest-priority) requester renders.
 *
 * The popup modal is `fixed inset-0` — it covers everything
 * including the bottom nav, so it needs no bottom lift; it still
 * routes through the queue for correctness (top priority, so in
 * practice it is granted as soon as it asks).
 *
 * The pure core (createOverlayQueue) is framework-free and
 * unit-tested; the module store + useOverlayGrant are the React
 * binding over a singleton instance of that core.
 */
import { useEffect } from "react";
import { useSyncExternalStore } from "react";

/** Priority ladder: higher wins. Popup > install > push > social. */
export const OVERLAY_PRIORITIES: Record<string, number> = {
  popup: 40,
  install: 30,
  push: 20,
  social: 10,
};

export type OverlayId = keyof typeof OVERLAY_PRIORITIES | string;

export interface OverlayQueue {
  /** Ask for the slot. Idempotent: re-requesting changes nothing. */
  request(id: string): void;
  /** Give the slot back. Releasing a non-active id just dequeues it. */
  release(id: string): void;
  /** The granted id, or null when nobody is waiting. */
  active(): string | null;
  /** Waiting ids in grant order (highest priority first). */
  snapshot(): string[];
}

export function createOverlayQueue(
  priorities: Record<string, number>,
): OverlayQueue {
  // Insertion-ordered set of requesters; grant order is derived
  // from priorities (ties keep insertion order — Array.sort is
  // stable in every supported runtime).
  const waiting: string[] = [];
  const order = () =>
    [...waiting].sort(
      (a, b) => (priorities[b] ?? 0) - (priorities[a] ?? 0),
    );
  return {
    request(id) {
      if (!waiting.includes(id)) waiting.push(id);
    },
    release(id) {
      const i = waiting.indexOf(id);
      if (i >= 0) waiting.splice(i, 1);
    },
    active() {
      return order()[0] ?? null;
    },
    snapshot() {
      return order();
    },
  };
}

// ---- Module store (singleton) --------------------------------

const queue = createOverlayQueue(OVERLAY_PRIORITIES);
const listeners = new Set<() => void>();

function notify() {
  for (const fn of [...listeners]) fn();
}

export function requestOverlay(id: string): void {
  const before = queue.active();
  queue.request(id);
  // Only a change in who is granted can change any rendering.
  if (queue.active() !== before || queue.snapshot().includes(id)) notify();
}

export function releaseOverlay(id: string): void {
  const before = queue.active();
  queue.release(id);
  if (queue.active() !== before || before === id) notify();
}

export function getActiveOverlay(): string | null {
  return queue.active();
}

export function subscribeOverlayQueue(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * React binding: register this component's desire to show under
 * `id` and learn whether it is granted the slot.
 *
 * `wantsVisible` must come from the component's EXISTING trigger
 * logic (unchanged by ED9) — the queue owns no trigger, frequency
 * or dismissal state. The request is released when wantsVisible
 * turns false or the component unmounts.
 */
export function useOverlayGrant(id: string, wantsVisible: boolean): boolean {
  useEffect(() => {
    if (!wantsVisible) return;
    requestOverlay(id);
    return () => releaseOverlay(id);
  }, [id, wantsVisible]);
  return useSyncExternalStore(
    subscribeOverlayQueue,
    () => queue.active() === id,
    () => false,
  );
}
