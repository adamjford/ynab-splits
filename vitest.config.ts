import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    environment: "node",
    include: ["app/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: [
        "app/domain/**/*.ts",
        "app/db/**/*.server.ts",
        "app/importer/**/*.ts",
        "app/services/**/*-orchestration.server.ts",
        "app/services/ledger-query.server.ts",
        "app/services/settings.server.ts",
      ],
      exclude: ["**/*.test.*", "**/*.d.ts"],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
