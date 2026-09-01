import { createHash } from "node:crypto"
import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Plugin } from "vite"
import type { AdaptvImageAsset } from "#adaptv/components/image.tsx"

/**
 * The suffix that opts an import into this pipeline.
 *
 * An explicit query rather than redefining what `import logo from "./logo.png"`
 * means app-wide (Next's model). adaptv is a component layer, not a full-stack
 * framework that owns the app's whole asset story: silently turning every image
 * import into an object breaks a plain `<img src={logo}>` (`[object Object]`) and
 * every `url(${logo})` template literal. Namespaced so it cannot collide with
 * `vite-imagetools` if a consumer also uses it.
 *
 * The cost of the choice is that the developer has to remember it. That cost is
 * paid by `Image`'s sizing union, not by magic: an import they forgot to annotate
 * is a `string`, and `<Image src={aString} />` does not compile.
 */
export const ADAPTV_IMAGE_QUERY = "?adaptv-image"

/** Raster formats `sharp` can both measure and re-encode, plus `svg` (measured only). */
const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".tif",
  ".tiff",
  ".svg",
])

/* =============================================================================
 * THE PIPELINE CONSTANTS
 *
 * Next uses 8 px at quality 70 but PRESERVES the source format, so a JPEG source
 * yields a 480–530 character data URL. WebP at 16 px / q50 is 136–172 B measured —
 * smaller than Next's output while carrying 4× the pixels. AVIF is the wrong
 * format at this size: the AV1/HEIF container overhead swamps the pixel data
 * (rose 16 px → WebP 136 B, AVIF 353 B, JPEG 362 B, the last with a ~330 B floor
 * from its quantization and Huffman tables alone).
 * ============================================================================= */

/** Longest edge of the placeholder, in pixels. */
export const LQIP_EDGE = 16
/** Baked at build time. There is no runtime `filter: blur()` anywhere in `Image`. */
export const LQIP_BLUR_SIGMA = 1.2
export const LQIP_QUALITY = 50
/** Below this, the placeholder would be larger than the image it stands in for. */
export const LQIP_MIN_SOURCE_EDGE = 40
/** Warn above this: it means the source is a giant flat PNG and the resize did not help. */
export const LQIP_WARN_BYTES = 1024

/**
 * Bumped whenever any constant above, or the encode chain itself, changes.
 *
 * It is a component of the cache key precisely so that a change here invalidates
 * every entry without anyone having to remember to clean a directory.
 */
export const LQIP_PIPELINE_VERSION = 1

const CACHE_DIR = path.join("node_modules", ".cache", "adaptv", "lqip")

/** The absolute file path behind an `…?adaptv-image` module id, or `null`. */
export function parseAdaptvImageId(id: string): string | null {
  if (!id.endsWith(ADAPTV_IMAGE_QUERY)) return null
  return id.slice(0, -ADAPTV_IMAGE_QUERY.length)
}

export function isSupportedImage(file: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(file).toLowerCase())
}

/**
 * EXIF orientations 5–8 are the quarter turns, and they swap the axes.
 *
 * Applied to the DIMENSIONS, not just the pixels, or a portrait photo tagged
 * sideways reserves a landscape box — a reservation that is wrong is a shift with
 * extra steps.
 */
export function orientedSize(size: {
  width: number
  height: number
  orientation?: number
}): { width: number; height: number } {
  const quarterTurned = (size.orientation ?? 1) >= 5
  return quarterTurned
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height }
}

/**
 * A vector's intrinsic size, from its own markup.
 *
 * Read here rather than handed to `sharp` because an SVG has no pixels to
 * measure: `sharp` would rasterise it at a density it picked, and the number
 * adaptv needs is the one the browser will use. `width`/`height` first (that is
 * what the browser prefers), `viewBox` as the fallback.
 */
export function svgIntrinsicSize(
  source: string,
): { width: number; height: number } | null {
  const openTag = source.match(/<svg\b[^>]*>/i)?.[0]
  if (!openTag) return null

  const attr = (name: string): number | null => {
    const raw = openTag.match(
      new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"),
    )?.[1]
    if (!raw) return null
    const value = Number.parseFloat(raw)
    //a percentage or an em is not an intrinsic pixel size — fall through to the
    //viewBox, which always is one.
    if (!Number.isFinite(value) || /%|em|rem|ex|ch/i.test(raw)) return null
    return value
  }

  const width = attr("width")
  const height = attr("height")
  if (width && height) return { width, height }

  const viewBox = openTag
    .match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1]
    ?.trim()
    .split(/[\s,]+/)
    .map(Number)
  if (viewBox?.length === 4 && viewBox[2] > 0 && viewBox[3] > 0) {
    return { width: viewBox[2], height: viewBox[3] }
  }
  return null
}

