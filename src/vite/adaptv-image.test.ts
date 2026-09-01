import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
  ADAPTV_IMAGE_QUERY,
  adaptvImagePlugin,
  imageCacheKey,
  isSupportedImage,
  LQIP_MIN_SOURCE_EDGE,
  lqipSkipReason,
  orientedSize,
  parseAdaptvImageId,
  renderImageAssetModule,
  svgIntrinsicSize,
} from "#adaptv/vite/adaptv-image.ts"

/*
 * The pipeline is exercised against REAL files encoded by the real `sharp`, not
 * against a mock: the whole feature is "what sharp reports about these bytes",
 * and a mock would assert only that the plumbing calls the function it calls.
 */

let dir = ""
const files: Record<string, string> = {}

beforeAll(async () => {
  const sharp = (await import("sharp")).default
  dir = await mkdtemp(path.join(tmpdir(), "adaptv-image-"))

  const gradient = (width: number, height: number) =>
    sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 200, g: 80, b: 40 },
      },
    })

  files.photo = path.join(dir, "photo.png")
  await gradient(400, 250).png().toFile(files.photo)

  files.tiny = path.join(dir, "tiny.png")
  await gradient(24, 24).png().toFile(files.tiny)

  files.vector = path.join(dir, "logo.svg")
  await writeFile(
    files.vector,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><rect width="300" height="150"/></svg>`,
  )

  files.broken = path.join(dir, "broken.png")
  await writeFile(files.broken, "this is not a png")
})

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe("parseAdaptvImageId", () => {
  it("answers only for its own suffix", () => {
    expect(parseAdaptvImageId(`/a/hero.jpg${ADAPTV_IMAGE_QUERY}`)).toBe(
      "/a/hero.jpg",
    )
    expect(parseAdaptvImageId("/a/hero.jpg")).toBeNull()
    expect(parseAdaptvImageId("/a/hero.jpg?url")).toBeNull()
    //so a consumer running vite-imagetools alongside it cannot collide
    expect(parseAdaptvImageId("/a/hero.jpg?w=16&format=webp")).toBeNull()
  })
})

describe("isSupportedImage", () => {
  it("covers the raster set and svg, case-insensitively", () => {
    expect(isSupportedImage("/a/x.JPG")).toBe(true)
    expect(isSupportedImage("/a/x.svg")).toBe(true)
    expect(isSupportedImage("/a/x.pdf")).toBe(false)
  })
})

describe("orientedSize", () => {
  it("swaps the axes for the quarter-turn orientations only", () => {
    const landscape = { width: 400, height: 300 }
    expect(orientedSize({ ...landscape, orientation: 1 })).toEqual(
      landscape,
    )
    expect(orientedSize({ ...landscape, orientation: 4 })).toEqual(
      landscape,
    )
    //5–8 are the transposes: a portrait photo tagged sideways must not reserve a
    //landscape box
    expect(orientedSize({ ...landscape, orientation: 6 })).toEqual({
      width: 300,
      height: 400,
    })
    expect(orientedSize(landscape)).toEqual(landscape)
  })
})

describe("svgIntrinsicSize", () => {
  it("prefers explicit pixel width/height", () => {
    expect(
      svgIntrinsicSize(
        `<svg width="120" height="60" viewBox="0 0 12 6"/>`,
      ),
    ).toEqual({ width: 120, height: 60 })
  })

  it("falls back to the viewBox when the dimensions are relative", () => {
    expect(
      svgIntrinsicSize(
        `<svg width="100%" height="100%" viewBox="0 0 30 10"/>`,
      ),
    ).toEqual({ width: 30, height: 10 })
  })

  it("tolerates px units and comma-separated viewBoxes", () => {
    expect(svgIntrinsicSize(`<svg width="16px" height="9px"/>`)).toEqual({
      width: 16,
      height: 9,
    })
    expect(svgIntrinsicSize(`<svg viewBox="0,0,8,4"/>`)).toEqual({
      width: 8,
      height: 4,
    })
  })

  it("is null when there is nothing to reserve from", () => {
    expect(svgIntrinsicSize(`<svg/>`)).toBeNull()
    expect(svgIntrinsicSize(`not markup`)).toBeNull()
  })
})

describe("lqipSkipReason — cosmetic failures only", () => {
  const base = {
    enabled: true,
    isVector: false,
    pages: 1,
    width: 400,
    height: 250,
  }

  it("produces a placeholder for an ordinary raster", () => {
    expect(lqipSkipReason(base)).toBeNull()
  })

  //`animated` is asserted here rather than against a fixture because sharp cannot
  //synthesise a multi-page source, and a hand-rolled 2-frame GIF small enough to
  //inline would trip the `tiny` branch first and prove nothing.
  it("skips the cases where a placeholder is meaningless or harmful", () => {
    expect(lqipSkipReason({ ...base, enabled: false })).toBe("disabled")
    expect(lqipSkipReason({ ...base, isVector: true })).toBe("vector")
    expect(lqipSkipReason({ ...base, pages: 12 })).toBe("animated")
    expect(
      lqipSkipReason({
        ...base,
        width: LQIP_MIN_SOURCE_EDGE - 1,
        height: LQIP_MIN_SOURCE_EDGE - 1,
      }),
    ).toBe("tiny")
  })
})

describe("imageCacheKey", () => {
  const base = {
    file: "/a/hero.jpg",
    size: 1234,
    mtimeMs: 99,
    placeholder: true,
  }

  it("is stable for the same stat", () => {
    expect(imageCacheKey(base)).toBe(imageCacheKey({ ...base }))
  })

  it("changes with size, mtime and the placeholder setting", () => {
    expect(imageCacheKey({ ...base, size: 1235 })).not.toBe(
      imageCacheKey(base),
    )
    expect(imageCacheKey({ ...base, mtimeMs: 100 })).not.toBe(
      imageCacheKey(base),
    )
    expect(imageCacheKey({ ...base, placeholder: false })).not.toBe(
      imageCacheKey(base),
    )
  })
})

describe("renderImageAssetModule", () => {
  it("delegates the URL to Vite's own asset pipeline", () => {
    const code = renderImageAssetModule("/a/hero.jpg", {
      width: 4,
      height: 3,
    })
    expect(code).toContain(`import src from "/a/hero.jpg?url"`)
    expect(code).toContain("width: 4")
    expect(code).not.toContain("lqip")
  })
})

type LoadHook = (this: unknown, id: string) => Promise<string | null>

function harness(options?: { placeholder?: boolean }) {
  const warnings: string[] = []
  const watched: string[] = []
  const plugin = adaptvImagePlugin(options)
  const context = {
    warn: (message: string) => warnings.push(message),
    info: () => {},
    addWatchFile: (file: string) => watched.push(file),
    error: (message: string) => {
      throw new Error(message)
    },
  }
  const load = (
    typeof plugin.load === "function" ? plugin.load : plugin.load?.handler
  ) as LoadHook

  return {
    warnings,
    watched,
    run: async (file: string): Promise<string> => {
      const code = await load.call(context, `${file}${ADAPTV_IMAGE_QUERY}`)
      expect(code, `the load hook declined ${file}`).not.toBeNull()
      return code as string
    },
  }
}

/** The object literal the emitted module exports, without executing the import. */
function parseAsset(code: string) {
  const body = code.slice(code.indexOf("export default"))
  return {
    width: Number(body.match(/width: (\d+)/)?.[1]),
    height: Number(body.match(/height: (\d+)/)?.[1]),
    lqip: body.match(/lqip: "([^"]*)"/)?.[1],
  }
}

describe("adaptvImagePlugin — dimensions first, placeholder second", () => {
  it("ignores every id that is not its own", async () => {
    const { run } = harness()
    const plugin = adaptvImagePlugin()
    const load = (
      typeof plugin.load === "function"
        ? plugin.load
        : plugin.load?.handler
    ) as LoadHook
    expect(await load.call({}, "/a/hero.jpg")).toBeNull()
    expect(run).toBeTypeOf("function")
  })

  it("resolves intrinsic dimensions and a 16 px WebP data URL", async () => {
    const { run, watched } = harness()
    const asset = parseAsset(await run(files.photo))

    expect(asset.width).toBe(400)
    expect(asset.height).toBe(250)
    expect(asset.lqip?.startsWith("data:image/webp;base64,")).toBe(true)
    //the byte budget the format was chosen for — a JPEG has a ~330 B floor from
    //its quantization tables alone, and AVIF is ~2.6× WebP at this size
    expect(asset.lqip?.length).toBeLessThan(400)
    //an edit to the source must invalidate the module
    expect(watched).toContain(files.photo)
  })

  it("emits nothing but the reservation for a vector", async () => {
    const asset = parseAsset(await harness().run(files.vector))
    expect(asset).toMatchObject({ width: 300, height: 150 })
    expect(asset.lqip).toBeUndefined()
  })

  it("emits nothing but the reservation for a source smaller than the placeholder", async () => {
    const asset = parseAsset(await harness().run(files.tiny))
    expect(asset).toMatchObject({ width: 24, height: 24 })
    expect(asset.lqip).toBeUndefined()
  })

  it("honours `placeholder: false` without giving up the dimensions", async () => {
    const asset = parseAsset(
      await harness({ placeholder: false }).run(files.photo),
    )
    expect(asset).toMatchObject({ width: 400, height: 250 })
    expect(asset.lqip).toBeUndefined()
  })

  it("is a build ERROR when the dimensions are missing, not a warning", async () => {
    //the asymmetry the whole failure table turns on: a missing placeholder is
    //cosmetic, a missing dimension is a layout shift
    const { run, warnings } = harness()
    await expect(run(files.broken)).rejects.toThrow(/could not be decoded/)
    expect(warnings).toEqual([])
  })

  it("refuses a file type it cannot measure", async () => {
    await expect(harness().run("/a/notes.pdf")).rejects.toThrow(
      /does not handle/,
    )
  })

  it("caches on stat, so a second load never re-encodes", async () => {
    const { run } = harness()
    const first = await run(files.photo)
    const cold = performance.now()
    const second = await run(files.photo)
    const warm = performance.now() - cold
    expect(second).toBe(first)
    //the cache key is derivable from `stat()` alone; `vite-imagetools` hashes the
    //DECODED buffer before its lookup, which is why its rebuilds are barely
    //faster than its cold builds (its discussion #816)
    expect(warm).toBeLessThan(50)
  })

  it("wins the query against Vite's own asset plugin", async () => {
    //THE regression this test exists for, found by building it both ways. Vite's
    //asset plugin treats any unknown query on a known image extension as a plain
    //URL import, so without `enforce: "pre"` the import resolves to the STRING
    //"/assets/hero-D18UDLrP.jpg?adaptv-image" and every dimension is silently
    //gone — a build that succeeds and reserves nothing. Nothing short of a real
    //build catches it, because the load hook is never reached to be asserted on.
    const { build } = await import("vite")
    const app = path.join(dir, "app")
    await writeFile(
      path.join(dir, "entry.js"),
      `import hero from "./photo.png?adaptv-image"\nglobalThis.hero = hero\n`,
    )
    await build({
      root: dir,
      logLevel: "silent",
      plugins: [adaptvImagePlugin()],
      build: {
        outDir: app,
        assetsInlineLimit: 0,
        rollupOptions: { input: path.join(dir, "entry.js") },
      },
    })

    const bundleDir = path.join(app, "assets")
    const emitted = await import("node:fs").then((fs) =>
      fs.readdirSync(bundleDir),
    )
    const js = emitted.find((name) => name.endsWith(".js")) as string
    const code = await readFile(path.join(bundleDir, js), "utf8")

    expect(code).toContain("width:400")
    expect(code).toContain("height:250")
    expect(code).toContain("data:image/webp;base64,")
    //the URL is Vite's — hashed, base-prefixed, and with no query left on it
    expect(code).toMatch(/\/assets\/photo-[\w-]+\.png/)
    expect(code).not.toContain(ADAPTV_IMAGE_QUERY)
  }, 30_000)

  it("writes the cache under node_modules/.cache/adaptv/lqip", async () => {
    const plugin = adaptvImagePlugin()
    const configResolved = (
      typeof plugin.configResolved === "function"
        ? plugin.configResolved
        : plugin.configResolved?.handler
    ) as (this: unknown, config: { root: string }) => void
    configResolved.call({}, { root: dir })

    const load = (
      typeof plugin.load === "function"
        ? plugin.load
        : plugin.load?.handler
    ) as LoadHook
    await load.call(
      {
        warn: () => {},
        addWatchFile: () => {},
        error: (m: string) => {
          throw new Error(m)
        },
      },
      `${files.photo}${ADAPTV_IMAGE_QUERY}`,
    )

    const cacheDir = path.join(dir, "node_modules/.cache/adaptv/lqip")
    const entries = await readFile(
      path.join(
        cacheDir,
        `${imageCacheKey({
          file: files.photo,
          size: (await import("node:fs")).statSync(files.photo).size,
          mtimeMs: (await import("node:fs")).statSync(files.photo).mtimeMs,
          placeholder: true,
        })}.json`,
      ),
      "utf8",
    )
    expect(JSON.parse(entries)).toMatchObject({ width: 400, height: 250 })
  })
})
