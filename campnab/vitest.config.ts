import { defineConfig } from "vitest/config";

// Self-contained config so campnab's tests run in isolation from the repo
// suite (which is anchored to src/** and extensions/**).
//   npx vitest run --config campnab/vitest.config.ts
export default defineConfig({
  test: {
    root: __dirname,
    include: ["**/*.test.ts"],
    environment: "node",
  },
});
