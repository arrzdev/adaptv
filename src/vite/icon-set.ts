// The app's icon set — ONE answer, read by everything that needs one.
//
// An app declares a single icon directory (`icons` in adaptv.config.ts — there is deliberately
// no default; see {@link resolveIconSet}). Three consumers care what is in it, and until this
// module existed each one asked the question its own way:
//
//   - the **web manifest** (`manifest.ts`) took files literally starting `android-` and read
//     their size out of the FILENAME,
//   - the **head** (`shell/head.ts`) hardcoded ~20 links under `/favicons`, ignoring the config
//     key and linking files that need not exist,
//   - the **native launcher icons** (`bin/lib/icons.mjs`) scanned the directory and measured
//     every file for real.
//
// Three implementations of one idea is the failure mode `docs/design/cli-contract.md` R26 is about: they drift,
// and here they had. A `logo.png` branded the iOS app and contributed nothing to the manifest;
// an `android-chrome-192.png` a designer had resized by hand was trusted to be 192px. So the
// scan lives here, once, and native/manifest/head all read the same resolved set.
//
// Deliberately NO sharp and NO writing. This module is imported by vite plugins that run on
// every dev request, and by `bin/` before a run starts (through the CLI's esbuild loader) — it
// has to be cheap and side-effect-free. Producing icons is `bin/lib/icon-gen.mjs`; branding the
// native projects from a pick is `bin/lib/icons.mjs`. → docs/decisions/register.md L8 (one config source).
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

// RASTER ONLY for RANKING, on purpose. A PWA icon set's vector member is usually
// `safari-pinned-tab.svg` — a flat monochrome silhouette that would make a solid black launcher
// icon — and nothing in the filename reliably separates that from a real logo.svg. Raster also
// keeps the resolution warning honest: a pixel count is a fact, "it's a vector" is a promise.
// (`gen icons` may still COPY a vector source through as `icon.svg`; that file is head-linked
// by name, never ranked.)
const ICON_EXTS = new Set([".png", ".webp", ".jpg", ".jpeg"])

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
}

/** Which platform an icon file was drawn FOR. → {@link iconFamily} */
export type IconFamily =
  | "dark"
  | "tinted"
  | "monochrome"
  | "maskable"
  | "android"
  | "apple"
  | "ms"
  | "favicon"
  | "generic"

/** One usable icon in the app's icon directory, MEASURED — never parsed from its name. */
export type IconFile = {
  /** Absolute path on disk. */
  file: string
  /** Basename, e.g. `android-chrome-512.png`. */
  name: string
  family: IconFamily
  width: number
  height: number
  /** Whether the file declares an alpha CHANNEL (not whether it uses it — see `resolveOpacity` in `bin/lib/icons.mjs`). */
  alpha: boolean
}

/**
 * Which platform an icon file was drawn FOR, from its name. These are the families a standard
 * PWA/favicon generator emits; anything unrecognised is `generic` — a plain `icon.png` /
 * `logo.png` / `my-mark.png`, which is the single best source there is.
 */
export function iconFamily(filename: string): IconFamily {
  const name = filename.toLowerCase()
  // iOS 18 appearance variants, matched on the WHOLE basename rather than a `-dark` substring:
  // a favicon set's `favicon-dark.svg` is a different idea entirely (a tab icon for a dark
  // browser chrome), and letting it read as an app-icon appearance would put it in the asset
  // catalog. Only `gen icons` writes these two names.
  if (/^icon-dark\./.test(name)) return "dark"
  if (/^icon-tinted\./.test(name)) return "tinted"
  // Android's themed-icon layer. Same rule as above and the same reason: matched whole, so a
  // `logo-monochrome.png` a dev happens to keep in the directory stays rankable art.
  if (/^icon-monochrome\./.test(name)) return "monochrome"
  if (name.includes("maskable")) return "maskable"
  if (name.startsWith("android")) return "android"
  if (name.startsWith("apple")) return "apple"
  if (/^(?:ms|mstile|msapplication|browserconfig)/.test(name)) return "ms"
  if (name.includes("favicon")) return "favicon"
  return "generic"
}

/**
 * `{ width, height, alpha }` from an image header, or null when the bytes aren't a PNG, JPEG or
 * WebP. Header-only: ranking a directory of icons must not cost a decode each.
 */
