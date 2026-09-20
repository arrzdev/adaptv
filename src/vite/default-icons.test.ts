// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import type { ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Connect, Plugin, ViteDevServer } from "vite"
import { afterEach, describe, expect, it } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { adaptvDefaultIconsPlugin } from "#adaptv/vite/default-icons.ts"
import { defaultIconAssets } from "#adaptv/vite/icon-set.ts"

/*
 * adaptv's own mark lives in the FRAMEWORK's package, so nothing in the app's
 * `public/` serves it. This plugin is the only thing standing between the
 * manifest/head pointing at `/adaptv-icons/*` and a set of 404s that looks
 * exactly like shipping no icons — and, the other way round, between an app
 * with its own art and a dozen files of someone else's brand in its output.
 */

const CONFIG: AdaptvAppConfig = {
  name: "Probe",
  description: "fixture",
  themeColor: { light: "#ffffff", dark: "#000000" },
  styles: "./src/styles/main.css",
  router: {},
}

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** A throwaway app root; `icons` names `public/favicons`, empty unless art is added. */
function app(icons?: string): AdaptvContext {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-default-icons-"))
  roots.push(appRoot)
  return {
    appRoot,
    target: "web",
    loaded: {
      config: icons === undefined ? CONFIG : { ...CONFIG, icons },
      watchFiles: [],
    },
  }
}

/** Drop one real PNG header into the app's icon directory — usable art of its own. */
function addArt(context: AdaptvContext) {
  const dir = path.join(context.appRoot, "public/favicons")
  mkdirSync(dir, { recursive: true })
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    buf,
    0,
  )
  buf.writeUInt32BE(13, 8)
  buf.write("IHDR", 12)
  buf.writeUInt32BE(512, 16)
  buf.writeUInt32BE(512, 20)
  buf[24] = 8
  buf[25] = 6
  writeFileSync(path.join(dir, "icon.png"), buf)
}

const asset = (name: string) =>
  readFileSync(
    path.join(import.meta.dirname, "../../assets/default-icons", name),
  )

type Served = {
  passed: boolean
  headers: Record<string, string>
  body: Buffer | undefined
}

/** The middleware the plugin registers, driven the way connect drives it. */
function devServer(plugin: Plugin) {
  let handler: Connect.NextHandleFunction | undefined
  const server = {
    middlewares: {
      use: (fn: Connect.NextHandleFunction) => {
        handler = fn
      },
    },
  } as unknown as ViteDevServer
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  ;(plugin.configureServer as any)(server)
  if (!handler) throw new Error("configureServer registered no middleware")
  const middleware = handler

  return (url: string): Served => {
    const served: Served = { passed: false, headers: {}, body: undefined }
    const res = {
      setHeader: (key: string, value: string) => {
        served.headers[key] = value
      },
      end: (body: Buffer) => {
        served.body = body
      },
    } as unknown as ServerResponse
    middleware({ url } as Connect.IncomingMessage, res, () => {
      served.passed = true
    })
    return served
  }
}

type Emitted = { type: string; fileName: string; source: Buffer }

/** Run `generateBundle` in one named environment and return what it emitted. */
function build(plugin: Plugin, environment: string): Emitted[] {
  const emitted: Emitted[] = []
  const hook = plugin.generateBundle
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  ;(hook as any).call({
    environment: { name: environment },
    emitFile: (file: Emitted) => {
      emitted.push(file)
      return file.fileName
    },
  })
  return emitted
}

