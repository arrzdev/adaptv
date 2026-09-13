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
import type { Plugin, ResolvedConfig } from "vite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { BOOT_FALLBACK_ID } from "#adaptv/shell/boot-fallback.ts"
import { PREFERENCE_ATTR } from "#adaptv/shell/theme-init-script.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { adaptvShellEmitPlugin } from "#adaptv/vite/shell-emit.ts"

/*
 * The emitted app shell, per lineage. → `docs/design/rendering.md` §3.1.2 (generated,
 * never captured), §3.1.3 (the boot fallback), §3.1 (the measured modulepreload
 * gap), §3.3 (the filename per render mode)
 *
 * `renderAppShell` has its own suite for the markup. What only the emitter can
 * get wrong is the wiring: reading Vite's manifest into hrefs, prerendering the
 * boot error screen into the document, and writing the file under the name the
 * worker and the static host both bind to.
 *
 * Each emit bundles React for the boot fallback prerender, so the shells are
 * built once in `beforeAll` and every assertion reads them.
 */

const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/**
 * A Vite client manifest shaped like a real one: an entry with a two-level
 * static import graph, a shared chunk reached twice, and a route chunk that is
 * only ever imported dynamically.
 */
const manifest = {
  "src/client-entry.tsx": {
    file: "assets/client-e1.js",
    isEntry: true,
    imports: ["_react.js", "_router.js"],
    dynamicImports: ["src/routing/settings.tsx"],
    css: ["assets/main-c1.css"],
  },
  "_react.js": { file: "assets/react-r1.js" },
  "_router.js": { file: "assets/router-o1.js", imports: ["_shared.js"] },
  "_shared.js": { file: "assets/shared-s1.js", imports: ["_react.js"] },
  "src/routing/settings.tsx": {
    file: "assets/settings-d1.js",
    isDynamicEntry: true,
    imports: ["_react.js"],
  },
}

/** An app root and a finished client build, minus the shell. */
function scaffold(
  render: "ssr" | "spa",
  target: "web" | "capacitor",
  clientManifest: object = manifest,
) {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-shell-emit-"))
  roots.push(appRoot)
  //the prerender resolves React from the APP, the copy it ships (register B31),
  //so the throwaway app needs one: adaptv's own, linked the way pnpm would
  mkdirSync(path.join(appRoot, "node_modules"))
  for (const pkg of ["react", "react-dom"])
    symlinkSync(
      path.join(process.cwd(), "node_modules", pkg),
      path.join(appRoot, "node_modules", pkg),
      "dir",
    )
  const clientDir = path.join(appRoot, "dist/client")
  mkdirSync(path.join(clientDir, ".vite"), { recursive: true })
  mkdirSync(path.join(clientDir, "assets"), { recursive: true })
  writeFileSync(
    path.join(clientDir, ".vite/manifest.json"),
    JSON.stringify(clientManifest),
  )
  writeFileSync(path.join(clientDir, "assets/app-unlinked9.css"), "html{}")
  //a route file with content in it: a captured render would carry this text
  mkdirSync(path.join(appRoot, "src/routing"), { recursive: true })
  writeFileSync(
    path.join(appRoot, "src/routing/index.tsx"),
    'export const Route = () => "Welcome back, Alice"\n',
  )

  const context: AdaptvContext = {
    appRoot,
    target,
    web: { render, sw: { enabled: target === "web" } },
    loaded: {
      watchFiles: [],
      config: {
        name: "Probe",
        title: "Probe Title",
        description: "fixture",
        themeColor: { light: "#f0f0f0", dark: "#101010" },
        styles: "./src/styles/main.css",
        router: {},
      },
    },
  }
  return { appRoot, clientDir, context }
}

async function emit(
  context: AdaptvContext,
  appRoot: string,
): Promise<void> {
  const plugin = adaptvShellEmitPlugin(context)
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  ;(plugin.configResolved as any).call({}, {
    root: appRoot,
    base: "/",
    environments: { client: { build: { outDir: "dist/client" } } },
  } as unknown as ResolvedConfig)
  const hook = (plugin as Plugin).buildApp
  if (typeof hook !== "object" || !hook.handler)
    throw new Error(
      "buildApp must be an object hook so `order` can be set",
    )
  expect(hook.order).toBe("post")
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  await (hook.handler as any).call({}, {})
}

//prerendering bundles React from scratch on every emit
const PRERENDER_TIMEOUT = 120_000

type Emitted = { clientDir: string; html: string }
let spa: Emitted
let spaAgain: Emitted
let ssr: Emitted
let native: Emitted

