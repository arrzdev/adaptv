// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin, ResolvedConfig } from "vite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { adaptvRootRoutePlugin } from "#adaptv/vite/root-route-module.ts"
import { adaptvShellEmitPlugin } from "#adaptv/vite/shell-emit.ts"
import { adaptvStaticHostPlugin } from "#adaptv/vite/static-host.ts"
import { adaptvSwBuildPlugin } from "#adaptv/vite/sw-build.ts"

/*
 * What the build writes when the app does not live at the origin root.
 * → `docs/decisions/register.md` B1
 *
 * A GitHub Pages project site is served from `/<repo>/`, so the build runs with
 * `base: "/<repo>/"` and every URL it writes for the browser has to start there.
 * Each emitter used to assume `/`: the shell linked `/assets/*` and
 * `/manifest.json`, the worker bound `/index.html`, the SPA rule rewrote `/*`,
 * and the head linked `/favicons/*`. Every one of those is a 404 under the base,
 * and the first of them is the whole app failing to boot.
 *
 * Asserted on the bytes each plugin writes, driven through the same hooks Vite
 * calls, at `/app/` and — as the control that the fix is not a subpath special
 * case — at `/`. The browser half is `playground/e2e-sw/subpath.spec.ts`.
 */

const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

//the shell prerenders the boot error screen and the worker runs esbuild and
//workbox, per base; generous because the gate runs every suite in parallel
const BUILD_TIMEOUT = 180_000

/** A finished `render: "spa"` client build, as the post-build emitters see it. */
function scaffold() {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-subpath-"))
  roots.push(appRoot)
  //the boot fallback prerender resolves React from the app (register B31)
  mkdirSync(path.join(appRoot, "node_modules"))
  for (const pkg of ["react", "react-dom"])
    symlinkSync(
      path.join(process.cwd(), "node_modules", pkg),
      path.join(appRoot, "node_modules", pkg),
      "dir",
    )
  mkdirSync(path.join(appRoot, "src/routing"), { recursive: true })
  const clientDir = path.join(appRoot, "dist/client")
  const files: Record<string, string> = {
    "assets/client-e1.js": "console.log('entry')",
    "assets/react-r1.js": "console.log('react')",
    "assets/main-c1.css": "html{}",
    "manifest.json": "{}",
  }
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(clientDir, name)), {
      recursive: true,
    })
    writeFileSync(path.join(clientDir, name), contents)
  }
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
  return { appRoot, clientDir, context }
}

function resolve(plugin: Plugin, appRoot: string, base: string) {
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  ;(plugin.configResolved as any)?.call({}, {
    root: appRoot,
    base,
    environments: { client: { build: { outDir: "dist/client" } } },
  } as unknown as ResolvedConfig)
}

/**
 * The client manifest, as the shell emitter reads it: out of the bundle in
 * `generateBundle`, under the path its `configEnvironment` asked Vite for. It
 * is never on disk (`shell-emit.ts`), so the scaffold writes no file for it.
 */
const CLIENT_MANIFEST = {
  "src/client-entry.tsx": {
    file: "assets/client-e1.js",
    isEntry: true,
    imports: ["_react.js"],
    css: ["assets/main-c1.css"],
  },
  "_react.js": { file: "assets/react-r1.js" },
}
const SHELL_MANIFEST_FILE = ".vite/adaptv-shell-manifest.json"

/** Vite's client-build hooks the shell emitter reads the manifest through. */
async function bundleClient(plugin: Plugin): Promise<void> {
  const configEnvironment = plugin.configEnvironment
  if (typeof configEnvironment !== "object" || !configEnvironment.handler)
    throw new Error(
      `${plugin.name}: configEnvironment must be an object hook`,
    )
    // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  ;(configEnvironment.handler as any).call(
    {},
    "client",
    { build: {} },
    { command: "build", mode: "production" },
  )
  const generate = plugin.generateBundle
  if (typeof generate !== "object" || !generate.handler)
    throw new Error(
      `${plugin.name}: generateBundle must be an object hook`,
    )
  const bundle = {
    [SHELL_MANIFEST_FILE]: {
      type: "asset",
      fileName: SHELL_MANIFEST_FILE,
      source: JSON.stringify(CLIENT_MANIFEST),
    },
  }
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  await (generate.handler as any).call(
    {
      environment: {
        name: "client",
        config: { build: { manifest: SHELL_MANIFEST_FILE } },
      },
    },
    {},
    bundle,
    false,
  )
}

