import path from "node:path";
import { defineConfig } from "vitest/config";

// ML7: admin components now import the dictionary via the app's "@/…"
// alias (tsconfig paths) — mirror it here so vitest resolves it the
// same way the web suite does. Everything else stays vitest defaults.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
