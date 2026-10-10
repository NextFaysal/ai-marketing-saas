import type { Config } from "tailwindcss";
export default {
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
        },
        ink: { 950: "#0a0f1e", 900: "#0f172a", 800: "#1e293b" },
      },
      boxShadow: {
        card: "0 1px 2px rgba(15,23,42,0.05), 0 4px 16px -4px rgba(15,23,42,0.08)",
        "card-hover": "0 2px 4px rgba(15,23,42,0.06), 0 12px 32px -8px rgba(15,23,42,0.16)",
        glow: "0 8px 24px -8px rgba(99,102,241,0.55)",
        drawer: "0 0 60px rgba(2,6,23,0.45)",
      },
      borderRadius: { "4xl": "2rem" },
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