async function buildApp(plugin: Plugin): Promise<void> {
  const hook = plugin.buildApp
  if (typeof hook !== "object" || !hook.handler)
    throw new Error(`${plugin.name}: buildApp must be an object hook`)
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  await (hook.handler as any).call({}, {})
}

type Emitted = {
  shell: string
  worker: string
  redirects: string
  headLinks: string
}

/** Run the post-build emitters in the order `adaptv-plugin.ts` registers them. */
async function emitAt(base: string): Promise<Emitted> {
  const { appRoot, clientDir, context } = scaffold()
  const shell = adaptvShellEmitPlugin(context)
  const plugins = [
    shell,
    adaptvSwBuildPlugin(context),
    adaptvStaticHostPlugin(context),
  ]
  await bundleClient(shell)
  for (const plugin of plugins) resolve(plugin, appRoot, base)
  for (const plugin of plugins) await buildApp(plugin)

  const rootRoute = adaptvRootRoutePlugin(context)
  resolve(rootRoute, appRoot, base)
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  const headLinks = (rootRoute.load as any).call(
    {},
    "\0virtual:adaptv/root-route",
  ) as string

  const read = (name: string) =>
    readFileSync(path.join(clientDir, name), "utf8")
  return {
    shell: read("index.html"),
    worker: read("sw.js"),
    redirects: read("_redirects"),
    headLinks,
  }
}

/** Every `href`/`src` attribute value in a document. */
function urlsIn(html: string): string[] {
  return [...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map(
    (match) => match[1] as string,
  )
}

/** The string passed under `key` in the minified worker (names survive). */
function stamped(worker: string, key: string): string[] {
  return [...worker.matchAll(new RegExp(`\\b${key}:"([^"]*)"`, "g"))].map(
    (match) => match[1] as string,
  )
}

let atApp: Emitted
let atRoot: Emitted
beforeAll(async () => {
  //sequential: both share esbuild, workbox and the prerender
  atApp = await emitAt("/app/")
  atRoot = await emitAt("/")
}, BUILD_TIMEOUT)

describe("the app shell under a subpath base", () => {
  it("links the entry, its preloads, the stylesheet and the manifest under the base", () => {
    expect(urlsIn(atApp.shell)).toEqual([
      "/app/manifest.json",
      "/app/assets/main-c1.css",
      "/app/assets/react-r1.js",
      "/app/assets/client-e1.js",
    ])
  })

  it("writes the same links at the origin root when the base is `/`", () => {
    expect(urlsIn(atRoot.shell)).toEqual([
      "/manifest.json",
      "/assets/main-c1.css",
      "/assets/react-r1.js",
      "/assets/client-e1.js",
    ])
  })
})

describe("the service worker under a subpath base", () => {
  it("binds the navigation route to the shell under the base", () => {
    //a precache miss otherwise: the SPA worker throws `non-precached-url` and
    //offline has nothing to answer with
    expect(stamped(atApp.worker, "appShellUrl")).toEqual([
      "/app/index.html",
    ])
    expect(stamped(atRoot.worker, "appShellUrl")).toEqual(["/index.html"])
  })

  it("hands the base to the routes that resolve their prefixes under it", () => {
    //the navigation denylist, the asset matcher and the runtime cache sweep,
    //all built from this
    expect(stamped(atApp.worker, "base")).toEqual([
      "/app/",
      "/app/",
      "/app/",
    ])
    expect(stamped(atRoot.worker, "base")).toEqual(["/", "/", "/"])
  })
})

describe("the static host rule under a subpath base", () => {
  it("rewrites the app's own paths to its own shell", () => {
    expect(atApp.redirects).toBe("/app/*    /app/index.html   200\n")
    expect(atRoot.redirects).toBe("/*    /index.html   200\n")
  })
})

describe("the head icon links under a subpath base", () => {
  it("links adaptv's default icons under the base", () => {
    //no app art in the fixture, so the head carries adaptv's own set
    const hrefs = (source: string) =>
      [...source.matchAll(/"?href"?:\s*"([^"]+)"/g)].map(
        (match) => match[1] as string,
      )
    expect(hrefs(atApp.headLinks).length).toBeGreaterThan(0)
    for (const href of hrefs(atApp.headLinks))
      expect(href).toMatch(/^\/app\/adaptv-icons\//)
    for (const href of hrefs(atRoot.headLinks))
      expect(href).toMatch(/^\/adaptv-icons\//)
  })
})