export function readImageHeader(
  buf: Buffer,
): { width: number; height: number; alpha: boolean } | null {
  if (buf.length < 24) return null

  // PNG — IHDR is always the first chunk: width/height at 16/20, colour type at 25.
  // Bit 2 of the colour type is the alpha channel (4 = grey+A, 6 = RGBA); a palette image
  // (3) carries its transparency in a separate tRNS chunk instead.
  if (buf.readUInt32BE(0) === 0x89504e47) {
    const colorType = buf[25]
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
      alpha: (colorType & 4) !== 0 || buf.includes("tRNS", 0, "latin1"),
    }
  }

  // WebP — RIFF container, then one of three header chunks.
  if (
    buf.readUInt32BE(0) === 0x52494646 &&
    buf.readUInt32BE(8) === 0x57454250
  ) {
    const chunk = buf.toString("latin1", 12, 16)
    if (chunk === "VP8X")
      return {
        width: (buf.readUIntLE(24, 3) & 0xffffff) + 1,
        height: (buf.readUIntLE(27, 3) & 0xffffff) + 1,
        alpha: (buf[20] & 0x10) !== 0,
      }
    if (chunk === "VP8L") {
      const bits = buf.readUInt32LE(21)
      return {
        width: (bits & 0x3fff) + 1,
        height: ((bits >> 14) & 0x3fff) + 1,
        alpha: (buf[24] & 0x10) !== 0,
      }
    }
    if (chunk === "VP8 ")
      return {
        width: buf.readUInt16LE(26) & 0x3fff,
        height: buf.readUInt16LE(28) & 0x3fff,
        alpha: false,
      }
    return null
  }

  // JPEG — walk the segment chain to a start-of-frame marker, which is the only place the
  // dimensions live. JPEG has no alpha channel at all.
  if (buf.readUInt16BE(0) === 0xffd8) {
    let i = 2
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++
        continue
      }
      const marker = buf[i + 1]
      // SOF0–SOF15, minus the four markers in that range that aren't frame headers.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        ![0xc4, 0xc8, 0xcc, 0xd8].includes(marker)
      )
        return {
          height: buf.readUInt16BE(i + 5),
          width: buf.readUInt16BE(i + 7),
          alpha: false,
        }
      i += 2 + buf.readUInt16BE(i + 2)
    }
  }

  return null
}

/**
 * Every usable icon in `dirAbs`, with its REAL pixel size read from the file header rather than
 * parsed out of the filename. Names lie (`android-chrome-192.png` resized by hand, `logo.png`
 * with no size in it at all) and both the resolution warning and the manifest's `sizes` are only
 * worth anything if they are measured. Unreadable or non-image files are skipped, never fatal.
 */
export function scanIcons(dirAbs: string): IconFile[] {
  if (!existsSync(dirAbs)) return []
  let names: string[]
  try {
    names = readdirSync(dirAbs)
  } catch {
    return []
  }
  const found: IconFile[] = []
  for (const name of names.sort()) {
    if (!ICON_EXTS.has(path.extname(name).toLowerCase())) continue
    const file = path.join(dirAbs, name)
    let header: ReturnType<typeof readImageHeader>
    try {
      // 4 KB covers a PNG's IHDR/tRNS, a WebP's VP8X/VP8L header, and a JPEG's SOF marker
      // past the usual EXIF block — without pulling whole megabyte icons into memory.
      header = readImageHeader(readFileSync(file).subarray(0, 4096))
    } catch {
      continue
    }
    if (!header) continue
    found.push({ file, name, family: iconFamily(name), ...header })
  }
  return found
}

// There is deliberately no `DEFAULT_ICONS_DIR` here any more. It was `"./public/favicons"`,
// and `resolveIconSet` fell back to it whenever `icons` was unset — which meant an app could
// not opt OUT of its own icon directory, because removing the key resolved to the same place.
// The conventional location still belongs in the `icons` docs; it does not belong in the code
// that decides which set a build uses. → {@link resolveIconSet}

/** URL prefix the framework's own icon set is served/emitted under. */
export const DEFAULT_ICONS_URL_BASE = "/adaptv-icons"

/** Where adaptv's own set lives inside the published package. */
const DEFAULT_ICONS_SUBDIR = "assets/default-icons"

/** Files in the default set that are servable but not rankable art. */
const DEFAULT_ICONS_EXTRA_EXTS = new Set([".ico", ".svg"])

let defaultIconsDirCache: string | null | undefined
let defaultIconsCache: IconFile[] | null = null

