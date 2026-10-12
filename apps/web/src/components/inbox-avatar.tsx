import React from "react";

const AVATAR_GRADIENTS = [
  "from-violet-500 to-indigo-600",
  "from-blue-500 to-cyan-600",
  "from-emerald-500 to-teal-600",
  "from-rose-500 to-pink-600",
  "from-amber-500 to-orange-600",
  "from-fuchsia-500 to-purple-600",
  "from-sky-500 to-blue-600",
  "from-indigo-500 to-purple-600",
];

function getGradient(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[idx] ?? AVATAR_GRADIENTS[0]!;
}

function getInitials(name?: string | null, fallback = "?"): string {
  if (!name || !name.trim()) return fallback;
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0]!.slice(0, 2).toUpperCase();
  }
  return ((parts[0]?.[0] ?? "") + (parts[parts.length - 1]?.[0] ?? "")).toUpperCase();
}

const CHANNEL_ICONS: Record<string, { icon: string; bg: string }> = {
  whatsapp: { icon: "🟢", bg: "bg-emerald-500" },
  messenger: { icon: "🔵", bg: "bg-sky-500" },
  instagram: { icon: "🟣", bg: "bg-fuchsia-500" },
  webchat: { icon: "🌐", bg: "bg-slate-600" },
  tiktok: { icon: "⚫", bg: "bg-black" },
  telegram: { icon: "✈️", bg: "bg-cyan-500" },
  email: { icon: "✉️", bg: "bg-amber-500" },
};

export function ContactAvatar({
  name,
  channel,
  size = "md",
  isOnline = false,
}: {
  name?: string | null;
  channel?: string;
  size?: "sm" | "md" | "lg";
  isOnline?: boolean;
}) {
  const initials = getInitials(name);
  const gradient = getGradient(name || "User");
  const channelMeta = channel ? CHANNEL_ICONS[channel] : undefined;

  const sizeCls = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-lg font-bold",
  }[size];

  return (
    <div className="relative shrink-0">
      <div
        className={`${sizeCls} flex items-center justify-center rounded-2xl bg-gradient-to-br ${gradient} font-semibold text-white shadow-sm ring-2 ring-white/80`}
      >
        {initials}
      </div>
      {channelMeta && (
        <span
          className={`absolute -bottom-1 -right-1 flex ${size === "sm" ? "h-4 w-4 text-[9px]" : "h-4.5 w-4.5 text-[10px]"} items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-slate-100`}
          title={channel}
        >
          {channelMeta.icon}
        </span>
      )}
      {isOnline && (
        <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
        </span>
      )}
    </div>
  );
}
