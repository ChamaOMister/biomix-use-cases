import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Same `@/` alias as tsconfig.json, so server modules shared with the app resolve in tests.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Warns when the Postgres tests will be skipped, and fails in CI instead.
    globalSetup: ["src/server/db/vitest-global-setup.ts"],
  },
});