/**
 * Why this source gets no placeholder — or `null` if it gets one.
 *
 * ⚠︎ **A missing placeholder is cosmetic. A missing dimension is a layout shift.**
 * Every reason here is therefore silent; every case that costs a *dimension* is a
 * build ERROR instead — no `sharp`, an unreadable file, an SVG with neither size
 * nor `viewBox`, an undecodable image, an image that reports no dimensions. The
 * plugin may silently decline to produce a placeholder; it may never silently
 * decline to produce a reservation.
 */
export function lqipSkipReason(input: {
  enabled: boolean
  isVector: boolean
  pages: number
  width: number
  height: number
}): string | null {
  if (!input.enabled) return "disabled"
  //A vector has no meaningful low-resolution form, and it usually paints in the
  //frame it arrives in anyway.
  if (input.isVector) return "vector"
  //An animation's first frame is not the image, and inlining the WHOLE animated
  //file is how Next shipped megabyte placeholders (their issue #54012, guarded by
  //`!isAnimated(content)` since PR #54028).
  if (input.pages > 1) return "animated"
  if (Math.max(input.width, input.height) < LQIP_MIN_SOURCE_EDGE) {
    return "tiny"
  }
  return null
}

/**
 * The emitted module.
 *
 * `src` comes from a nested `?url` import rather than a string this plugin
 * builds: hashing, `base`, the small-asset inline threshold and the dev-server
 * path are all Vite's job, and re-deriving any of them here would be a second
 * implementation that drifts.
 */
export function renderImageAssetModule(
  file: string,
  asset: Omit<AdaptvImageAsset, "src">,
): string {
  const fields = [
    "  src,",
    `  width: ${asset.width},`,
    `  height: ${asset.height},`,
    ...(asset.lqip ? [`  lqip: ${JSON.stringify(asset.lqip)},`] : []),
  ]
  return [
    `import src from ${JSON.stringify(`${file}?url`)}`,
    "",
    "export default {",
    ...fields,
    "}",
    "",
  ].join("\n")
}

/**
 * `size + mtimeMs + pipeline version`, never a hash of the decoded pixels.
 *
 * `vite-imagetools` demonstrates the failure this avoids: it hashes
 * `await img.toBuffer()` *before* the cache lookup, i.e. a full decode and
 * re-encode on every hit. Its discussion #816 reports a VitePress build going
 * 3 s → 50 s with four images, with rebuilds barely faster. The whole point of a
 * cache is to not read the 4000 px source, so the key must be derivable from
 * `stat()` alone.
 */
export function imageCacheKey(input: {
  file: string
  size: number
  mtimeMs: number
  placeholder: boolean
}): string {
  return createHash("sha256")
    .update(
      [
        LQIP_PIPELINE_VERSION,
        input.file,
        input.size,
        input.mtimeMs,
        input.placeholder ? "lqip" : "no-lqip",
      ].join("|"),
    )
    .digest("hex")
    .slice(0, 24)
}

export type AdaptvImageOptions = {
  /**
   * Generate the low-resolution placeholder. `false` still resolves `width` and
   * `height` — the reservation is doctrine, the blur is a budget question.
   * Default `true`.
   */
  placeholder?: boolean
}

type ImageMeta = Omit<AdaptvImageAsset, "src">

type BuildStats = {
  processed: number
  cacheHits: number
  totalMs: number
  worstMs: number
  worstFile: string
}

/**
 * Resolves `import hero from "./hero.jpg?adaptv-image"` to an
 * {@link AdaptvImageAsset} — intrinsic `width`/`height` first, a 16 px WebP
 * `data:` URL placeholder second.
 *
 * **The dimensions are the product.** The same static-import detection that lets
 * a build generate a blur also yields the image's real size, and the size is the
 * entire CLS mechanism while the blur is decoration. Framed as a blur pipeline
 * this is a nice-to-have; framed as "static imports carry their own dimensions"
 * it is what makes `<Image src={hero} />` — no other props — the correct call.
 *
 * **Why not BlurHash or ThumbHash**, which is where `expo-image` reaches: both
 * need a JS decoder (1001 B / 1242 B gzipped, measured) and therefore **cannot
 * paint before hydration**. They are storage formats — Wolt's README motivates
 * BlurHash on fitting in a database column, and Expo decodes them in Swift and
 * Kotlin where the decoder costs zero incremental bytes. In a Capacitor WebView
 * adaptv is on Expo's *web* path, which allocates two canvases in a `useEffect`.
 * Break-even against the decoder is ~12 images per payload, bought with a
 * placeholder that cannot exist until the bundle has downloaded, parsed and run.
 *
 * **Why the blur is baked rather than filtered.** Next wraps its placeholder in
 * an SVG `feGaussianBlur` because it paints the placeholder onto the `<img>`
 * itself, so a CSS `filter` would blur the decoded photo too. adaptv already has
 * a separate layer, so the hack has no job here — and `sharp.blur()` at build
 * time costs nothing at runtime, creates no compositing layer, and sidesteps
 * Next's #86264 and #53329.
 *
 * @see docs/design/image.md §4
 */
