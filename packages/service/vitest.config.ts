import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
  },
  resolve: {
    conditions: ["import", "module", "default"],
  },
});
