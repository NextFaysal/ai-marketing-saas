import type { Config } from "tailwindcss";
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: { extend: { fontFamily: { sans: ['"Inter Variable"', "Inter", "ui-sans-system", "system-ui", "sans-serif"] } } },
  plugins: [],
} satisfies Config;
