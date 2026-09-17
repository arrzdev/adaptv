import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
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
/** A real PNG of the given size, written by the real `sharp`. */
let writePng: (
  file: string,
  width: number,
  height: number,
) => Promise<void>

beforeAll(async () => {
  const sharp = (await import("sharp")).default
  dir = await mkdtemp(path.join(tmpdir(), "adaptv-image-"))

  writePng = async (file, width, height) => {
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 200, g: 80, b: 40 },
      },
    })
      .png()
      .toFile(file)
  }

  files.photo = path.join(dir, "photo.png")
  await writePng(files.photo, 400, 250)

  files.tiny = path.join(dir, "tiny.png")
  await writePng(files.tiny, 24, 24)

  files.vector = path.join(dir, "logo.svg")
  await writeFile(
    files.vector,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><rect width="300" height="150"/></svg>`,
  )

  files.sizeless = path.join(dir, "sizeless.svg")
  await writeFile(
    files.sizeless,
    `<svg xmlns="http://www.w3.org/2000/svg"><rect width="300" height="150"/></svg>`,
  )

  files.broken = path.join(dir, "broken.png")
  await writeFile(files.broken, "this is not a png")
})

afterEach(() => {
  vi.unstubAllEnvs()
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

/** The plugin's own hook, whether Vite's object or function form was used. */
function hook<T>(value: unknown): T {
  const handler =
    typeof value === "function"
      ? value
      : (value as { handler?: unknown } | undefined)?.handler
  return handler as T
}

let roots = 0

function harness(options?: {
  placeholder?: boolean
  root?: string
  /** A plugin factory from a module imported under a mocked `sharp`. */
  createPlugin?: typeof adaptvImagePlugin
}) {
  const warnings: string[] = []
  const infos: string[] = []
  const watched: string[] = []
  const plugin = (options?.createPlugin ?? adaptvImagePlugin)({
    placeholder: options?.placeholder,
  })
  //Every harness gets its own project root, so its on-disk cache starts cold and
  //no test writes into the repository's own node_modules/.cache.
  const root = options?.root ?? path.join(dir, "roots", String(++roots))
  hook<(this: unknown, config: { root: string }) => void>(
    plugin.configResolved,
  ).call({}, { root })
  const context = {
    warn: (message: string) => warnings.push(message),
    info: (message: string) => infos.push(message),
    addWatchFile: (file: string) => watched.push(file),
    error: (message: string) => {
      throw new Error(message)
    },
  }
  const load = hook<LoadHook>(plugin.load)

  return {
    root,
    warnings,
    infos,
    watched,
    run: async (file: string): Promise<string> => {
      const code = await load.call(context, `${file}${ADAPTV_IMAGE_QUERY}`)
      expect(code, `the load hook declined ${file}`).not.toBeNull()
      return code as string
    },
    buildEnd: () =>
      hook<(this: unknown) => void>(plugin.buildEnd).call(context),
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
    const load = hook<LoadHook>(adaptvImagePlugin().load)
    expect(await load.call({}, "/a/hero.jpg")).toBeNull()
  })

  it("resolves intrinsic dimensions and a 16 px WebP data URL", async () => {
    const { run, watched, warnings } = harness()
    const asset = parseAsset(await run(files.photo))

    expect(asset.width).toBe(400)
    expect(asset.height).toBe(250)
    expect(asset.lqip?.startsWith("data:image/webp;base64,")).toBe(true)
    //the byte budget the format was chosen for — a JPEG has a ~330 B floor from
    //its quantization tables alone, and AVIF is ~2.6× WebP at this size
    expect(asset.lqip?.length).toBeLessThan(400)
    //an ordinary placeholder is far under the size warning's threshold
    expect(warnings).toEqual([])
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

  it("never serves one placeholder setting the other's cache entry", async () => {
    //one project root, so the second plugin reads the cache the first wrote
    const withBlur = harness()
    const withoutBlur = harness({
      root: withBlur.root,
      placeholder: false,
    })
    expect(parseAsset(await withBlur.run(files.photo)).lqip).toBeDefined()
    expect(
      parseAsset(await withoutBlur.run(files.photo)).lqip,
    ).toBeUndefined()
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
      /does not handle \.pdf/,
    )
    await expect(harness().run("/a/LICENSE")).rejects.toThrow(
      /does not handle this file/,
    )
  })

  it("is a build ERROR when the file cannot be read", async () => {
    const { run, warnings } = harness()
    await expect(run(path.join(dir, "gone.png"))).rejects.toThrow(
      /cannot read .*gone\.png.*reserve nothing/,
    )
    expect(warnings).toEqual([])
  })

  it("is a build ERROR for a vector with neither a size nor a viewBox", async () => {
    await expect(harness().run(files.sizeless)).rejects.toThrow(
      /sizeless\.svg declares neither width\/height nor a viewBox/,
    )
  })

  it("forgets a failed load, so the fixed file loads without a restart", async () => {
    const file = path.join(dir, "retry.png")
    await writeFile(file, "not a png yet")
    const { run } = harness()
    await expect(run(file)).rejects.toThrow(/could not be decoded/)

    await writePng(file, 120, 80)
    expect(parseAsset(await run(file))).toMatchObject({
      width: 120,
      height: 80,
    })
  })

  //root reads a mode-000 file anyway, so the first load would not fail
  it.skipIf(process.getuid?.() === 0)(
    "forgets a failed load of bytes that did not change",
    async () => {
      //A read that fails for a reason outside the bytes, here a permission, keeps
      //the size and mtime the dedupe is keyed on. The retry must read again
      //rather than be handed the first rejection.
      const file = path.join(dir, "unreadable.png")
      await writePng(file, 120, 80)
      const before = await stat(file)
      const { run } = harness()
      await chmod(file, 0o000)
      try {
        await expect(run(file)).rejects.toThrow(/could not be decoded/)
      } finally {
        await chmod(file, 0o644)
      }
      const after = await stat(file)
      expect([after.size, after.mtimeMs]).toEqual([
        before.size,
        before.mtimeMs,
      ])
      expect(parseAsset(await run(file))).toMatchObject({
        width: 120,
        height: 80,
      })
    },
  )

  it("serves an edited file's new dimensions from the same dev server", async () => {
    //`vite dev` keeps one plugin instance for its whole life, and the watcher
    //re-runs `load` after an edit. The dedupe must not outlive the load it
    //dedupes, or the old size is served until a restart.
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    const file = path.join(dir, "edited.png")
    await writePng(file, 120, 80)
    const { run, buildEnd, infos } = harness()
    const before = await run(file)
    expect(parseAsset(before)).toMatchObject({ width: 120, height: 80 })

    await writePng(file, 200, 100)
    const after = await run(file)
    expect(parseAsset(after)).toMatchObject({ width: 200, height: 100 })
    expect(parseAsset(after).lqip).not.toBe(parseAsset(before).lqip)
    buildEnd()
    expect(infos).toEqual([expect.stringMatching(/ 2 encoded, 0 cached,/)])
  })

  it("caches on stat, so a second load never re-encodes", async () => {
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    const { run, buildEnd, infos } = harness()
    const first = await run(files.photo)
    const cold = performance.now()
    const second = await run(files.photo)
    const warm = performance.now() - cold
    expect(second).toBe(first)
    //the cache key is derivable from `stat()` alone; `vite-imagetools` hashes the
    //DECODED buffer before its lookup, which is why its rebuilds are barely
    //faster than its cold builds (its discussion #816)
    expect(warm).toBeLessThan(50)
    //the second answer is the on-disk entry, not a copy the plugin kept
    buildEnd()
    expect(infos).toEqual([expect.stringMatching(/ 1 encoded, 1 cached,/)])
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
    hook<(this: unknown, config: { root: string }) => void>(
      plugin.configResolved,
    ).call({}, { root: dir })

    const load = hook<LoadHook>(plugin.load)
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

describe("adaptvImagePlugin — the on-disk cache is a hint, never trusted", () => {
  async function cacheFileFor(root: string, file: string) {
    const stats = await stat(file)
    const key = imageCacheKey({
      file,
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      placeholder: true,
    })
    return path.join(
      root,
      "node_modules/.cache/adaptv/lqip",
      `${key}.json`,
    )
  }

  it.each([
    ["is not JSON", "{ half a write"],
    ["has a width that is not a number", `{"width":"wide","height":250}`],
    ["has no height", `{"width":400}`],
  ])("re-measures when the entry %s", async (_, content) => {
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    const { root, run, buildEnd, infos } = harness()
    const entry = await cacheFileFor(root, files.photo)
    await mkdir(path.dirname(entry), { recursive: true })
    await writeFile(entry, content)

    expect(parseAsset(await run(files.photo))).toMatchObject({
      width: 400,
      height: 250,
    })
    buildEnd()
    expect(infos).toEqual([expect.stringMatching(/ 1 encoded, 0 cached,/)])
    //and the entry is repaired, so the next process hits it
    expect(JSON.parse(await readFile(entry, "utf8"))).toMatchObject({
      width: 400,
      height: 250,
    })
  })

  //root ignores the mode bits, so the cache would be writable after all
  it.skipIf(process.getuid?.() === 0)(
    "still loads when the cache cannot be written",
    async () => {
      //a read-only node_modules: a Nix store, a container layer
      const root = path.join(dir, "roots", "read-only")
      await mkdir(root, { recursive: true })
      await chmod(root, 0o555)
      try {
        vi.stubEnv("ADAPTV_VERBOSE", "1")
        const { run, buildEnd, infos } = harness({ root })
        for (let load = 0; load < 2; load++) {
          expect(parseAsset(await run(files.photo))).toMatchObject({
            width: 400,
            height: 250,
          })
        }
        //slow, not wrong: with nowhere to keep the result, every load encodes
        buildEnd()
        expect(infos).toEqual([
          expect.stringMatching(/ 2 encoded, 0 cached,/),
        ])
      } finally {
        await chmod(root, 0o755)
      }
    },
  )
})

/**
 * The real `sharp`, with `metadata()` held open after it has read the file until
 * the test releases it: a load can be kept pending on purpose, instead of hoping
 * an encode is slow enough.
 */
async function withHeldEncode() {
  let release = () => {}
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  const reads: Array<{ width?: number; height?: number }> = []
  const waiters: Array<() => void> = []

  vi.resetModules()
  vi.doMock("sharp", async () => {
    const real = (await vi.importActual<typeof import("sharp")>("sharp"))
      .default
    const held = (input?: string) => {
      const image = real(input)
      const metadata = image.metadata.bind(image)
      image.metadata = (async () => {
        const result = await metadata()
        reads.push({ width: result.width, height: result.height })
        for (const wake of waiters.splice(0)) wake()
        await released
        return result
      }) as unknown as typeof image.metadata
      return image
    }
    return { default: held }
  })
  const isolated = await import("#adaptv/vite/adaptv-image.ts")

  return {
    createPlugin: isolated.adaptvImagePlugin,
    reads,
    release,
    /** Resolves once `count` files have been read, or after `ms`, whichever is first. */
    readsReached: (count: number, ms: number) =>
      Promise.race([
        (async () => {
          while (reads.length < count) {
            await new Promise<void>((wake) => waiters.push(wake))
          }
        })(),
        new Promise<void>((resolve) => setTimeout(resolve, ms)),
      ]),
  }
}

describe("adaptvImagePlugin — a load held open mid-encode", () => {
  afterEach(() => {
    vi.doUnmock("sharp")
    vi.resetModules()
  })

  it("dedupes a load that arrives while another is still encoding", async () => {
    //Vite asks for the same module from several environments at once, and an
    //HMR storm does the same; each of those must not re-encode the source.
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    const held = await withHeldEncode()
    const { run, buildEnd, infos } = harness({
      createPlugin: held.createPlugin,
    })
    const first = run(files.photo)
    await held.readsReached(1, 5_000)
    //a whole turn of the event loop, so a dedupe entry cleared a tick late is
    //already gone
    await new Promise((resolve) => setImmediate(resolve))
    const second = run(files.photo)
    //The bound only sets how long a second encode gets to show itself before
    //the first is let go. A second load slower than that finds the first one's
    //disk entry instead, which is still one encode, so correct code passes
    //either way.
    await held.readsReached(2, 250)
    held.release()

    expect(await second).toBe(await first)
    expect(held.reads).toHaveLength(1)
    buildEnd()
    expect(infos).toEqual([expect.stringMatching(/ 1 encoded, /)])
  })

  it("never hands a load started after an atomic save the size from before it", async () => {
    //An editor's save lands while the old bytes are still being encoded, and
    //the watcher's load for that save arrives before the encode is done. It
    //must measure the new file rather than join the load that read the old one.
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    const held = await withHeldEncode()
    const file = path.join(dir, "saved.png")
    await writePng(file, 120, 80)
    const { run, buildEnd, infos } = harness({
      createPlugin: held.createPlugin,
    })
    const before = run(file)
    await held.readsReached(1, 5_000)

    const temp = `${file}.tmp`
    await writePng(temp, 200, 100)
    const later = new Date(Date.now() + 10_000)
    await utimes(temp, later, later)
    await rename(temp, file)
    const after = run(file)
    //the second read is the new file being measured; the bound only sets how
    //long a joined load waits before the assertion says so
    await held.readsReached(2, 1_000)
    held.release()

    expect(parseAsset(await before)).toMatchObject({
      width: 120,
      height: 80,
    })
    expect(parseAsset(await after)).toMatchObject({
      width: 200,
      height: 100,
    })
    expect(held.reads).toEqual([
      { width: 120, height: 80 },
      { width: 200, height: 100 },
    ])
    buildEnd()
    expect(infos).toEqual([expect.stringMatching(/ 2 encoded, 0 cached,/)])
  })
})

describe("adaptvImagePlugin — the verbose build summary", () => {
  it("is silent unless ADAPTV_VERBOSE=1", async () => {
    vi.stubEnv("ADAPTV_VERBOSE", "")
    const { run, buildEnd, infos } = harness()
    await run(files.photo)
    buildEnd()
    expect(infos).toEqual([])
  })

  it("is silent when no image was imported", () => {
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    const { buildEnd, infos } = harness()
    buildEnd()
    expect(infos).toEqual([])
  })

  it("reports encodes, cache hits and the slowest file", async () => {
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    const cold = harness()
    await cold.run(files.photo)
    cold.buildEnd()
    expect(cold.infos).toEqual([
      expect.stringMatching(
        /^\[adaptv\] images: 1 encoded, 0 cached, [\d.]+ ms total, worst photo\.png at [\d.]+ ms$/,
      ),
    ])

    //a second process over the same project root: nothing encoded, so there is
    //no slowest file to name
    const warm = harness({ root: cold.root })
    await warm.run(files.photo)
    warm.buildEnd()
    expect(warm.infos).toEqual([
      expect.stringMatching(
        /^\[adaptv\] images: 0 encoded, 1 cached, [\d.]+ ms total$/,
      ),
    ])
  })
})

describe("adaptvImagePlugin — resolveId", () => {
  type ResolveIdHook = (
    this: unknown,
    source: string,
    importer?: string,
  ) => Promise<string | null>

  const resolveId = hook<ResolveIdHook>(adaptvImagePlugin().resolveId)

  it("keeps its query on the id Vite resolved the file to", async () => {
    const seen: unknown[] = []
    const context = {
      resolve: async (source: string, importer: string, opts: unknown) => {
        seen.push([source, importer, opts])
        return { id: "/app/src/hero.jpg" }
      },
    }
    expect(
      await resolveId.call(
        context,
        `./hero.jpg${ADAPTV_IMAGE_QUERY}`,
        "/app/src/page.tsx",
      ),
    ).toBe(`/app/src/hero.jpg${ADAPTV_IMAGE_QUERY}`)
    //skipSelf, or the plugin would be asked to resolve its own bare file forever
    expect(seen).toEqual([
      ["./hero.jpg", "/app/src/page.tsx", { skipSelf: true }],
    ])
  })

  it("leaves a file Vite cannot resolve to Vite's own not-found error", async () => {
    const context = { resolve: async () => null }
    expect(
      await resolveId.call(
        context,
        `./missing.jpg${ADAPTV_IMAGE_QUERY}`,
        "/app/src/page.tsx",
      ),
    ).toBeNull()
  })

  it("ignores every import without its query", async () => {
    const context = {
      resolve: async () => {
        throw new Error("must not be asked")
      },
    }
    expect(await resolveId.call(context, "./hero.jpg?url")).toBeNull()
  })
})

describe("adaptvImagePlugin — when sharp cannot load", () => {
  afterEach(() => {
    vi.doUnmock("sharp")
    vi.resetModules()
  })

  it("fails with an error that names the pnpm fix", async () => {
    //The one place this file stands in for a module: the field failure is the
    //native binary being absent for the platform, which a real install cannot
    //reproduce. The throw sits on `default` because Vitest rewraps a throwing
    //factory in its own message, and the cause text is part of what is asserted.
    vi.resetModules()
    vi.doMock("sharp", () => ({
      get default(): never {
        throw new Error(
          "Could not load the sharp module using the linux-x64 runtime",
        )
      },
    }))
    const isolated = await import("#adaptv/vite/adaptv-image.ts")
    const plugin = isolated.adaptvImagePlugin()
    hook<(this: unknown, config: { root: string }) => void>(
      plugin.configResolved,
    ).call({}, { root: path.join(dir, "roots", "no-sharp") })
    const load = hook<LoadHook>(plugin.load)
    const context = {
      warn: () => {},
      addWatchFile: () => {},
      error: (message: string) => {
        throw new Error(message)
      },
    }

    const failure = load
      .call(context, `${files.photo}${ADAPTV_IMAGE_QUERY}`)
      .catch((error: Error) => error.message)
    const message = await failure
    expect(message).toMatch(/^\[adaptv\] could not load "sharp"/)
    expect(message).toContain("linux-x64 runtime")
    expect(message).toContain(
      `"pnpm": { "supportedArchitectures": { "os": ["current", "linux"], "cpu": ["current", "x64", "arm64"] } }`,
    )
  })
})
