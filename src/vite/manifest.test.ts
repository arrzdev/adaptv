// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import type { ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Connect, Plugin, ViteDevServer } from "vite"
import { afterEach, describe, expect, it } from "vitest"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import { resolveThemeColors } from "#adaptv/config/app-config"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context"
import { adaptvManifestPlugin, buildManifest } from "#adaptv/vite/manifest"

const BASE: AdaptvAppConfig = {
  name: "ChopChop",
  description: "A focused task list.",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
  backgroundColor: "#f7f7f5",
  orientation: "portrait",
  styles: "./src/styles/main.css",
  //point at a dir with no icons so the field maps deterministically without disk fixtures
  icons: "./__no_icons__",
  router: {
    clientEntry: "../entrypoint/client",
    routesDirectory: "./routing",
    routerConfig: "./src/routing/config.ts",
  },
}

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** An app root with `public/favicons/<name>` written as real PNG headers. */
function appWithIcons(files: Record<string, number>) {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-manifest-"))
  roots.push(root)
  const dir = path.join(root, "public/favicons")
  mkdirSync(dir, { recursive: true })
  for (const [name, px] of Object.entries(files)) {
    const buf = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
      buf,
      0,
    )
    buf.writeUInt32BE(13, 8)
    buf.write("IHDR", 12)
    buf.writeUInt32BE(px, 16)
    buf.writeUInt32BE(px, 20)
    buf[24] = 8
    buf[25] = 6
    writeFileSync(path.join(dir, name), buf)
  }
  return root
}

