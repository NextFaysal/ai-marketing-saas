"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// NOTE: packages/ui tsconfig has no DOM lib (lib: ES2022 only), so DOM
// access goes through globalThis with minimal structural types instead of
// bare `document`/`setTimeout` globals, keeping `tsc --noEmit` green
// without editing the out-of-scope tsconfig.
type DialogDocument = {
  activeElement: { focus?: () => void } | null;
  body: { style: { overflow: string } };
  addEventListener: (type: string, listener: (e: { key: string }) => void) => void;
  removeEventListener: (type: string, listener: (e: { key: string }) => void) => void;
};

function getDocument(): DialogDocument {
  return (globalThis as unknown as { document: DialogDocument }).document;
}

function scheduleTimeout(fn: () => void, ms: number) {
  (globalThis as unknown as { setTimeout: (cb: () => void, delay: number) => unknown }).setTimeout(fn, ms);
}

function useDialogChrome(onClose: () => void, open: boolean) {
  useEffect(() => {
    if (!open) return;
    const doc = getDocument();
    const previouslyFocused = doc.activeElement;
    const prevOverflow = doc.body.style.overflow;
    doc.body.style.overflow = "hidden";
    const onKeyDown = (e: { key: string }) => {
      if (e.key === "Escape") onClose();
    };
    doc.addEventListener("keydown", onKeyDown);
    return () => {
      doc.removeEventListener("keydown", onKeyDown);
      doc.body.style.overflow = prevOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  useDialogChrome(onClose, open);
  if (!open) return null;
  const width = size === "sm" ? "max-w-sm" : size === "lg" ? "max-w-2xl" : "max-w-lg";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`max-h-[90dvh] w-full overflow-y-auto rounded-3xl bg-white p-5 shadow-pop ${width}`}
        onClick={(e) => e.stopPropagation()}
      >
        {title ? (
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="বন্ধ করুন"
              className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-600"
            >
              ✕
            </button>
          </div>
        ) : null}
        {children}
        {footer ? <div className="mt-4 flex flex-wrap justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  side = "right",
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  side?: "right" | "left";
}) {
  useDialogChrome(onClose, open);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80]">
      <div className="absolute inset-0 bg-slate-950/50" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={`absolute inset-y-0 ${side === "right" ? "right-0" : "left-0"} w-full max-w-md overflow-y-auto bg-white p-5 shadow-drawer`}
      >
        {title ? (
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <button
              type="button"
              onClick={onClose}
              aria-label="বন্ধ করুন"
              className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-600"
            >
              ✕
            </button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

export type ToastTone = "success" | "error" | "info";
export type ToastInput = { title: string; description?: string; tone?: ToastTone; durationMs?: number };

type ToastItem = { id: number; input: ToastInput };
type ToastContextValue = { toast: (input: ToastInput) => void; dismiss: (id: number) => void };

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (input: ToastInput) => {
      counterRef.current += 1;
      const id = counterRef.current;
      setToasts((prev) => [...prev, { id, input }]);
      const duration = input.durationMs ?? 4000;
      if (duration !== 0) {
        scheduleTimeout(() => {
          dismiss(id);
        }, duration);
      }
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[min(92vw,360px)] flex-col gap-2">
        {toasts.map(({ id, input }) => {
          const tone = input.tone ?? "info";
          return (
            <div key={id} className="pointer-events-auto flex items-start gap-2.5 rounded-2xl bg-white p-3.5 shadow-pop ring-1 ring-slate-200">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone === "success" ? "bg-emerald-500" : tone === "error" ? "bg-red-500" : "bg-brand-500"}`}
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900">{input.title}</p>
                {input.description ? <p className="text-xs text-slate-500">{input.description}</p> : null}
              </div>
              <button
                type="button"
                aria-label="বন্ধ করুন"
                onClick={() => dismiss(id)}
                className="shrink-0 text-slate-400"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}

export type ConfirmOptions = {
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmState = { options: ConfirmOptions; resolve: (v: boolean) => void } | null;

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConfirmState>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState((prev) => {
        prev?.resolve(false);
        return { options: opts, resolve };
      });
    });
  }, []);

  const settle = useCallback(
    (v: boolean) => {
      state?.resolve(v);
      setState(null);
    },
    [state],
  );

  const handleClose = useCallback(() => {
    settle(false);
  }, [settle]);

  useDialogChrome(handleClose, state !== null);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" onClick={() => settle(false)}>
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900">{state.options.title}</h2>
              <button
                type="button"
                onClick={() => settle(false)}
                aria-label="বন্ধ করুন"
                className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-600"
              >
                ✕
              </button>
            </div>
            {state.options.body ? <div className="text-sm text-slate-600">{state.options.body}</div> : null}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" className="btn-secondary btn-sm" onClick={() => settle(false)}>
                {state.options.cancelLabel ?? "বাতিল"}
              </button>
              <button
                type="button"
                className={
                  state.options.danger
                    ? "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-br from-red-600 to-red-500 px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-110"
                    : "btn-primary btn-sm"
                }
                onClick={() => settle(true)}
              >
                {state.options.confirmLabel ?? "নিশ্চিত করুন"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}

export type PromptOptions = {
  title: string;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

type PromptState = { options: PromptOptions; resolve: (v: string | null) => void } | null;

const PromptContext = createContext<((opts: PromptOptions) => Promise<string | null>) | null>(null);

/**
 * PromptProvider + usePrompt (EB5/ED14): promise-based replacement for the
 * native window.prompt() — the kit's Modal + a text input. Resolves with
 * the entered string on confirm, null on cancel/Escape/backdrop; a
 * superseded call resolves null (same discipline as ConfirmProvider).
 * Must be mounted inside the dashboard root next to ConfirmProvider.
 */
export function PromptProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<PromptState>(null);
  const [value, setValue] = useState("");

  const prompt = useCallback((opts: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      setState((prev) => {
        prev?.resolve(null);
        return { options: opts, resolve };
      });
      setValue(opts.initialValue ?? "");
    });
  }, []);

  const settle = useCallback(
    (v: string | null) => {
      state?.resolve(v);
      setState(null);
    },
    [state],
  );

  const handleClose = useCallback(() => settle(null), [settle]);

  useDialogChrome(handleClose, state !== null);

  return (
    <PromptContext.Provider value={prompt}>
      {children}
      {state ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/50 p-4" onClick={() => settle(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-pop"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 className="text-base font-bold text-slate-900">{state.options.title}</h2>
              <button
                type="button"
                onClick={() => settle(null)}
                aria-label="বন্ধ করুন"
                className="rounded-full bg-slate-100 px-2.5 py-1 text-sm font-bold text-slate-600"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                settle(value);
              }}
            >
              {state.options.label ? (
                <label className="mb-1 block text-[13px] font-semibold text-slate-700" htmlFor="repo-ui-prompt-input">
                  {state.options.label}
                </label>
              ) : null}
              <input
                id="repo-ui-prompt-input"
                className="input w-full"
                value={value}
                placeholder={state.options.placeholder}
                onChange={(e) => setValue((e.target as unknown as { value: string }).value)}
                autoFocus
              />
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => settle(null)}>
                  {state.options.cancelLabel ?? "বাতিল"}
                </button>
                <button type="submit" className="btn-primary btn-sm">
                  {state.options.confirmLabel ?? "ঠিক আছে"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </PromptContext.Provider>
  );
}

export function usePrompt(): (opts: PromptOptions) => Promise<string | null> {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error("usePrompt must be used within <PromptProvider>");
  return ctx;
}
