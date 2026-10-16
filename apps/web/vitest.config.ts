import path from "node:path";
import { defineConfig } from "vitest/config";

// EB5: the suite previously imported only relative paths + @repo/ui, so
// no alias was configured. Component render specs (orders extraction
// smoke) import dashboard components that use the app's "@/…" alias
// (tsconfig paths) — mirror it here. Everything else stays vitest
// defaults (per-file environment via docblock, default include glob).
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