describe("buildManifest — icons come from the files, not the filenames", () => {
  it("reads the app's real icon directory rather than an `android-` prefix", () => {
    //The old `collectIcons` accepted only names starting `android-` and took the size out of
    //the name. A `logo-512.png` contributed nothing, and a hand-resized file lied about itself.
    const root = appWithIcons({
      "logo-512.png": 512,
      "android-chrome-192.png": 180,
    })
    const manifest = buildManifest(
      { ...BASE, icons: "./public/favicons" },
      root,
      "/",
    )
    expect(manifest.icons).toEqual([
      {
        src: "/favicons/android-chrome-192.png",
        sizes: "180x180",
        type: "image/png",
      },
      {
        src: "/favicons/logo-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ])
  })

  it("re-reads on every call, so a dev adding art doesn't have to restart", () => {
    const root = appWithIcons({ "icon-192.png": 192 })
    const config = { ...BASE, icons: "./public/favicons" }
    expect(buildManifest(config, root, "/").icons).toHaveLength(1)

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
    writeFileSync(path.join(root, "public/favicons/icon-512.png"), buf)
    expect(buildManifest(config, root, "/").icons).toHaveLength(2)
  })

  it("falls back to adaptv's own set when the app has no art at all", () => {
    const root = appWithIcons({})
    const manifest = buildManifest(
      { ...BASE, icons: "./public/favicons" },
      root,
      "/",
      [
        {
          file: "/adaptv/assets/default-icons/android-chrome-512.png",
          name: "android-chrome-512.png",
          family: "android",
          width: 512,
          height: 512,
          alpha: true,
        },
      ],
    )
    expect(manifest.icons).toEqual([
      {
        src: "/adaptv-icons/android-chrome-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ])
  })
})

describe("buildManifest — under a subpath base", () => {
  it("launches and draws its icons from inside the base", () => {
    //a GitHub Pages project site: `/` is somebody else's page, and so is
    //`/favicons/`. The slashless base is how Vite hands over `base: "/app"`.
    const root = appWithIcons({ "icon-512.png": 512 })
    for (const base of ["/app/", "/app"]) {
      const manifest = buildManifest(
        { ...BASE, icons: "./public/favicons" },
        root,
        base,
      )
      expect(manifest.start_url).toBe("/app/")
      expect(manifest.icons.map((icon) => icon.src)).toEqual([
        "/app/favicons/icon-512.png",
      ])
    }
  })
})

describe("buildManifest", () => {
  it("maps config fields to manifest fields", () => {
    const manifest = buildManifest(BASE, "/tmp", "/")
    expect(manifest.name).toBe("ChopChop")
    expect(manifest.short_name).toBe("ChopChop")
    expect(manifest.start_url).toBe("/")
    //the install's identity is stated rather than inferred: a browser that
    //falls back to start_url turns a changed landing route into a second
    //installed app
    expect(manifest.id).toBe("/")
    expect(manifest.display).toBe("standalone")
    //theme_color defaults to the LIGHT theme (seeds launch chrome; useSyncTheme
    //takes over the live theme-color meta once mounted)
    expect(manifest.theme_color).toBe("#eeeeec")
    expect(manifest.background_color).toBe("#f7f7f5")
    expect(manifest.orientation).toBe("portrait")
  })

  it("defaults short_name to name and background to light theme", () => {
    const { backgroundColor: _drop, shortName: _drop2, ...rest } = BASE
    const manifest = buildManifest(rest, "/tmp", "/")
    expect(manifest.short_name).toBe("ChopChop")
    expect(manifest.background_color).toBe("#eeeeec")
  })

  it("omits orientation when 'any'", () => {
    const manifest = buildManifest(
      { ...BASE, orientation: "any" },
      "/tmp",
      "/",
    )
    expect(manifest.orientation).toBeUndefined()
  })

  it("merges manifestExtra verbatim", () => {
    const manifest = buildManifest(
      { ...BASE, manifestExtra: { categories: ["productivity"] } },
      "/tmp",
      "/",
    )
    expect(manifest.categories).toEqual(["productivity"])
  })

  it("uses the single color for both when themeColor is light-only", () => {
    const { backgroundColor: _drop, ...rest } = BASE
    const manifest = buildManifest(
      { ...rest, themeColor: { light: "#eeeeec" } },
      "/tmp",
      "/",
    )
    expect(manifest.theme_color).toBe("#eeeeec")
    expect(manifest.background_color).toBe("#eeeeec")
  })

  it("uses the single color for both when themeColor is dark-only", () => {
    const { backgroundColor: _drop, ...rest } = BASE
    const manifest = buildManifest(
      { ...rest, themeColor: { dark: "#0a0a0c" } },
      "/tmp",
      "/",
    )
    expect(manifest.theme_color).toBe("#0a0a0c")
    expect(manifest.background_color).toBe("#0a0a0c")
  })
})

describe("resolveThemeColors", () => {
  it("keeps both when both are provided", () => {
    expect(
      resolveThemeColors({ light: "#eeeeec", dark: "#0a0a0c" }),
    ).toEqual({
      light: "#eeeeec",
      dark: "#0a0a0c",
    })
  })

  it("falls back dark → light when only light is given", () => {
    expect(resolveThemeColors({ light: "#eeeeec" })).toEqual({
      light: "#eeeeec",
      dark: "#eeeeec",
    })
  })

  it("falls back light → dark when only dark is given", () => {
    expect(resolveThemeColors({ dark: "#0a0a0c" })).toEqual({
      light: "#0a0a0c",
      dark: "#0a0a0c",
    })
  })
})

describe("adaptvManifestPlugin — the manifest a browser actually fetches", () => {
  /** A context the way `adaptv()` hands it over, around an app with one 512px icon. */
  function context(target: "web" | "capacitor" = "web"): AdaptvContext {
    return {
      appRoot: appWithIcons({ "icon-512.png": 512 }),
      target,
      loaded: {
        config: { ...BASE, icons: "./public/favicons" },
        watchFiles: [],
      },
    }
  }

  /** The middleware the plugin registers ONCE, driven per request the way connect drives it. */
  function devServer(plugin: Plugin) {
    let middleware: Connect.NextHandleFunction | undefined
    // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
    ;(plugin.configureServer as any)({
      middlewares: {
        use: (fn: Connect.NextHandleFunction) => {
          middleware = fn
        },
      },
    } as unknown as ViteDevServer)
    return (url: string) => {
      const served = {
        passed: false,
        headers: {} as Record<string, string>,
        body: undefined as string | undefined,
      }
      middleware?.(
        { url } as Connect.IncomingMessage,
        {
          setHeader: (key: string, value: string) => {
            served.headers[key] = value
          },
          end: (body: string) => {
            served.body = body
          },
        } as unknown as ServerResponse,
        () => {
          served.passed = true
        },
      )
      return served
    }
  }

  /** Run `generateBundle` in one named environment and return what it emitted. */
  function emit(plugin: Plugin, environment: string) {
    const emitted: Array<{
      type: string
      fileName: string
      source: string
    }> = []
    // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
    ;(plugin.generateBundle as any).call({
      environment: { name: environment },
      emitFile: (file: (typeof emitted)[number]) => {
        emitted.push(file)
        return file.fileName
      },
    })
    return emitted
  }

  it("serves /manifest.json in dev, typed as a manifest, with the app's icons in it", () => {
    const ctx = context()
    const served = devServer(adaptvManifestPlugin(ctx))("/manifest.json")
    expect(served.passed).toBe(false)
    expect(served.headers["Content-Type"]).toBe(
      "application/manifest+json",
    )
    const manifest = JSON.parse(served.body ?? "")
    expect(manifest.name).toBe("ChopChop")
    expect(manifest.icons).toEqual([
      {
        src: "/favicons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ])
  })

  it("leaves every other URL to the rest of the dev server", () => {
    const served = devServer(adaptvManifestPlugin(context()))(
      "/manifest.webmanifest",
    )
    expect(served.passed).toBe(true)
    expect(served.body).toBeUndefined()
  })

  it("reads the config per request, so an edited adaptv.config.ts is what gets served", () => {
    //The config watcher swaps `context.loaded` on a change; a manifest built once at startup
    //would keep serving the old name until the dev restarted.
    const ctx = context()
    const get = devServer(adaptvManifestPlugin(ctx))
    expect(JSON.parse(get("/manifest.json").body ?? "").name).toBe(
      "ChopChop",
    )
    ctx.loaded = {
      config: { ...BASE, name: "Renamed", icons: "./public/favicons" },
      watchFiles: [],
    }
    expect(JSON.parse(get("/manifest.json").body ?? "").name).toBe(
      "Renamed",
    )
  })

  it("emits manifest.json into the client build, identical to the one dev serves", () => {
    const ctx = context()
    const emitted = emit(adaptvManifestPlugin(ctx), "client")
    expect(emitted.map((file) => [file.type, file.fileName])).toEqual([
      ["asset", "manifest.json"],
    ])
    expect(JSON.parse(emitted[0].source)).toEqual(
      JSON.parse(
        devServer(adaptvManifestPlugin(ctx))("/manifest.json").body ?? "",
      ),
    )
  })

  /** An app with no art of its own: no `icons` key, or a configured directory left empty. */
  function noArt(): AdaptvContext[] {
    const { icons: _, ...unconfigured } = BASE
    return [
      {
        appRoot: appWithIcons({}),
        target: "web",
        loaded: { config: unconfigured, watchFiles: [] },
      },
      {
        appRoot: appWithIcons({}),
        target: "web",
        loaded: {
          config: { ...BASE, icons: "./public/favicons" },
          watchFiles: [],
        },
      },
    ]
  }

  it("lists adaptv's own icons in dev for an app with no art of its own", () => {
    //An empty `icons` array is an app no browser will offer to install, so an app that has not
    //drawn its icon yet ships adaptv's mark until it does.
    for (const ctx of noArt()) {
      const icons = JSON.parse(
        devServer(adaptvManifestPlugin(ctx))("/manifest.json").body ?? "",
      ).icons as Array<{ src: string }>
      const label = ctx.loaded?.config.icons ?? "no icons key"
      expect(icons.length, label).toBeGreaterThan(0)
      for (const icon of icons)
        expect(icon.src, label).toMatch(/^\/adaptv-icons\//)
    }
  })

  it("ships the same fallback icons in the built manifest, not an empty list", () => {
    //manifest.ts records this exact bug: the build hook was written without the default set and
    //every production manifest said `"icons": []` while dev looked right.
    for (const ctx of noArt()) {
      const [file] = emit(adaptvManifestPlugin(ctx), "client")
      const built = JSON.parse(file.source).icons as Array<{ src: string }>
      const served = JSON.parse(
        devServer(adaptvManifestPlugin(ctx))("/manifest.json").body ?? "",
      ).icons
      const label = ctx.loaded?.config.icons ?? "no icons key"
      expect(built.length, label).toBeGreaterThan(0)
      for (const icon of built)
        expect(icon.src, label).toMatch(/^\/adaptv-icons\//)
      expect(built, label).toEqual(served)
    }
  })

  it("emits nothing from the server environment", () => {
    expect(emit(adaptvManifestPlugin(context()), "ssr")).toEqual([])
  })

  it("ships a native bundle's manifest with no icons, but keeps its orientation", () => {
    //The WebView fetches it for `orientation`; its icon art is deleted from the native bundle,
    //so listing it would be nothing but dangling hrefs inside the app.
    const [file] = emit(
      adaptvManifestPlugin(context("capacitor")),
      "client",
    )
    const manifest = JSON.parse(file.source)
    expect(manifest.icons).toEqual([])
    expect(manifest.orientation).toBe("portrait")
  })
})