export function adaptvImagePlugin(
  options: AdaptvImageOptions = {},
): Plugin {
  const placeholderEnabled = options.placeholder ?? true
  //Concurrent transforms of the same file must be deduped or an HMR storm
  //re-encodes it N times — the work is per-module and Vite will happily ask for
  //the same module from several environments at once.
  const inflight = new Map<string, Promise<ImageMeta>>()
  const stats: BuildStats = {
    processed: 0,
    cacheHits: 0,
    totalMs: 0,
    worstMs: 0,
    worstFile: "",
  }
  let cacheDir = CACHE_DIR

  return {
    name: "adaptv:image",
    //`pre`, and it is not optional. Vite's own asset plugin treats ANY unknown
    //query on a known image extension as a plain URL import, so at normal
    //enforcement `import hero from "./hero.jpg?adaptv-image"` resolves to the
    //string `"/assets/hero-D18UDLrP.jpg?adaptv-image"` before this plugin is ever
    //asked — a silent downgrade to a `src` with no dimensions, which is precisely
    //the failure `Image` exists to prevent. Verified by building it both ways.
    enforce: "pre",

    configResolved(config) {
      cacheDir = path.resolve(config.root, CACHE_DIR)
    },

    async resolveId(source, importer) {
      if (!source.endsWith(ADAPTV_IMAGE_QUERY)) return null
      const base = source.slice(0, -ADAPTV_IMAGE_QUERY.length)
      const resolved = await this.resolve(base, importer, {
        skipSelf: true,
      })
      if (!resolved) return null
      return `${resolved.id}${ADAPTV_IMAGE_QUERY}`
    },

    async load(id) {
      const file = parseAdaptvImageId(id)
      if (!file) return null

      if (!isSupportedImage(file)) {
        //Not a warning: the import produced no asset at all, so every `<Image>`
        //fed from it would be reaching for a `width` that does not exist.
        return this.error(
          `[adaptv] "?adaptv-image" does not handle ${path.extname(file) || "this file"} (${file}). ` +
            `Supported: ${[...SUPPORTED_EXTENSIONS].join(", ")}.`,
        )
      }

      this.addWatchFile(file)

      let pending = inflight.get(file)
      if (!pending) {
        pending = resolveImageMeta({
          file,
          cacheDir,
          placeholder: placeholderEnabled,
          stats,
        })
        inflight.set(file, pending)
      }

      let meta: ImageMeta
      try {
        meta = await pending
      } catch (cause) {
        inflight.delete(file)
        return this.error(
          cause instanceof Error ? cause.message : String(cause),
        )
      }

      if (meta.lqip && meta.lqip.length > LQIP_WARN_BYTES) {
        this.warn(
          `[adaptv] the placeholder for ${path.basename(file)} is ${meta.lqip.length} B ` +
            `(${meta.width}×${meta.height} source). That usually means a flat PNG screenshot ` +
            `the resize could not help — it ships in the JS bundle whether or not it is used.`,
        )
      }

      return renderImageAssetModule(file, meta)
    },

    buildEnd() {
      //Cold-build and warm-build totals are the numbers a cache regression shows
      //up in, and `vite-imagetools`' 3 s → 50 s is the shape being defended
      //against. Off by default: the CLI owns the verbose channel.
      if (process.env.ADAPTV_VERBOSE !== "1") return
      if (stats.processed === 0 && stats.cacheHits === 0) return
      this.info(
        `[adaptv] images: ${stats.processed} encoded, ${stats.cacheHits} cached, ` +
          `${stats.totalMs.toFixed(1)} ms total` +
          (stats.worstFile
            ? `, worst ${path.basename(stats.worstFile)} at ${stats.worstMs.toFixed(1)} ms`
            : ""),
      )
    },
  }
}

