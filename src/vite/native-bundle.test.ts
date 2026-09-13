import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { adaptvNativeBundlePlugin } from "#adaptv/vite/native-bundle.ts"

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/**
 * An app root with icon art under `public/`, plus a client output holding
 * everything a real build puts there. Returns both paths so a test can assert on
 * what survived rather than on what the plugin claims it did.
 */
function scaffold(iconsKey: string | undefined = "./public/favicons") {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-native-"))
  roots.push(appRoot)
  const clientDir = path.join(appRoot, ".adaptv/web")

  const icons = path.join(appRoot, "public/favicons")
  mkdirSync(icons, { recursive: true })
  //A REAL png, because `resolveIconSet` reads the IHDR to rank the set — a
  //placeholder string scans as no icons at all, the set falls back to adaptv's
  //default, and the test would pass against the wrong `urlBase`.
  writeFileSync(path.join(icons, "favicon-192.png"), PNG_1X1)

  for (const dir of ["assets", "favicons"])
    mkdirSync(path.join(clientDir, dir), { recursive: true })
  writeFileSync(path.join(clientDir, "index.html"), "<!doctype html>")
  writeFileSync(path.join(clientDir, "manifest.json"), "{}")
  writeFileSync(path.join(clientDir, "robots.txt"), "")
  writeFileSync(path.join(clientDir, "assets/app.js"), "")
  writeFileSync(path.join(clientDir, "favicons/favicon-192.png"), "png")

  const context: AdaptvContext = {
    appRoot,
    target: "capacitor",
    clientOutDir: clientDir,
    loaded: {
      watchFiles: [],
      config: {
        appId: "dev.arrz.test",
        name: "Test",
        description: "fixture",
        themeColor: { light: "#ffffff", dark: "#000000" },
        styles: "./src/styles/main.css",
        router: {},
        ...(iconsKey ? { icons: iconsKey } : {}),
      },
    },
  }
  return { appRoot, clientDir, context }
}

async function prune(context: AdaptvContext) {
  const plugin = adaptvNativeBundlePlugin(context)
  const hook = plugin.buildApp
  if (typeof hook !== "object" || !hook.handler)
    throw new Error(
      "buildApp must be an object hook so `order` can be set",
    )
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  await (hook.handler as any).call({})
}

describe("adaptvNativeBundlePlugin", () => {
  it("sends the native lineage to its own output directory", () => {
    //The whole point. Both lineages used to write `dist/client`, kept apart in
    //time only — and under `render: "spa"` the native build emptied the web
    //build's directory mid-`preview all`. → `docs/decisions/rendering-and-delivery.md §2`
    const { context } = scaffold()
    const plugin = adaptvNativeBundlePlugin(context)
    const hook = plugin.config
    if (typeof hook !== "function")
      throw new Error("config must be a function")
    // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
    const config = (hook as any).call({}, {}, {})
    expect(config.environments.client.build.outDir).toBe(".adaptv/web")
    //NOT the ssr environment: relocating it breaks the prerender, which boots the
    //built server to crawl the routes. Tried, reverted, recorded.
    expect(config.environments.ssr).toBeUndefined()
  })

  it("drops the icon art, and nothing else", async () => {
    const { clientDir, context } = scaffold()
    await prune(context)

    expect(existsSync(path.join(clientDir, "favicons"))).toBe(false)

    //Everything the WebView actually loads. `manifest.json` in particular STAYS —
    //`useManifestOrientation` fetches it on device so the iOS guard mirrors the
    //orientation Android enforces natively.
    for (const kept of [
      "index.html",
      "manifest.json",
      "robots.txt",
      "assets/app.js",
    ])
      expect(existsSync(path.join(clientDir, kept))).toBe(true)
  })

  it("leaves the SOURCE icons alone — launcher icons are generated from them", async () => {
    //The prune targets the client OUTPUT copy. The CLI brands the native launcher
    //icons from the app's own directory, so deleting that would replace every
    //app's icon with the stock one.
    const { appRoot, context } = scaffold()
    await prune(context)
    expect(
      existsSync(path.join(appRoot, "public/favicons/favicon-192.png")),
    ).toBe(true)
  })

  it("refuses to delete outside the client output", async () => {
    //`icons` is consumer input, so the path being deleted is not a literal. An
    //app naming `../../..` must lose nothing — the difference between a prune and
    //an `rm -rf` at whatever that key happens to point at.
    const { appRoot, clientDir, context } = scaffold("./public/../..")
    const sibling = path.join(appRoot, "public/favicons/favicon-192.png")
    await prune(context)
    expect(existsSync(sibling)).toBe(true)
    expect(existsSync(appRoot)).toBe(true)
    expect(existsSync(path.join(clientDir, "index.html"))).toBe(true)
  })

  it("is a no-op when the output directory was never written", async () => {
    const { clientDir, context } = scaffold()
    rmSync(clientDir, { recursive: true, force: true })
    await expect(prune(context)).resolves.toBeUndefined()
  })
})
