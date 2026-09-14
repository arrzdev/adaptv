// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Plugin, ResolvedConfig } from "vite"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import { requireAppConfig } from "#adaptv/vite/adaptv-context.ts"
import { computeBuildTag } from "#adaptv/vite/build-tag.ts"
import {
  defaultIconAssets,
  manifestIcons,
  resolveIconSet,
} from "#adaptv/vite/icon-set.ts"
import { adaptvSwBuildPlugin } from "#adaptv/vite/sw-build.ts"

/*
 * The service-worker build, for real: esbuild bundles adaptv's worker and
 * workbox-build globs the output and injects the precache manifest. A mocked
 * workbox would assert the arguments, and the arguments are not the contract;
 * what lands in `sw.js` is. → `docs/design/rendering.md` §3.2, §3.3,
 * `docs/decisions/register.md` B2
 */

const roots: string[] = []
afterAll(() => {
  for (const dir of roots.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

//esbuild + workbox-build per build, two builds sharing the hook; generous
//because the gate runs every suite in parallel
const BUILD_TIMEOUT = 120_000

/**
 * A finished client output: hashed chunks, the unhashed files the glob covers,
 * route documents a prerender could have left behind, and one asset over the
 * 5 MB precache cap.
 */
function scaffold(render: "ssr" | "spa", target: "web" | "capacitor") {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-sw-build-"))
  roots.push(appRoot)
  const clientDir = path.join(appRoot, "dist/client")
  const files: Record<string, string | Buffer> = {
    "assets/client-abc123.js": "console.log('entry')",
    "assets/settings-0f0f0f.js": "console.log('route chunk')",
    "assets/main-def456.css": "html{color:red}",
    "manifest.json": "{}",
    "robots.txt": "",
    "favicon.ico": "ico",
    "icons/icon-192.png": "png",
    //route documents: per-request under SSR, and never precached in either mode
    "about.html": "<p>about, rendered for somebody</p>",
    "settings/index.html": "<p>settings, rendered for somebody</p>",
    //Start's own shell name; adaptv's generated shell is the only document
    "_shell.html": "<p>start shell</p>",
    "assets/huge-777777.js": Buffer.alloc(5 * 1024 * 1024 + 1, 97),
  }
  if (render === "spa") files["index.html"] = "<!DOCTYPE html><!--spa-->"
  else {
    files["adaptv-shell.html"] = "<!DOCTYPE html><!--ssr-->"
    //under SSR an `index.html` could only be a rendered `/` — a document
    files["index.html"] = "<p>home, rendered for somebody</p>"
  }
  for (const [name, contents] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(clientDir, name)), {
      recursive: true,
    })
    writeFileSync(path.join(clientDir, name), contents)
  }

  const context: AdaptvContext = {
    appRoot,
    target,
    web: { render, sw: { enabled: target === "web" } },
    loaded: {
      watchFiles: [],
      config: {
        name: "Probe App",
        description: "fixture",
        themeColor: { light: "#ffffff", dark: "#000000" },
        styles: "./src/styles/main.css",
        router: {},
      },
    },
  }
  return { appRoot, clientDir, context }
}

/** A minimal but REAL png header — signature + IHDR, which is all the icon scanner reads. */
function pngHeader(size: number): Buffer {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(
    buf,
    0,
  )
  buf.writeUInt32BE(13, 8)
  buf.write("IHDR", 12)
  buf.writeUInt32BE(size, 16)
  buf.writeUInt32BE(size, 20)
  buf[24] = 8
  buf[25] = 6
  return buf
}

/**
 * The full family spread `adaptv gen icons` plus a favicon generator leave in an
 * app's icon directory — the playground's own set, by name and measured size.
 * `favicon-512x512.png` duplicates `android-chrome-512.png`'s slot, which the
 * head and manifest tie-break to the android file.
 */
const APP_ICON_SET: Record<string, number> = {
  "icon.png": 1024,
  "icon-dark.png": 1024,
  "icon-tinted.png": 1024,
  "icon-monochrome.png": 1024,
  "icon-maskable.png": 1024,
  "favicon-16x16.png": 16,
  "favicon-32x32.png": 32,
  "favicon-96x96.png": 96,
  "favicon-512x512.png": 512,
  "android-chrome-192.png": 192,
  "android-chrome-512.png": 512,
  "android-maskable-192.png": 192,
  "android-maskable-512.png": 512,
  "apple-touch-icon-180.png": 180,
}

/**
 * Put the icon art where a real build has it: the SOURCE directory under
 * `public/` (what `resolveIconSet` scans) and its copy in the client output
 * (what the precache globs).
 */
function withAppIcons(built: ReturnType<typeof scaffold>) {
  const files: Record<string, Buffer> = {
    ...Object.fromEntries(
      Object.entries(APP_ICON_SET).map(([name, px]) => [
        name,
        pngHeader(px),
      ]),
    ),
    "favicon.ico": Buffer.from("ico"),
    //not art the scanner measures, so not adaptv's to judge
    "safari-pinned-tab.svg": Buffer.from("<svg/>"),
  }
  for (const dir of [
    path.join(built.appRoot, "public/favicons"),
    path.join(built.clientDir, "favicons"),
  ]) {
    mkdirSync(dir, { recursive: true })
    for (const [name, contents] of Object.entries(files))
      writeFileSync(path.join(dir, name), contents)
  }
  requireAppConfig(built.context).icons = "./public/favicons"
  return built
}

/** adaptv's own set, emitted the way `default-icons.ts` emits it. */
function withDefaultIcons(built: ReturnType<typeof scaffold>) {
  const dir = path.join(built.clientDir, "adaptv-icons")
  mkdirSync(dir, { recursive: true })
  for (const file of defaultIconAssets())
    writeFileSync(path.join(dir, path.basename(file)), readFileSync(file))
  return built
}

/**
 * The app's set under a deploy base, with the manifest a base-aware build writes:
 * every generated `src` under the base, `/app/favicons/…`. `headIconLinks` still
 * writes paths under the public root, which never carry the base.
 */
function withAppIconsUnderBase(built: ReturnType<typeof scaffold>) {
  withAppIcons(built)
  const config = requireAppConfig(built.context)
  config.manifestExtra = {
    icons: manifestIcons(resolveIconSet(built.appRoot, config)).map(
      (icon) => ({ ...icon, src: `/app${icon.src}` }),
    ),
  }
  return built
}

/**
 * The app's set with an `icons` array of its own, written every way a manifest
 * URL can name the same file: `./`-relative, bare relative, absolute on the
 * app's origin — and one on a CDN, which is no file of this output.
 */
function withManifestUrlForms(built: ReturnType<typeof scaffold>) {
  withAppIcons(built)
  const config = requireAppConfig(built.context)
  config.origin = "https://app.example.com"
  config.manifestExtra = {
    icons: [
      { src: "./favicons/icon.png", sizes: "1024x1024" },
      { src: "favicons/icon-dark.png", sizes: "1024x1024" },
      {
        src: "https://app.example.com/favicons/icon-tinted.png",
        sizes: "1024x1024",
      },
      {
        src: "https://cdn.example.net/favicons/icon-monochrome.png",
        sizes: "1024x1024",
      },
    ],
  }
  return built
}

async function buildWorker(
  context: AdaptvContext,
  base = "/",
): Promise<void> {
  const plugin = adaptvSwBuildPlugin(context)
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  ;(plugin.configResolved as any).call({}, {
    root: context.appRoot,
    base,
    environments: { client: { build: { outDir: "dist/client" } } },
  } as unknown as ResolvedConfig)
  const hook = (plugin as Plugin).buildApp
  if (typeof hook !== "object" || !hook.handler)
    throw new Error(
      "buildApp must be an object hook so `order` can be set",
    )
  // biome-ignore lint/suspicious/noExplicitAny: calling a Vite hook outside Vite
  await (hook.handler as any).call({}, {})
}

/** The URLs workbox injected in place of `self.__WB_MANIFEST`. */
function precachedUrls(worker: string): string[] {
  return [...worker.matchAll(/"url":"([^"]+)"/g)]
    .map((match) => match[1] as string)
    .sort()
}

/**
 * The string values passed under `key` in the bundled worker. Property names
 * survive minification, so this reads what `default-worker.ts` passes on
 * without matching a whole minified bundle (a failure would print all of it).
 */
function stampedValues(worker: string, key: string): string[] {
  return [...worker.matchAll(new RegExp(`\\b${key}:"([^"]+)"`, "g"))].map(
    (match) => match[1] as string,
  )
}

type Built = { clientDir: string; worker: string; urls: string[] }
let spa: Built
let ssr: Built
let appIcons: Built
let defaultIcons: Built
let subpathIcons: Built
let manifestUrlIcons: Built
let savedOverride: string | undefined

beforeAll(async () => {
  savedOverride = process.env.ADAPTV_BUILD_TAG
  delete process.env.ADAPTV_BUILD_TAG
  const build = async (
    render: "ssr" | "spa",
    icons: (built: ReturnType<typeof scaffold>) => unknown = () => {},
    base = "/",
  ) => {
    const built = scaffold(render, "web")
    icons(built)
    const { clientDir, context } = built
    await buildWorker(context, base)
    const worker = readFileSync(path.join(clientDir, "sw.js"), "utf8")
    return { clientDir, worker, urls: precachedUrls(worker) }
  }
  //sequential: both builds share workbox and esbuild, and the gate is busy
  spa = await build("spa")
  ssr = await build("ssr")
  appIcons = await build("ssr", withAppIcons)
  defaultIcons = await build("spa", withDefaultIcons)
  subpathIcons = await build("ssr", withAppIconsUnderBase, "/app/")
  manifestUrlIcons = await build("ssr", withManifestUrlForms)
}, BUILD_TIMEOUT)

//restored only after the tests, which recompute the tag and must see the
//same (unset) override the builds saw
afterAll(() => {
  if (savedOverride !== undefined)
    process.env.ADAPTV_BUILD_TAG = savedOverride
})

describe("adaptvSwBuildPlugin — what the worker is stamped with", () => {
  it("bakes in the build tag of the output it ships with, so the cache names rotate with the deploy", async () => {
    //the runtime buckets are `static-<tag>` and the activate sweep deletes every
    //other tag (register B2). The tag in the worker has to be the one computed
    //over this exact output, and recomputing it AFTER sw.js exists proves the
    //worker did not feed back into its own tag.
    const tags: string[] = []
    for (const { clientDir, worker } of [spa, ssr]) {
      const tag = await computeBuildTag(clientDir, "probe-app")
      expect(tag).toMatch(/^probe-app-[0-9a-f]{12}$/)
      //every `buildTag` the worker hands on — the static-assets route that names
      //`static-<tag>`, and the lifecycle sweep that deletes the other tags
      expect(stampedValues(worker, "buildTag")).toEqual([tag, tag])
      tags.push(tag)
    }
    //different outputs, different tags
    expect(tags[0]).not.toBe(tags[1])
    //the esbuild intermediate is removed, so it cannot ship or be precached
    expect(existsSync(path.join(spa.clientDir, "sw-src.js"))).toBe(false)
  })

  it("binds the navigation route to the shell the render mode emitted", () => {
    //the worker binding one name while the build emitted another fails only at
    //runtime, offline (`sw-helpers.ts`)
    expect(stampedValues(spa.worker, "appShellUrl")).toEqual([
      "/index.html",
    ])
    expect(stampedValues(ssr.worker, "appShellUrl")).toEqual([
      "/adaptv-shell.html",
    ])
  })
})

describe("adaptvSwBuildPlugin — the precache manifest", () => {
  it("precaches every chunk, the stylesheet, the unhashed assets and the shell", () => {
    for (const { urls } of [spa, ssr]) {
      expect(urls).toEqual(
        expect.arrayContaining([
          "assets/client-abc123.js",
          "assets/settings-0f0f0f.js",
          "assets/main-def456.css",
          "manifest.json",
          "robots.txt",
          "favicon.ico",
          "icons/icon-192.png",
        ]),
      )
    }
    expect(spa.urls).toContain("index.html")
    expect(ssr.urls).toContain("adaptv-shell.html")
  })

  it("precaches no route document, not the worker itself, and nothing over the 5 MB cap", () => {
    //§3.2: Cache Storage is keyed by URL and scoped per origin, not per user, so
    //a precached route document is a cross-user leak. The shell is the single
    //document, added by name.
    const htmlIn = (urls: string[]) =>
      urls.filter((url) => url.endsWith(".html"))
    expect(htmlIn(spa.urls)).toEqual(["index.html"])
    //under SSR `index.html` is a rendered `/`, and has to stay out
    expect(htmlIn(ssr.urls)).toEqual(["adaptv-shell.html"])
    for (const { urls } of [spa, ssr]) {
      expect(urls).not.toContain("sw.js")
      expect(urls).not.toContain("sw-src.js")
      //one oversized entry must not fail the whole install; it falls to the
      //runtime static route instead (§3.3)
      expect(urls).not.toContain("assets/huge-777777.js")
    }
  })
})

describe("adaptvSwBuildPlugin — the icon art in the precache", () => {
  const iconUrls = (urls: string[], dir: string) =>
    urls.filter((url) => url.startsWith(`${dir}/`))

  it("precaches exactly the icons the head and the manifest link, and none of the native source art", () => {
    //The directory has to be inside `public/`, so all of it is in the glob — and
    //the 1024px master, the iOS 18 appearances, Android's monochrome layer, the
    //maskable master and a duplicate 512 are nothing a browser asks for. On the
    //playground that was 24% of the install download.
    expect(iconUrls(appIcons.urls, "favicons")).toEqual([
      "favicons/android-chrome-192.png",
      "favicons/android-chrome-512.png",
      "favicons/android-maskable-192.png",
      "favicons/android-maskable-512.png",
      "favicons/apple-touch-icon-180.png",
      "favicons/favicon-16x16.png",
      "favicons/favicon-32x32.png",
      "favicons/favicon-96x96.png",
      "favicons/favicon.ico",
      //left to the glob: not a member the icon set measured, so possibly the
      //app's own `<link rel="mask-icon">`
      "favicons/safari-pinned-tab.svg",
    ])
    //taken out of the install, not out of the deploy: still served, and cached
    //by the runtime static route only if a page requests it as an image online
    for (const name of [
      "icon.png",
      "icon-dark.png",
      "favicon-512x512.png",
    ])
      expect(
        existsSync(path.join(appIcons.clientDir, "favicons", name)),
      ).toBe(true)
    //and the rest of the app is untouched by it
    expect(appIcons.urls).toEqual(
      expect.arrayContaining([
        "assets/client-abc123.js",
        "manifest.json",
        "adaptv-shell.html",
      ]),
    )
  })

  it("keeps exactly the linked icons for an app deployed under a subpath base", () => {
    //Under `base: "/app/"` the manifest writes `/app/favicons/…`, and Workbox
    //writes the same file as `favicons/…`. Compared raw, the manifest-only icons
    //(Android's maskable pair) fell out of the install, silently. The same set
    //as at `/`, and still none of the native source art.
    expect(iconUrls(subpathIcons.urls, "favicons")).toEqual([
      "favicons/android-chrome-192.png",
      "favicons/android-chrome-512.png",
      "favicons/android-maskable-192.png",
      "favicons/android-maskable-512.png",
      "favicons/apple-touch-icon-180.png",
      "favicons/favicon-16x16.png",
      "favicons/favicon-32x32.png",
      "favicons/favicon-96x96.png",
      "favicons/favicon.ico",
      "favicons/safari-pinned-tab.svg",
    ])
  })

  it("reads a manifest icon URL the way the browser resolves it", () => {
    //`manifestExtra.icons` replaces the generated array, so the maskable pair
    //is linked by nothing now; the head's links are unchanged.
    expect(iconUrls(manifestUrlIcons.urls, "favicons")).toEqual([
      "favicons/android-chrome-192.png",
      "favicons/android-chrome-512.png",
      "favicons/apple-touch-icon-180.png",
      "favicons/favicon-16x16.png",
      "favicons/favicon-32x32.png",
      "favicons/favicon-96x96.png",
      "favicons/favicon.ico",
      //`favicons/icon-dark.png`
      "favicons/icon-dark.png",
      //`https://app.example.com/favicons/icon-tinted.png`, on the app's origin
      "favicons/icon-tinted.png",
      //`./favicons/icon.png`
      "favicons/icon.png",
      "favicons/safari-pinned-tab.svg",
    ])
    //the CDN copy is not this file, so the local one links to nothing
    expect(manifestUrlIcons.urls).not.toContain(
      "favicons/icon-monochrome.png",
    )
  })

  it("applies the same rule to adaptv's own set, for an app with no icons", () => {
    expect(iconUrls(defaultIcons.urls, "adaptv-icons")).toEqual([
      "adaptv-icons/android-chrome-192.png",
      "adaptv-icons/android-chrome-512.png",
      "adaptv-icons/android-maskable-192.png",
      "adaptv-icons/android-maskable-512.png",
      "adaptv-icons/apple-touch-icon-180.png",
      "adaptv-icons/favicon-16x16.png",
      "adaptv-icons/favicon-32x32.png",
      "adaptv-icons/favicon-96x96.png",
      "adaptv-icons/favicon.ico",
      "adaptv-icons/icon.svg",
    ])
    //emitted into the output for the head's sake, never linked
    for (const name of [
      "icon.png",
      "icon-maskable.png",
      "favicon-512x512.png",
    ])
      expect(
        existsSync(
          path.join(defaultIcons.clientDir, "adaptv-icons", name),
        ),
      ).toBe(true)
  })
})

describe("adaptvSwBuildPlugin — when there is no worker to build", () => {
  it("builds nothing for the capacitor target", async () => {
    //§3.5: impossible on iOS, inconsistent on Android, hostile to OTA
    const { clientDir, context } = scaffold("spa", "capacitor")
    await buildWorker(context)
    expect(existsSync(path.join(clientDir, "sw.js"))).toBe(false)
    expect(existsSync(path.join(clientDir, "sw-src.js"))).toBe(false)
  })

  it("refuses to build before the shell exists, rather than ship a worker bound to nothing", async () => {
    //vite-plugin-map §2.3: reversed, SPA throws `non-precached-url` at worker
    //evaluation and no worker ever installs
    const { clientDir, context } = scaffold("spa", "web")
    rmSync(path.join(clientDir, "index.html"))
    await expect(buildWorker(context)).rejects.toThrow(
      /app shell \(index\.html\) is missing/,
    )
    expect(existsSync(path.join(clientDir, "sw.js"))).toBe(false)
  })
})