async function resolveImageMeta(input: {
  file: string
  cacheDir: string
  placeholder: boolean
  stats: BuildStats
}): Promise<ImageMeta> {
  const started = performance.now()
  const stats = await stat(input.file).catch(() => null)
  if (!stats) {
    throw new Error(
      `[adaptv] cannot read ${input.file}. A "?adaptv-image" import that cannot be measured ` +
        `has no width or height, so every <Image> fed from it would reserve nothing.`,
    )
  }

  const key = imageCacheKey({
    file: input.file,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
    placeholder: input.placeholder,
  })
  const cacheFile = path.join(input.cacheDir, `${key}.json`)
  const cached = await readCache(cacheFile)
  if (cached) {
    input.stats.cacheHits += 1
    return cached
  }

  const meta = await measureAndEncode(input.file, input.placeholder)
  await writeCache(cacheFile, meta)

  const elapsed = performance.now() - started
  input.stats.processed += 1
  input.stats.totalMs += elapsed
  if (elapsed > input.stats.worstMs) {
    input.stats.worstMs = elapsed
    input.stats.worstFile = input.file
  }
  return meta
}

async function readCache(file: string): Promise<ImageMeta | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as ImageMeta
    if (typeof parsed.width !== "number") return null
    if (typeof parsed.height !== "number") return null
    return parsed
  } catch {
    return null
  }
}

async function writeCache(file: string, meta: ImageMeta): Promise<void> {
  try {
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, JSON.stringify(meta))
  } catch {
    //A cache that cannot be written is slow, not wrong. Read-only `node_modules`
    //(a Nix store, a container layer) must not fail the build.
  }
}

async function measureAndEncode(
  file: string,
  placeholder: boolean,
): Promise<ImageMeta> {
  if (path.extname(file).toLowerCase() === ".svg") {
    const size = svgIntrinsicSize(await readFile(file, "utf8"))
    if (!size) {
      throw new Error(
        `[adaptv] ${path.basename(file)} declares neither width/height nor a viewBox, ` +
          `so it has no intrinsic size to reserve a box from. Add a viewBox.`,
      )
    }
    return {
      width: Math.round(size.width),
      height: Math.round(size.height),
    }
  }

  const sharp = await loadSharp()
  const source = sharp(file)
  let raw: {
    width?: number
    height?: number
    orientation?: number
    pages?: number
  }
  try {
    raw = await source.metadata()
  } catch (cause) {
    throw new Error(
      `[adaptv] ${path.basename(file)} could not be decoded (${cause instanceof Error ? cause.message : cause}). ` +
        `Without its dimensions every <Image> using it would reserve nothing.`,
    )
  }
  if (!raw.width || !raw.height) {
    throw new Error(
      `[adaptv] ${path.basename(file)} reports no dimensions, so it cannot reserve a box.`,
    )
  }

  const { width, height } = orientedSize({
    width: raw.width,
    height: raw.height,
    orientation: raw.orientation,
  })

  const skip = lqipSkipReason({
    enabled: placeholder,
    isVector: false,
    pages: raw.pages ?? 1,
    width,
    height,
  })
  if (skip) return { width, height }

  const buffer = await sharp(file)
    //EXIF first, so the placeholder is not a sideways version of the photo.
    .rotate()
    .resize({ width: LQIP_EDGE, height: LQIP_EDGE, fit: "inside" })
    .blur(LQIP_BLUR_SIGMA)
    .webp({ quality: LQIP_QUALITY, smartSubsample: true })
    .toBuffer()

  return {
    width,
    height,
    lqip: `data:image/webp;base64,${buffer.toString("base64")}`,
  }
}

/**
 * `sharp`, or a build error that names its own fix.
 *
 * The CLI's own `loadSharp()` returns `null` and downgrades to one warning —
 * correct there, because a missing launcher icon is visible. It is the wrong
 * policy here: without `sharp` there are no dimensions, so every
 * `?adaptv-image` import would silently stop reserving.
 *
 * pnpm plus optional dependencies is the #1 field failure ("Could not load the
 * sharp module using the linux-x64 runtime"), and adaptv's own playground is a
 * pnpm workspace, so its consumers will hit it. An error that names its fix is
 * the difference between a support ticket and a 30-second repair.
 */
async function loadSharp() {
  try {
    return (await import("sharp")).default
  } catch (cause) {
    throw new Error(
      `[adaptv] could not load "sharp", so no "?adaptv-image" import can be measured ` +
        `and every <Image> using one would reserve no box.\n` +
        `  ${cause instanceof Error ? cause.message : String(cause)}\n` +
        `  On pnpm this is usually the optional-dependency resolution: add to package.json\n` +
        `    "pnpm": { "supportedArchitectures": { "os": ["current", "linux"], "cpu": ["current", "x64", "arm64"] } }\n` +
        `  then reinstall.`,
    )
  }
}
