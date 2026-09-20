// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin, UserConfig } from "vite"
import { afterAll, describe, expect, it } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { adaptvShellEmitPlugin } from "#adaptv/vite/shell-emit.ts"

/*
 * The manifest is an input to the shell, never an output of the build.
 * → `docs/design/rendering.md` §3.1.2
 *
 * Written, `.vite/manifest.json` shipped inside `.output/public` and `dist/client`:
 * Nitro listed it in the SSR server's public asset table, so a deployed app served
 * its whole source-to-chunk map at `/.vite/manifest.json`, and a static host
 * published the same file. Nothing reads it at runtime — TanStack Start builds its
 * route preloads from the bundle — so the emitter takes it out of the bundle it
 * reads it from. A real Vite build, because only Vite can say whether its own
 * manifest hook ran before this one; `shell-emit.test.ts` covers the markup.
 */

const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

//the boot fallback prerender bundles React on every emit
const PRERENDER_TIMEOUT = 120_000

async function buildApp(
  appConfig: UserConfig = {},
  laterPlugins: Plugin[] = [],
): Promise<string> {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-shell-build-"))
  roots.push(appRoot)
  //the prerender resolves React from the APP (register B31), linked the way pnpm would
  mkdirSync(path.join(appRoot, "node_modules"))
  for (const pkg of ["react", "react-dom"])
    symlinkSync(
      path.join(process.cwd(), "node_modules", pkg),
      path.join(appRoot, "node_modules", pkg),
      "dir",
    )
  mkdirSync(path.join(appRoot, "src/routing"), { recursive: true })
  writeFileSync(
    path.join(appRoot, "entry.js"),
    'import("./lazy.js")\nexport const app = 1\n',
  )
  writeFileSync(path.join(appRoot, "lazy.js"), "export const lazy = 2\n")

  const context: AdaptvContext = {
    appRoot,
    target: "web",
    web: { render: "spa", sw: { enabled: true } },
    loaded: {
      watchFiles: [],
      config: {
        name: "Probe",
        description: "fixture",
        themeColor: { light: "#f0f0f0", dark: "#101010" },
        styles: "./src/styles/main.css",
        router: {},
      },
    },
  }

  const { createBuilder } = await import("vite")
  const builder = await createBuilder({
    root: appRoot,
    configFile: false,
    logLevel: "silent",
    plugins: [adaptvShellEmitPlugin(context), ...laterPlugins],
    environments: {
      client: {
        build: {
          outDir: "dist/client",
          rollupOptions: { input: path.join(appRoot, "entry.js") },
        },
      },
    },
    ...appConfig,
    builder: {
      async buildApp(b) {
        await b.build(b.environments.client)
      },
    },
  })
  await builder.buildApp()
  return path.join(appRoot, "dist/client")
}

describe("adaptvShellEmitPlugin — in a real app build", () => {
  it(
    "emits the shell from the manifest and leaves no manifest in the output",
    async () => {
      const clientDir = await buildApp()
      const html = readFileSync(path.join(clientDir, "index.html"), "utf8")
      //the shell really came from this build's manifest: its hashed entry exists
      const entry = html.match(
        /<script type="module" src="\/(assets\/[^"]+\.js)"><\/script>/,
      )?.[1]
      expect(entry).toBeDefined()
      expect(existsSync(path.join(clientDir, entry as string))).toBe(true)
      expect(existsSync(path.join(clientDir, ".vite/manifest.json"))).toBe(
        false,
      )
      expect(existsSync(path.join(clientDir, ".vite"))).toBe(false)
    },
    PRERENDER_TIMEOUT,
  )

  it(
    "keeps the manifest for an app that turned it on itself",
    async () => {
      const clientDir = await buildApp({ build: { manifest: true } })
      expect(existsSync(path.join(clientDir, ".vite/manifest.json"))).toBe(
        true,
      )
      expect(existsSync(path.join(clientDir, "index.html"))).toBe(true)
    },
    PRERENDER_TIMEOUT,
  )

  it(
    "keeps the manifest a plugin after it turned on",
    async () => {
      //a `config` hook listed after this plugin runs after this plugin's `config`,
      //so the check has to wait for every one of them
      const clientDir = await buildApp({}, [
        {
          name: "later-asks-for-manifest",
          config: () => ({ build: { manifest: true } }),
        },
      ])
      expect(existsSync(path.join(clientDir, ".vite/manifest.json"))).toBe(
        true,
      )
      expect(existsSync(path.join(clientDir, "index.html"))).toBe(true)
    },
    PRERENDER_TIMEOUT,
  )

  it(
    "reads and keeps the manifest at the path the app chose",
    async () => {
      const clientDir = await buildApp({}, [
        {
          name: "app-manifest-path",
          config: () => ({
            environments: {
              client: { build: { manifest: "build-manifest.json" } },
            },
          }),
        },
      ])
      expect(existsSync(path.join(clientDir, "build-manifest.json"))).toBe(
        true,
      )
      expect(existsSync(path.join(clientDir, ".vite"))).toBe(false)
      const html = readFileSync(path.join(clientDir, "index.html"), "utf8")
      expect(html).toMatch(
        /<script type="module" src="\/assets\/[^"]+\.js">/,
      )
    },
    PRERENDER_TIMEOUT,
  )
})
