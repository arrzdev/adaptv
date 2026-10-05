import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"
import {
  OTA_CONFIG_VIRTUAL_ID,
  renderOtaConfigModule,
} from "./src/ota/build/ota-config-module"
import {
  ROUTE_TINTS_VIRTUAL_ID,
  renderRouteTintsModule,
} from "./src/vite/route-tints-module"
import {
  renderSecureStorageModule,
  SECURE_STORAGE_VIRTUAL_ID,
} from "./src/vite/secure-storage-module"
import { adaptvPwaRegisterPlugin } from "./src/vite/virtuals"

//mirror the package's "#adaptv/*" subpath import (package.json "imports") so tests can
//use the same self-alias the source does instead of brittle relative paths
const srcDir = fileURLToPath(new URL("./src", import.meta.url))

/**
 * `virtual:adaptv/ota-config` with OTA off — the real module source, not a stub.
 *
 * The plugin that serves this in a build needs an `AdaptvContext` and reads
 * `node_modules` to compute a fingerprint, neither of which a unit test has. But
 * `null` is not an invented value: it is exactly what a real build emits for an
 * app that declares no `web.origin`, so the shell mounts down the same path a
 * web-only consumer gets.
 */
function otaConfigOffPlugin(): Plugin {
  const resolved = `\0${OTA_CONFIG_VIRTUAL_ID}`
  return {
    name: "test:ota-config-off",
    resolveId: (id) => (id === OTA_CONFIG_VIRTUAL_ID ? resolved : null),
    load: (id) => (id === resolved ? renderOtaConfigModule(null) : null),
  }
}

/**
 * `virtual:adaptv/secure-storage` with the optional peer absent — again the real
 * module source, for the case adaptv itself is in: it does not depend on the
 * Keychain package, so "not installed" is the honest answer here.
 */
function secureStorageAbsentPlugin(): Plugin {
  const resolved = `\0${SECURE_STORAGE_VIRTUAL_ID}`
  return {
    name: "test:secure-storage-absent",
    resolveId: (id) =>
      id === SECURE_STORAGE_VIRTUAL_ID ? resolved : null,
    load: (id) =>
      id === resolved ? renderSecureStorageModule(false) : null,
  }
}

/**
 * `virtual:adaptv/route-tints` with an empty table — again the real module source.
 *
 * adaptv has no app routes of its own, so "no route declares a tint" is the honest
 * answer here, and it is the same answer a consumer app that declares none gets.
 * What the table does when it is NOT empty is covered where it can be covered
 * properly: `shell/route-tints.test.ts`, `vite/route-tints.test.ts` and
 * `shell/theme-init-script.test.ts` for the pre-paint script, and the playground's
 * `e2e/route-tint.spec.ts` for the whole path through a real browser.
 */
function routeTintsEmptyPlugin(): Plugin {
  const resolved = `\0${ROUTE_TINTS_VIRTUAL_ID}`
  return {
    name: "test:route-tints-empty",
    resolveId: (id) => (id === ROUTE_TINTS_VIRTUAL_ID ? resolved : null),
    load: (id) => (id === resolved ? renderRouteTintsModule([]) : null),
  }
}

//happy-dom gives the hook a document to mount into (Testing Library's
//renderHook); the engine itself only touches the synthetic events it's handed
export default defineConfig({
  //the shell imports `virtual:adaptv/pwa-register`, which adaptv's own Vite plugin
  //provides in a real app build — so any test that mounts the shell needs it too.
  //Reusing the plugin (rather than stubbing the id) keeps the test graph resolving
  //the same module source consumers get.
  plugins: [
    adaptvPwaRegisterPlugin(),
    otaConfigOffPlugin(),
    secureStorageAbsentPlugin(),
    routeTintsEmptyPlugin(),
  ],
  resolve: {
    alias: { "#adaptv": srcDir },
  },
  test: {
    //The default, not the rule: code that runs in Node — the CLI under `bin/` and
    //the build plugins under `src/vite/` — says `// @vitest-environment node` at
    //the top of its test. Loading happy-dom is most of what an isolated test file
    //costs, and a build plugin tested inside a fake browser is tested somewhere it
    //never runs.
    environment: "happy-dom",
    //unmounts every Testing Library render between tests — see vitest.setup.ts
    setupFiles: ["./vitest.setup.ts"],
    //`.project-zero/` holds a local copy of a real consumer app used to exercise
    //adaptv end-to-end. It has its own suites (and its own vitest/playwright
    //configs), which must never be collected into the framework's gate — they
    //would fail here for reasons that say nothing about adaptv.
    //`.claude/worktrees/` is the same problem from the other direction: each
    //worktree is a whole second checkout of this repo, so collecting it runs
    //every suite again against another branch's source. Left in, the gate
    //reports on code the working tree does not contain.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      ".project-zero/**",
      "playground/**",
      ".claude/**",
    ],
    //Only read when a run asks for it (`pnpm test:coverage`); a plain `pnpm test`
    //never loads the provider. There are deliberately no thresholds: a floor
    //would fail a PR for landing a file before its tests, and turn the percentage
    //into a number to defend. It is a map to read.
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}", "bin/**/*.mjs"],
      exclude: [
        "**/*.test.{ts,tsx,mjs}",
        "**/*.test-helper.ts",
        "src/test-utils/**",
        "**/*.d.ts",
        "**/*.gen.*",
        //Aliased per app: `#adaptv-route-tree` is `<app>/.adaptv/routeTree.gen.ts`,
        //which only a consumer build maps (bundler alias + tsconfig paths). No test
        //imports this module, so coverage transforms it cold to report it as
        //uncovered, Vite reads the specifier as one of this package's own `imports`
        //entries, throws `Missing "#adaptv-route-tree" specifier`, and the whole run
        //exits 1 with no report. It has no logic to measure: it forwards the app's
        //route tree and router options to `createAdaptvRouter`, which is measured.
        "src/routes/router-entry.tsx",
      ],
      reporter: ["text-summary", "html", "json-summary"],
      reportsDirectory: "./coverage",
      //a red test must not also cost the map: the summary is still worth reading
      reportOnFailure: true,
    },
  },
})