beforeAll(async () => {
  const build = async (
    render: "ssr" | "spa",
    target: "web" | "capacitor",
  ) => {
    const { appRoot, clientDir, context } = scaffold(render, target)
    await emit(context, appRoot)
    const name = render === "spa" ? "index.html" : "adaptv-shell.html"
    return {
      clientDir,
      html: readFileSync(path.join(clientDir, name), "utf8"),
    }
  }
  ;[spa, spaAgain, ssr, native] = await Promise.all([
    build("spa", "web"),
    build("spa", "web"),
    build("ssr", "web"),
    build("spa", "capacitor"),
  ])
}, PRERENDER_TIMEOUT)

describe("adaptvShellEmitPlugin — the shell each lineage boots from", () => {
  it("names the file by render mode: index.html for spa, adaptv-shell.html for ssr, never both", () => {
    //an SSR `index.html` is a directory index, and asset-first hosts serve it for
    //`/` instead of running the server (§3.3, measured on Cloudflare)
    expect(existsSync(path.join(spa.clientDir, "adaptv-shell.html"))).toBe(
      false,
    )
    expect(existsSync(path.join(ssr.clientDir, "index.html"))).toBe(false)
    //the native lineage is spa too, and the WebView loads index.html
    expect(existsSync(path.join(native.clientDir, "index.html"))).toBe(
      true,
    )
  })

  it("preloads the entry's whole static import graph, once each, and no dynamic import", () => {
    const preloads = [
      ...spa.html.matchAll(/<link rel="modulepreload" href="([^"]+)">/g),
    ].map((match) => match[1])
    //the second level (`shared`, reached only through `router`) is the one the
    //measurement was about: without it, it waits for the first level to parse
    expect(preloads.sort()).toEqual(
      [
        "/assets/react-r1.js",
        "/assets/router-o1.js",
        "/assets/shared-s1.js",
      ].sort(),
    )
    //a route chunk is every route in the app; the shell serves any of them
    expect(spa.html).not.toContain("settings-d1.js")
    expect(spa.html).toContain(
      '<script type="module" src="/assets/client-e1.js"></script>',
    )
    expect(spa.html).toContain('href="/assets/main-c1.css"')
  })

  it("carries the theme stamp ahead of the stylesheet and the boot fallback in the body", () => {
    for (const { html } of [spa, ssr, native]) {
      const themeScript = html.indexOf(PREFERENCE_ATTR)
      expect(themeScript).toBeGreaterThan(-1)
      expect(themeScript).toBeLessThan(html.indexOf('rel="stylesheet"'))
      //both theme colours from config, baked in before first paint
      expect(html).toContain("#f0f0f0")
      expect(html).toContain("#101010")
      //prerendered adaptv's default screen, not merely the empty container
      expect(html).toContain(`id="${BOOT_FALLBACK_ID}"`)
      expect(html).toContain('data-adaptv="boot-error"')
    }
  })

  it("is generated, never captured: an empty root, no route content, and the same bytes on every build", () => {
    //a captured document is whatever the server rendered for whoever ran the
    //build; generated from config, it cannot carry anybody's page
    for (const { html } of [spa, ssr, native]) {
      expect(html).toMatch(/<div id="root"><\/div>/)
      expect(html).not.toContain("Welcome back")
    }
    //two builds of the same app from two different roots. Nothing about the
    //machine or the path leaks in, so the precache revision of the shell only
    //moves when the app does (`app-shell.ts`: a varying shell re-downloads for
    //every user on every deploy)
    expect(spaAgain.html).toBe(spa.html)
    expect(spa.html).not.toContain(path.resolve(spa.clientDir, "../.."))
  })
})

describe("adaptvShellEmitPlugin — the stylesheet href", () => {
  it(
    'finds the stylesheet on disk when the manifest links it to no chunk, instead of href="/"',
    async () => {
      //Start's SPA build can leave the CSS unassociated. The old fallback shipped
      //`href="/"`, which loads the HTML document as a stylesheet: a fully
      //unstyled app, with no error anywhere.
      const { css: _css, ...entry } = manifest["src/client-entry.tsx"]
      const { appRoot, clientDir, context } = scaffold("spa", "web", {
        ...manifest,
        "src/client-entry.tsx": entry,
      })
      await emit(context, appRoot)
      const html = readFileSync(path.join(clientDir, "index.html"), "utf8")
      expect(html).toContain(
        '<link rel="stylesheet" href="/assets/app-unlinked9.css">',
      )
      expect(html).not.toContain('href="/">')
    },
    PRERENDER_TIMEOUT,
  )
})
