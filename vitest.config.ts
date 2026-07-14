import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

//mirror the package's "#nativ/*" subpath import (package.json "imports") so tests can
//use the same self-alias the source does instead of brittle relative paths
const srcDir = fileURLToPath(new URL("./src", import.meta.url))

//happy-dom gives the hook a document to mount into (Testing Library's
//renderHook); the engine itself only touches the synthetic events it's handed
export default defineConfig({
  resolve: {
    alias: { "#nativ": srcDir },
  },
  test: {
    environment: "happy-dom",
  },
})
