import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"
import { adaptvPwaRegisterPlugin } from "./src/vite/virtuals"

//mirror the package's "#adaptv/*" subpath import (package.json "imports") so tests can
//use the same self-alias the source does instead of brittle relative paths
const srcDir = fileURLToPath(new URL("./src", import.meta.url))

//happy-dom gives the hook a document to mount into (Testing Library's
//renderHook); the engine itself only touches the synthetic events it's handed
export default defineConfig({
  //the shell imports `virtual:adaptv/pwa-register`, which adaptv's own Vite plugin
  //provides in a real app build — so any test that mounts the shell needs it too.
  //Reusing the plugin (rather than stubbing the id) keeps the test graph resolving
  //the same module source consumers get.
  plugins: [adaptvPwaRegisterPlugin()],
  resolve: {
    alias: { "#adaptv": srcDir },
  },
  test: {
    environment: "happy-dom",
    //unmounts every Testing Library render between tests — see vitest.setup.ts
    setupFiles: ["./vitest.setup.ts"],
    //`.project-zero/` holds a local copy of a real consumer app used to exercise
    //adaptv end-to-end. It has its own suites (and its own vitest/playwright
    //configs), which must never be collected into the framework's gate — they
    //would fail here for reasons that say nothing about adaptv.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ".project-zero/**",
      "playground/**",
    ],
  },
})
