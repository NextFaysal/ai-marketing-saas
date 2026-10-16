import type { Config } from "tailwindcss";
export default {
  // ED17 (EB7): class-strategy dark mode. Additive — nothing in the
  // tree used dark: variants before this, so enabling the strategy
  // alone changes no rendered output. The `dark` class itself is
  // applied ONLY to the dashboard root (lib/theme.ts + the dashboard
  // layout bootstrap); globals.css carries the token re-declarations
  // and the scoped literal-class override layer.
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', "Inter", "ui-sans-system", "system-ui", "-apple-system", '"Segoe UI"', "Roboto", '"Helvetica Neue"', "Arial", "sans-serif"],
      },
      colors: {
        brand: {
          50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc", 400: "#818cf8",
          500: "#6366f1", 600: "#5457e8", 700: "#4548c9", 800: "#3a3da3", 900: "#32337f",
          // ED1 (Tokens v3): var-driven brand entry points. The numeric
          // palette above stays literal so existing brand-500/15-style
          // opacity utilities keep compiling to the same colours.
          DEFAULT: "var(--brand)",
          strong: "var(--brand-strong)",
          soft: "var(--brand-soft)",
        },
        ink: {
          950: "#0a0f1e", 900: "#0f172a", 800: "#1e293b",
          // ED1: named ink steps read the CSS variables (single source).
          strong: "var(--ink-strong)",
          body: "var(--ink-body)",
          muted: "var(--ink-muted)",
          faint: "var(--ink-faint)",
          inverse: "var(--ink-inverse)",
        },
        // ED1: surface + semantic utilities backed by the token layer.
        // NOTE: var()-valued colours do not support Tailwind opacity
        // modifiers (bg-surface/50) — use the -soft tokens instead.
        surface: {
          DEFAULT: "var(--surface)",
          muted: "var(--surface-muted)",
          raised: "var(--surface-raised)",
          sunken: "var(--surface-sunken)",
        },
        success: { DEFAULT: "var(--success)", bright: "var(--success-bright)", soft: "var(--success-soft)" },
        warning: { DEFAULT: "var(--warning)", bright: "var(--warning-bright)", soft: "var(--warning-soft)" },
        danger: { DEFAULT: "var(--danger)", soft: "var(--danger-soft)" },
        info: { DEFAULT: "var(--info)", soft: "var(--info-soft)" },
      },
      // ED1: shadows read the --shadow-* tokens; the token defaults in
      // globals.css ARE the literals that stood here before, so every
      // shadow-card / shadow-glow consumer renders identically and the
      // values can never drift between config and CSS again.
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        glow: "var(--shadow-glow)",
        drawer: "var(--shadow-drawer)",
      },
      // ED1: type-scale utilities (text-display, text-page, text-body…)
      // wired to the --text-* tokens.
      fontSize: {
        display: ["var(--text-display)", { lineHeight: "var(--text-display-lh)" }],
        page: ["var(--text-page-title)", { lineHeight: "var(--text-page-title-lh)" }],
        section: ["var(--text-section)", { lineHeight: "var(--text-section-lh)" }],
        body: ["var(--text-body)", { lineHeight: "var(--text-body-lh)" }],
        small: ["var(--text-small)", { lineHeight: "var(--text-small-lh)" }],
        micro: ["var(--text-micro)", { lineHeight: "var(--text-micro-lh)" }],
      },
      borderRadius: {
        "4xl": "2rem",
        // ED1: rounded-card reads --radius-card (the v2 card radius).
        card: "var(--radius-card)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-in": { from: { transform: "translateX(-100%)" }, to: { transform: "translateX(0)" } },
        "rise": { from: { opacity: "0", transform: "translateY(6px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out both",
        "slide-in": "slide-in 0.25s cubic-bezier(0.32,0.72,0,1) both",
        "rise": "rise 0.35s ease-out both",
      },
    },
  },
  plugins: [],
} satisfies Config;
