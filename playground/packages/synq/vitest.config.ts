import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

//mirror the package's "#synq/*" subpath import (package.json "imports") so
//tests use the same self-alias the source does, not brittle relative paths
const srcDir = fileURLToPath(new URL("./src", import.meta.url))

//the core is pure TypeScript with no DOM or IndexedDB dependency, so the
//node environment is enough — adapters (react, storage) bring their own
export default defineConfig({
  resolve: {
    alias: { "#synq": srcDir },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
})
