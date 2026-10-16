import React from "react";

/**
 * GC: floating WhatsApp / Messenger buttons. Pure presentational
 * (server-safe) — renders nothing when both channels are unset.
 */
export function ShopContactButtons({
  whatsappNumber,
  messengerUrl,
  whatsappLabel = "WhatsApp",
  messengerLabel = "Messenger",
}: {
  whatsappNumber?: string | null;
  messengerUrl?: string | null;
  whatsappLabel?: string;
  messengerLabel?: string;
}) {
  const digits = (whatsappNumber ?? "").replace(/\D/g, "");
  const hasWhatsapp = digits.length > 0;
  const hasMessenger = !!(messengerUrl && messengerUrl.trim());
  if (!hasWhatsapp && !hasMessenger) return null;
  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col gap-3">
      {hasWhatsapp ? (
        <a
          href={`https://wa.me/${digits}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={whatsappLabel}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#25D366] text-white shadow-lg transition hover:scale-105"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.9-4.45 9.9-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.03h-.01a8.2 8.2 0 0 1-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.12-.14.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.35-.77-1.84-.2-.48-.4-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.58 1.74-1.13.27-.55.27-1.02.19-1.13-.09-.1-.23-.16-.48-.29z" />
          </svg>
        </a>
      ) : null}
      {hasMessenger ? (
        <a
          href={messengerUrl as string}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={messengerLabel}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-[#0084FF] text-white shadow-lg transition hover:scale-105"
        >
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.14 2 11.25c0 2.91 1.43 5.52 3.68 7.14V22l3.34-1.84c.92.26 1.92.4 2.98.4 5.52 0 10-4.14 10-9.25S17.52 2 12 2zm1.07 12.46-2.54-2.71-4.95 2.71 5.45-5.79 2.61 2.71 4.88-2.71-5.45 5.79z" />
          </svg>
        </a>
      ) : null}
    </div>
  );
}
