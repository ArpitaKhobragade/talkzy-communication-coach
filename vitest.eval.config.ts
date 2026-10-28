import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));

// The quality check calls the real AI services, so it is kept apart from the normal unit tests.
export default defineConfig({
  resolve: { alias: { "@": path.resolve(dir, "src") } },
  test: { include: ["evals/**/*.eval.ts"], environment: "node", testTimeout: 900_000 },
});