/**
 * Where adaptv's own set lives on THIS machine, or null when the package has no assets.
 *
 * Found by walking UP from this module rather than by a fixed `../..`, because the same file is
 * loaded from `src/` (a linked framework, and the CLI's esbuild loader) and would be loaded from
 * a bundle directory in a published build. Walking stops at the filesystem root, so a package
 * missing its assets yields null — the app then ships with no icons, exactly as it did before
 * adaptv had a mark, rather than the whole config load throwing.
 */
function defaultIconsDir(): string | null {
  if (defaultIconsDirCache !== undefined) return defaultIconsDirCache
  let dir = import.meta.dirname
  for (let up = 0; up < 6; up++) {
    const candidate = path.join(dir, DEFAULT_ICONS_SUBDIR)
    if (existsSync(candidate)) {
      defaultIconsDirCache = candidate
      return candidate
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  defaultIconsDirCache = null
  return null
}

/**
 * Every file of the default set that has to be SERVED — the rankable rasters plus the `.ico`
 * and `.svg` members, which `scanIcons` deliberately skips (a vector can't be measured and an
 * icon container isn't a bitmap) but which `headIconLinks` links by name.
 *
 * Separate from {@link defaultIconFiles} because the two answer different questions: what art
 * can adaptv RANK, versus what files must exist at a URL. Serving only the first is what left
 * `/adaptv-icons/favicon.ico` a 404 under a `<link>` pointing straight at it.
 *
 * `NATIVE_ONLY` is dropped, and it is deliberately not `NOT_IN_MANIFEST`: that set also holds
 * `apple`, which the HEAD links by name — filtering on it would 404 the touch icon.
 */
export function defaultIconAssets(): string[] {
  const dir = defaultIconsDir()
  if (!dir) return []
  const rasters = defaultIconFiles()
    .filter((i) => !NATIVE_ONLY.has(i.family))
    .map((i) => i.name)
  let extra: string[] = []
  try {
    extra = readdirSync(dir).filter((n) =>
      DEFAULT_ICONS_EXTRA_EXTS.has(path.extname(n).toLowerCase()),
    )
  } catch {}
  return [...rasters, ...extra].map((name) => path.join(dir, name))
}

/** adaptv's own RANKABLE art — the mark an app wears when it has none of its own. */
export function defaultIconFiles(): IconFile[] {
  if (defaultIconsCache) return defaultIconsCache
  const dir = defaultIconsDir()
  defaultIconsCache = dir ? scanIcons(dir) : []
  return defaultIconsCache
}

/**
 * The icon set a build is actually going to use.
 *
 * `source` is the whole point:
 *   - `"app"`    — the dev's own art, under `urlBase` inside their `public/`.
 *   - `"default"`— they have none, so adaptv's mark is used instead. The rule is *no usable
 *                  art found*, not *no `icons` key in the config*: an app that names an empty
 *                  directory is in exactly the same position as one that names nothing, and
 *                  shipping Capacitor's stock icon in either case is the bug being fixed.
 *
 * `error` is set instead of throwing when the directory can't be served — an icon directory
 * outside `public/` used to produce `../../..` hrefs in the manifest, silently. The caller
 * (preflight) turns it into a `✖` that stops the run naming the config key (R7/R33).
 */
export type IconSet = {
  source: "app" | "default"
  /**
   * Whether the app NAMED an icon directory. Two different situations reach `source:
   * "default"` — a config that points somewhere empty, and a config that points nowhere at
   * all — and they need different sentences: one says which directory to fill, the other says
   * which key to set. Without this they shared a message that named a path the dev never wrote.
   */
  configured: boolean
  /** App-relative directory, as the dev wrote it — `""` when unconfigured. Messages only. */
  dirRel: string
  dirAbs: string
  /** URL prefix the icons are reachable at, no trailing slash. */
  urlBase: string
  icons: IconFile[]
  error?: string
}

export type IconSetConfig = { icons?: string }

/**
 * Resolve the app's icon set. Cheap enough to call per dev-server request (one `readdir` plus a
 * 4 KB read per file), which is what keeps the served manifest honest while a dev is adding art.
 *
 * `defaultIcons` is injected rather than read from disk here so this module stays fs-light and
 * bundler-safe; callers that can supply adaptv's own set pass it, and everyone else simply gets
 * `source: "default"` with an empty list to report on.
 */
export function resolveIconSet(
  appRoot: string,
  config: IconSetConfig,
  defaultIcons: IconFile[] = [],
): IconSet {
  // The config KEY drives this, and there is deliberately no fallback directory. It used to
  // default to `./public/favicons` for reading, on the theory that an app with art there
  // should work without configuring anything. The cost of that convenience was that removing
  // `icons` from the config changed nothing at all — the set resolved to the same directory,
  // the same manifest, the same launcher icons — so "no icons dir configured ships adaptv's
  // mark" was a rule the framework did not actually have. Reported as icons that would not
  // update. `gen icons` already refused to GUESS a directory to write into; this is the read
  // path finally agreeing with the write path.
  const configured = typeof config.icons === "string"
  const dirRel = configured ? (config.icons as string) : ""
  const dirAbs = configured ? path.resolve(appRoot, dirRel) : ""
  const icons = configured ? scanIcons(dirAbs) : []

  if (icons.length === 0)
    return {
      source: "default",
      configured,
      //`dirRel` stays the APP's directory — it is what every message names, and "put your
      //icons here" is the only actionable thing about a default set. `dirAbs` follows the
      //FILES, because callers probe it for the members that aren't rankable rasters
      //(`favicon.ico`, `icon.svg`) and the app's empty directory has none of them.
      dirRel,
      dirAbs: defaultIcons[0]
        ? path.dirname(defaultIcons[0].file)
        : dirAbs,
      urlBase: DEFAULT_ICONS_URL_BASE,
      icons: defaultIcons,
    }

  const publicDir = path.resolve(appRoot, "public")
  const rel = path.relative(publicDir, dirAbs)
  // `..` means the directory is outside `public/`, so nothing in it is served at any URL. It
  // still brands the NATIVE icons perfectly well, which is why this is reported rather than
  // fatal here — `icons` naming an unserved directory is a real, common setup.
  const served =
    rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
  return {
    source: "app",
    //Unreachable unless the dev named a directory — an unconfigured app has no icons to scan.
    configured: true,
    dirRel,
    dirAbs,
    urlBase: served ? `/${rel.replaceAll(path.sep, "/")}` : "",
    icons,
    ...(served
      ? {}
      : {
          error: `\`icons\` must be a directory inside public/ so the icons are served — got ${JSON.stringify(dirRel)}`,
        }),
  }
}

export type WebManifestIcon = {
  src: string
  sizes: string
  type: string
  /** `"maskable"` for adaptive icons (safe-zone art on a solid bg), else omitted (= `any`). */
  purpose?: string
}

// Below this an entry is noise: a manifest icon is a home-screen / splash / install-prompt
// asset, and every consumer of one ignores a 16px favicon. Those belong in the head.
const MIN_MANIFEST_PX = 48

// Above this, nothing is asking. 512 is the largest slot any browser fills — Chrome's generated
// splash — so a bigger entry is a download a user pays for and no platform uses.
//
// It also keeps the NATIVE masters out, which matters more than the bytes. `gen icons` writes a
// 1024px `icon-maskable.png` as Android's adaptive FOREGROUND, and that file is transparent by
// design: the launcher composites it over `ic_launcher_background`. Advertised to a browser as
// `purpose: "maskable"` — which promises full-bleed art on a solid background — it would render
// as a mark floating in a transparent circle on Chrome's splash. The cap is what stops adaptv
// publishing an internal file under a contract it doesn't meet.
const MAX_MANIFEST_PX = 512

/**
 * The families that exist for a LAUNCHER and have no web surface at all. Nothing links them,
 * and the native brander reads them off disk rather than over HTTP — so for the default set
 * they are also the files that must not be emitted into an app's build output.
 */
const NATIVE_ONLY: ReadonlySet<IconFamily> = new Set([
  "dark",
  "tinted",
  "monochrome",
])

// `apple` and `ms` art is linked from the HEAD, by rel, and means nothing to a manifest
// consumer. Everything else — including a plain `favicon-512x512.png`, which is a perfectly
// good 512px icon whatever its name says — is eligible.
const NOT_IN_MANIFEST: ReadonlySet<IconFamily> = new Set([
  "apple",
  "ms",
  //The launcher-only families (`NATIVE_ONLY`): the iOS 18 appearances — one a bare mark on
  //nothing, the other a greyscale ramp — and Android's themed layer, a white silhouette whose
  //ink a launcher supplies. On a web surface that last one is an invisible icon.
  ...NATIVE_ONLY,
])

// Which family to keep when two files claim the same (size, purpose) slot. Nothing downstream
// can tell them apart, so the tie is broken once, here, and deterministically.
const MANIFEST_FAMILY_ORDER: IconFamily[] = [
  "maskable",
  "android",
  "generic",
  "favicon",
  "apple",
  "ms",
]

/**
 * The manifest's `icons` array, derived from what the app actually has.
 *
 * Every rule here exists because the previous version — "filenames starting `android-`, sized by
 * regex" — got one of them wrong:
 *
 *  - **measured sizes.** A hand-resized `android-chrome-192.png` that is really 180px used to be
 *    declared as 192; a browser that trusts `sizes` then picks it for a 192 slot and upscales.
 *  - **families, not prefixes.** `icon.png` and `logo-512.png` are the single best art most apps
 *    have and contributed nothing.
 *  - **deduped by (size, purpose).** A full favicon-generator set ships `android-chrome-192.png`
 *    AND `android-icon-192x192.png`; two identical entries make an install prompt pick arbitrarily
 *    and bloat the manifest for no gain.
 *  - **non-square art is dropped.** `sizes: "512x256"` is legal to write and useless to every
 *    consumer — a launcher icon slot is square.
 *
 * Maskable last so a consumer that takes the first match still gets an `any` icon, while
 * Android's adaptive/splash path finds the maskable set. → `docs/design/rendering.md`
 */
export function manifestIcons(set: IconSet): WebManifestIcon[] {
  if (!set.urlBase) return []
  const best = new Map<string, IconFile>()
  const rank = (f: IconFamily) => MANIFEST_FAMILY_ORDER.indexOf(f)

  const eligible = set.icons.filter(
    (i) =>
      !NOT_IN_MANIFEST.has(i.family) &&
      i.width === i.height &&
      i.width >= MIN_MANIFEST_PX,
  )
  // An app whose only art is one oversized master still gets a manifest: better a single
  // 1024px entry than an empty `icons` array and no install prompt at all.
  const sized = eligible.filter((i) => i.width <= MAX_MANIFEST_PX)
  for (const icon of sized.length > 0 ? sized : smallestOf(eligible)) {
    const purpose = icon.family === "maskable" ? "maskable" : "any"
    const key = `${icon.width}:${purpose}`
    const held = best.get(key)
    if (
      !held ||
      rank(icon.family) < rank(held.family) ||
      (rank(icon.family) === rank(held.family) && icon.name < held.name)
    )
      best.set(key, icon)
  }

  return [...best.values()]
    .sort(
      (a, b) =>
        a.width - b.width ||
        (a.family === "maskable" ? 1 : 0) -
          (b.family === "maskable" ? 1 : 0),
    )
    .map((icon) => ({
      src: `${set.urlBase}/${icon.name}`,
      sizes: `${icon.width}x${icon.height}`,
      type: MIME[path.extname(icon.name).toLowerCase()] ?? "image/png",
      ...(icon.family === "maskable" ? { purpose: "maskable" } : {}),
    }))
}

/**
 * The smallest icon of each purpose — the fallback when every candidate is over the cap, so a
 * set of oversized masters still yields one usable entry per purpose rather than none.
 */
function smallestOf(icons: IconFile[]): IconFile[] {
  const keep = new Map<string, IconFile>()
  for (const icon of icons) {
    const purpose = icon.family === "maskable" ? "maskable" : "any"
    const held = keep.get(purpose)
    if (!held || icon.width < held.width) keep.set(purpose, icon)
  }
  return [...keep.values()]
}

/**
 * Whether the set can produce an installable PWA, or null when it can — and it must be null
 * for any normal set, because a warning every project sees teaches devs to ignore the `!`
 * (R5/R7b).
 *
 * The bar is 192px because that is Chrome's HARD requirement for offering the install prompt
 * at all. The familiar "192 *and* 512" pair is a Lighthouse recommendation, not a requirement:
 * an app whose whole icon set is one 1024px `icon.png` is perfectly installable — browsers
 * downscale — and warning about it would be adaptv inventing a problem.
 */
export function installabilityIssue(
  icons: WebManifestIcon[],
): string | null {
  const px = icons.map((i) => Number.parseInt(i.sizes, 10))
  const largest = px.length > 0 ? Math.max(...px) : 0
  if (largest === 0)
    return `web manifest has no icons — adaptv gen icons <image>`
  if (largest < 192)
    return `web manifest's largest icon is ${largest}px — a PWA needs 192px`
  return null
}

/** Sizes iOS actually asks for. 180 is the only one a modern device uses. */
const APPLE_TOUCH_SIZES = [120, 152, 167, 180]

// A `rel="icon"` is a TAB icon: the browser downloads it to draw at 16–32 CSS px. Linking the
// 1024px native master there costs the visitor a megabyte to render a favicon, so the head stops
// at the largest size a browser has any use for (512 covers Chrome's tab + bookmark cases).
const MAX_HEAD_RASTER_PX = 512

/**
 * The `<link rel=icon|apple-touch-icon>` set, derived from the files that EXIST.
 *
 * This replaces a hardcoded twenty-entry list under a hardcoded `/favicons` base. That list
 * ignored the `icons` config key entirely, and every app that didn't happen to use the same
 * favicon generator shipped a head full of 404s — including two `favicon-light/dark.svg` links
 * that cannot be derived from one source image and so exist almost nowhere.
 *
 * Order matters to browsers: they generally take the LAST usable `rel="icon"`, so the biggest
 * raster goes last and an SVG (resolution-independent, always the best answer when present)
 * goes last of all.
 */
export function headIconLinks(
  set: IconSet,
): Array<Record<string, string>> {
  if (!set.urlBase) return []
  const href = (name: string) => `${set.urlBase}/${name}`
  const links: Array<Record<string, string>> = []
  const byName = new Map(set.icons.map((i) => [i.name.toLowerCase(), i]))

  // `favicon.ico` is not in `set.icons` (it is not a rankable raster), so it is probed by name.
  // FIRST, and untyped-by-size: a bare `/favicon.ico` is still fetched by feed readers, crawlers
  // and old browsers, but any PNG below should outrank it in a browser that understands both.
  if (existsSync(path.join(set.dirAbs, "favicon.ico")))
    links.push({
      rel: "icon",
      href: href("favicon.ico"),
      type: "image/x-icon",
    })

  const square = set.icons.filter(
    (i) =>
      i.width === i.height &&
      i.family !== "apple" &&
      i.family !== "ms" &&
      i.family !== "maskable" &&
      i.family !== "dark" &&
      i.family !== "tinted" &&
      i.family !== "monochrome",
  )
  // Everything a tab icon could want, ascending. An app whose ONLY art is the 1024px master
  // still gets a link — better one oversized favicon than none.
  const rasters = square.filter((i) => i.width <= MAX_HEAD_RASTER_PX)
  const smallest = [...square].sort((a, b) => a.width - b.width)[0]
  const usable = rasters.length > 0 ? rasters : smallest ? [smallest] : []

  // ONE link per size. A full favicon-generator set ships `android-icon-96x96.png` AND
  // `favicon-96x96.png`; a browser downloads exactly one of them, so the second is a line of
  // markup in every document that can only ever be ignored. Same tie-break as the manifest, so
  // the head and the manifest can't disagree about which file represents a size.
  const bySize = new Map<number, IconFile>()
  for (const icon of usable) {
    const held = bySize.get(icon.width)
    if (
      !held ||
      MANIFEST_FAMILY_ORDER.indexOf(icon.family) <
        MANIFEST_FAMILY_ORDER.indexOf(held.family) ||
      (icon.family === held.family && icon.name < held.name)
    )
      bySize.set(icon.width, icon)
  }

  for (const icon of [...bySize.values()].sort(
    (a, b) => a.width - b.width,
  ))
    links.push({
      rel: "icon",
      href: href(icon.name),
      sizes: `${icon.width}x${icon.width}`,
      type: MIME[path.extname(icon.name).toLowerCase()] ?? "image/png",
    })

  // Last, so it wins: a vector is resolution-independent and is always the best tab icon there
  // is. Only `gen icons` writes this name, and only when the dev's source was itself a vector.
  if (existsSync(path.join(set.dirAbs, "icon.svg")))
    links.push({
      rel: "icon",
      href: href("icon.svg"),
      sizes: "any",
      type: "image/svg+xml",
    })

  // iOS ignores `sizes` on `apple-touch-icon` in practice and takes the LAST one it can use, so
  // the sizes that exist are emitted ascending with the unsized generator fallback first. A touch
  // icon is composited on an opaque background by the OS; adaptv's generator already flattens it.
  const touch = APPLE_TOUCH_SIZES.map((px) =>
    [
      `apple-touch-icon-${px}.png`,
      `apple-touch-icon-${px}x${px}.png`,
      `apple-icon-${px}x${px}.png`,
    ].find((n) => byName.has(n)),
  ).filter((n): n is string => n !== undefined)
  for (const name of [
    ...(byName.has("apple-touch-icon.png")
      ? ["apple-touch-icon.png"]
      : []),
    ...touch,
  ])
    links.push({ rel: "apple-touch-icon", href: href(name) })

  return links
}