describe("adaptvDefaultIconsPlugin — dev: serving the mark at the URLs the head links", () => {
  it("serves each default file with its bytes and its type", () => {
    const get = devServer(adaptvDefaultIconsPlugin(app()))

    const ico = get("/adaptv-icons/favicon.ico")
    expect(ico.passed).toBe(false)
    expect(ico.headers["Content-Type"]).toBe("image/x-icon")
    expect(ico.body?.equals(asset("favicon.ico"))).toBe(true)

    const svg = get("/adaptv-icons/icon.svg")
    expect(svg.headers["Content-Type"]).toBe("image/svg+xml")
    expect(svg.body?.equals(asset("icon.svg"))).toBe(true)

    const png = get("/adaptv-icons/apple-touch-icon-180.png")
    expect(png.headers["Content-Type"]).toBe("image/png")
    expect(png.body?.equals(asset("apple-touch-icon-180.png"))).toBe(true)
  })

  it("ignores a cache-busting query rather than 404ing the icon", () => {
    const get = devServer(adaptvDefaultIconsPlugin(app()))
    const served = get("/adaptv-icons/icon.png?v=3")
    expect(served.passed).toBe(false)
    expect(served.body?.equals(asset("icon.png"))).toBe(true)
  })

  it("leaves every other URL to the rest of the dev server", () => {
    const get = devServer(adaptvDefaultIconsPlugin(app()))
    for (const url of [
      "/favicons/icon.png",
      "/adaptv-icons",
      "/adaptv-iconsX/icon.png",
      "/manifest.json",
    ]) {
      const served = get(url)
      expect(served.passed, url).toBe(true)
      expect(served.body, url).toBeUndefined()
    }
  })

  it("never reaches the filesystem through the URL", () => {
    //`basename` plus an exact match against the asset list: a traversal resolves to a name
    //that simply is not in the set, so it falls through instead of reading `package.json`.
    const get = devServer(adaptvDefaultIconsPlugin(app()))
    for (const url of [
      "/adaptv-icons/../../package.json",
      "/adaptv-icons/%2e%2e/package.json",
      "/adaptv-icons/nope.png",
    ]) {
      const served = get(url)
      expect(served.passed, url).toBe(true)
      expect(served.body, url).toBeUndefined()
    }
  })

  it("does not serve the launcher-only variants, which no web surface links", () => {
    const served = devServer(adaptvDefaultIconsPlugin(app()))(
      "/adaptv-icons/icon-dark.png",
    )
    expect(served.passed).toBe(true)
  })

  it("serves nothing to an app that has art of its own", () => {
    const context = app("./public/favicons")
    addArt(context)
    const served = devServer(adaptvDefaultIconsPlugin(context))(
      "/adaptv-icons/favicon.ico",
    )
    expect(served.passed).toBe(true)
    expect(served.body).toBeUndefined()
  })

  it("stops serving the moment a dev adds art mid-session, with no restart", () => {
    //Resolved per request, like the manifest next door: a set captured at startup would keep
    //handing out adaptv's mark after the dev's own icon was on disk.
    const context = app("./public/favicons")
    const get = devServer(adaptvDefaultIconsPlugin(context))
    expect(get("/adaptv-icons/icon.png").passed).toBe(false)
    addArt(context)
    expect(get("/adaptv-icons/icon.png").passed).toBe(true)
  })
})

describe("adaptvDefaultIconsPlugin — build: the files an app with no art ships", () => {
  it("emits every servable default file at its exact, unhashed URL path", () => {
    //`fileName`, not `name`: the manifest and head reference `/adaptv-icons/icon.png`, so a
    //hashed `assets/icon-a1b2.png` would build green and 404 every icon.
    const emitted = build(adaptvDefaultIconsPlugin(app()), "client")
    const expected = defaultIconAssets().map(
      (file) => `adaptv-icons/${path.basename(file)}`,
    )
    expect(expected.length).toBeGreaterThan(0)
    expect(emitted.map((file) => file.fileName).sort()).toEqual(
      expected.sort(),
    )
    for (const file of emitted) {
      expect(file.type).toBe("asset")
      expect(
        file.source.equals(asset(path.basename(file.fileName))),
        file.fileName,
      ).toBe(true)
    }
    expect(emitted.map((file) => file.fileName)).toContain(
      "adaptv-icons/favicon.ico",
    )
  })

  it("emits into the client environment only", () => {
    //They are client assets, like the manifest; a copy in the server bundle is dead weight.
    expect(build(adaptvDefaultIconsPlugin(app()), "ssr")).toEqual([])
  })

  it("emits nothing for an app that has art of its own", () => {
    const context = app("./public/favicons")
    addArt(context)
    expect(build(adaptvDefaultIconsPlugin(context), "client")).toEqual([])
  })
})
