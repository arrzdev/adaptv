// Launcher icons — ONE source set, the right art per platform.
//
// The app declares a single icon directory (`icons` in adaptv.config.ts, default
// `./public/favicons`) and adaptv reads it for BOTH the web manifest (src/vite/manifest.ts)
// and the native launcher icons. There is deliberately no second `assets/logo.png`
// convention: a PWA icon set already ships platform-specific art, so the framework's job is
// to PICK the right member of that set for the build being produced — not to ask the dev to
// maintain another file that says the same thing. → DECISIONS.md L8 (one config source).
//
// adaptv writes the native icon files itself rather than shelling out to `@capacitor/assets`.
// That package is a 260-package tree pinned to an old `@capacitor/cli` whose `sharp` needs a
// native build step, and the surface it would generate for us is tiny and fully known: one
// 1024px PNG for iOS, fifteen mipmaps plus a colour resource for Android. adaptv already
// hand-writes the native splash + theme resources next door (`patchAndroidSplash`,
// `patchIosTheme`), so the launcher icon belongs in the same place. → DECISIONS.md L20.
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

/* =============================================================================
 * the icon set (pure — no fs, no sharp)
 * ============================================================================= */

// RASTER ONLY, on purpose. A PWA icon set's vector member is usually
// `safari-pinned-tab.svg` — a flat monochrome silhouette that would make a solid black
// launcher icon — and nothing in the filename reliably separates that from a real logo.svg.
// Raster also keeps the resolution warning honest: a pixel count is a fact, "it's a vector"
// is a promise. A dev with only an SVG gets the "no icons" warning, which names the fix.
const ICON_EXTS = new Set([".png", ".webp", ".jpg", ".jpeg"])

/**
 * Which platform an icon file was drawn FOR, from its name. These are the families a
 * standard PWA/favicon generator emits; anything unrecognised is `generic` — a plain
 * `icon.png` / `logo.png` / `my-mark.png`, which is the single best source there is.
 */
export function iconFamily(filename) {
  const name = filename.toLowerCase()
  if (name.includes("maskable")) return "maskable"
  if (name.startsWith("android")) return "android"
  if (name.startsWith("apple")) return "apple"
  if (/^(?:ms|mstile|msapplication|browserconfig)/.test(name)) return "ms"
  if (name.includes("favicon")) return "favicon"
  return "generic"
}

/**
 * Family preference per build target, best first.
 *
 * iOS never masks an icon, so `maskable` art (a small mark floating in a 66dp safe zone)
 * ranks BELOW a full-bleed square — it would ship a tiny logo. Android inverts that: a
 * maskable source is already safe-zoned, which is exactly what an adaptive foreground wants.
 * `favicon` is last everywhere — it's the 16–48px member of the set.
 */
const FAMILY_ORDER = {
  ios: ["apple", "generic", "android", "maskable", "ms", "favicon"],
  android: ["maskable", "android", "generic", "apple", "ms", "favicon"],
}

/**
 * The smallest source that still renders crisply for a platform's largest icon slot:
 * iOS has exactly one 1024px slot (the App Store icon), Android's biggest is the
 * xxxhdpi adaptive foreground at 432px. Below this the source gets upscaled and the dev
 * is told so — above it, adaptv is only ever downscaling and there is nothing to say.
 */
export const MIN_SOURCE_PX = { ios: 1024, android: 432 }

/**
 * Pick the best source for one platform out of a scanned icon set.
 *
 * Two passes, and the order matters: prefer the right ART over the most PIXELS, but only
 * among candidates that are already big enough. A 180px `apple-icon` is the "right" family
 * for iOS and still the wrong answer next to a 512px `android-chrome` — upscaling 5.7× is a
 * worse defect than borrowing the other platform's square. So family wins the tie only once
 * resolution is out of the way; if nothing clears the bar, the largest file wins outright.
 */
export function pickIcon(candidates, platform) {
  if (candidates.length === 0) return null
  const order = FAMILY_ORDER[platform]
  const rank = (c) => {
    const i = order.indexOf(c.family)
    return i === -1 ? order.length : i
  }
  const best = (pool) =>
    [...pool].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.width - a.width ||
        (a.name < b.name ? -1 : 1),
    )[0]

  const crisp = candidates.filter(
    (c) => c.width >= MIN_SOURCE_PX[platform],
  )
  if (crisp.length > 0) return best(crisp)
  return [...candidates].sort(
    (a, b) =>
      b.width - a.width || rank(a) - rank(b) || (a.name < b.name ? -1 : 1),
  )[0]
}

/**
 * The ONE thing the dev may need to act on about the chosen source, or null when adaptv
 * had a good icon to work with.
 *
 * Two deficiencies are worth a `!`, and neither fires for a set that is actually fine — a
 * warning that every project sees is noise, not information (R4/R5):
 *   - **too small** → adaptv upscales, and the launcher icon ships soft.
 *   - **opaque, Android** → an adaptive icon composites a transparent FOREGROUND over the
 *     brand colour and then masks the pair, so an opaque source becomes a square floating in
 *     the safe zone with its own background showing — a white box on a dark home screen.
 * A big transparent square mark — the lone `icon.png` case — trips neither, because it is
 * genuinely the best source adaptv can be given. iOS is not opacity-checked: App Store icons
 * must NOT be transparent, and `writeIosIcon` flattens onto the brand colour regardless.
 *
 * `transparent` is whether the source USES transparency, not whether it declares a channel —
 * see `resolveTransparency`. A `png` that carries a fully-opaque alpha channel is the normal
 * output of a favicon generator, and reading the header alone let exactly that source
 * through: it branded an adaptive foreground as a white box and said nothing.
 */
export function iconIssue(pick, platform) {
  const min = MIN_SOURCE_PX[platform]
  if (pick.width < min)
    return `${platform} launcher icon upscaled from ${pick.width}px — add a ${min}px icon`
  if (platform === "android" && !pick.transparent)
    return `android launcher icon is opaque — add one with a transparent background`
  return null
}

/* =============================================================================
 * reading the icon directory
 * ============================================================================= */

/**
 * Every usable icon in `dirAbs`, with its REAL pixel size read from the file header rather
 * than parsed out of the filename. Names lie (`android-chrome-192.png` resized by hand,
 * `logo.png` with no size in it at all) and the resolution warning is only worth printing if
 * it is measured. Unreadable or non-image files are skipped, never fatal.
 */
export function scanIcons(dirAbs) {
  if (!existsSync(dirAbs)) return []
  let names
  try {
    names = readdirSync(dirAbs)
  } catch {
    return []
  }
  const found = []
  for (const name of names.sort()) {
    if (!ICON_EXTS.has(path.extname(name).toLowerCase())) continue
    const file = path.join(dirAbs, name)
    let header
    try {
      // 4 KB covers a PNG's IHDR/tRNS, a WebP's VP8X/VP8L header, and a JPEG's SOF marker
      // past the usual EXIF block — without pulling whole megabyte icons into memory.
      const fd = readFileSync(file)
      header = readImageHeader(fd.subarray(0, 4096))
    } catch {
      continue
    }
    if (!header) continue
    found.push({ file, name, family: iconFamily(name), ...header })
  }
  return found
}

/**
 * `{ width, height, alpha }` from an image header, or null when the bytes aren't a PNG,
 * JPEG or WebP. Header-only: ranking a directory of icons must not cost a decode each.
 */
export function readImageHeader(buf) {
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

/* =============================================================================
 * writing the native launcher icons
 * ============================================================================= */

/** Android mipmap buckets: `[density, legacy icon px, adaptive foreground px]`. */
const ANDROID_DENSITIES = [
  ["mdpi", 48, 108],
  ["hdpi", 72, 162],
  ["xhdpi", 96, 216],
  ["xxhdpi", 144, 324],
  ["xxxhdpi", 192, 432],
]

// An adaptive icon's foreground is 108dp but only its centre 72dp is guaranteed to survive
// the launcher's mask, so a full-bleed mark loses its edges. Art that is ALREADY safe-zoned
// (a `maskable` source, drawn to that spec) must not be inset a second time or the logo ends
// up a speck; everything else gets scaled into the safe zone.
const SAFE_ZONE = 72 / 108

/** `#rgb` / `#rrggbb` → a sharp background. Anything unparseable falls back to white. */
export function parseHex(hex) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex ?? "").trim())
  if (!m) return { r: 255, g: 255, b: 255, alpha: 1 }
  const h =
    m[1].length === 3
      ? m[1]
          .split("")
          .map((c) => c + c)
          .join("")
      : m[1]
  return {
    r: Number.parseInt(h.slice(0, 2), 16),
    g: Number.parseInt(h.slice(2, 4), 16),
    b: Number.parseInt(h.slice(4, 6), 16),
    alpha: 1,
  }
}

const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 }

/**
 * Load sharp lazily. It is a native module, so a `dev web` run should never pay to load it,
 * and on the (rare) platform with no prebuilt binary the failure must surface as one icon
 * warning rather than taking the whole CLI down before it prints anything.
 */
async function loadSharp() {
  try {
    return (await import("sharp")).default
  } catch {
    return null
  }
}

/** The source mark, scaled to `size` and centred on `canvas` px of `background`. */
async function compose(sharp, src, { canvas, size, background }) {
  const mark = await sharp(src)
    .resize(size, size, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer()
  return sharp({
    create: { width: canvas, height: canvas, channels: 4, background },
  })
    .composite([{ input: mark, gravity: "center" }])
    .png()
}

/**
 * iOS: a single 1024px `AppIcon-512@2x.png` in the asset catalog Capacitor already
 * scaffolds — the `Contents.json` next to it declares exactly this one universal slot, so
 * there is nothing else to write. FLATTENED onto the brand colour on purpose: App Store
 * Connect rejects an icon with an alpha channel, and a transparent mark shipped as-is
 * renders black on the device.
 */
async function writeIosIcon(sharp, nativeRoot, pick, background) {
  const dest = path.join(
    nativeRoot,
    "App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  )
  mkdirSync(path.dirname(dest), { recursive: true })
  // Full bleed when the source is its own square (an opaque `android-chrome`/`apple-icon`
  // already carries its background); inset a transparent mark so it isn't corner-to-corner.
  const size = Math.round(1024 * (pick.transparent ? 0.82 : 1))
  await (
    await compose(sharp, pick.file, { canvas: 1024, size, background })
  )
    //`flatten` composites the transparency away but LEAVES the (now redundant) channel, and
    //App Store Connect rejects an icon that merely HAS one. `removeAlpha` is what actually
    //drops it — without this the upload is refused after the archive, not before it.
    .flatten({ background })
    .removeAlpha()
    .toFile(dest)
}

/**
 * Android: the legacy square + round mipmaps, the adaptive-icon foreground, and the colour
 * the adaptive background resolves to. The `mipmap-anydpi-v26/*.xml` that wire foreground to
 * background are part of Capacitor's template and already correct — adaptv only replaces the
 * art they point at, and the `values/ic_launcher_background.xml` colour they resolve.
 */
async function writeAndroidIcons(
  sharp,
  nativeRoot,
  pick,
  { light, dark },
) {
  const res = path.join(nativeRoot, "app/src/main/res")
  const background = parseHex(light)
  // A pre-safe-zoned source is already inset; a plain mark still has to be scaled into the
  // 72dp window. An opaque source stays full-bleed on the legacy square, where nothing masks
  // it — insetting there would frame the icon's own background inside a second one.
  const foregroundScale = pick.family === "maskable" ? 1 : SAFE_ZONE
  const legacyScale = pick.transparent ? 0.85 : 1

  for (const [density, legacyPx, foregroundPx] of ANDROID_DENSITIES) {
    const dir = path.join(res, `mipmap-${density}`)
    mkdirSync(dir, { recursive: true })

    // Adaptive foreground — transparent, so the launcher composites it over the background
    // colour and can mask the pair to whatever shape the device uses.
    await (
      await compose(sharp, pick.file, {
        canvas: foregroundPx,
        size: Math.round(foregroundPx * foregroundScale),
        background: TRANSPARENT,
      })
    ).toFile(path.join(dir, "ic_launcher_foreground.png"))

    const square = await (
      await compose(sharp, pick.file, {
        canvas: legacyPx,
        size: Math.round(legacyPx * legacyScale),
        background,
      })
    ).toBuffer()
    // The square mipmap is never masked, so it keeps no alpha channel; the buffer above
    // does, because the round variant below needs one to cut its circle out of.
    await sharp(square)
      .removeAlpha()
      .png()
      .toFile(path.join(dir, "ic_launcher.png"))

    // The round mipmap is the same art behind a circular alpha mask — pre-adaptive
    // launchers ask for it by name and get a square icon in a circle slot without it.
    const circle = Buffer.from(
      `<svg width="${legacyPx}" height="${legacyPx}"><circle cx="${legacyPx / 2}" cy="${legacyPx / 2}" r="${legacyPx / 2}" fill="#fff"/></svg>`,
    )
    await sharp(square)
      .composite([{ input: circle, blend: "dest-in" }])
      .png()
      .toFile(path.join(dir, "ic_launcher_round.png"))
  }

  writeColorRes(path.join(res, "values"), light)
  // `values-night` is resolved by the launcher the same way any other config-qualified
  // resource is, so a dark-mode home screen gets the dark brand colour behind the mark.
  writeColorRes(path.join(res, "values-night"), dark)
}

function writeColorRes(dir, hex) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    path.join(dir, "ic_launcher_background.xml"),
    `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">${hex}</color>
</resources>
`,
  )
}

/**
 * Whether the chosen source actually USES transparency — `{ ...pick, transparent }`.
 *
 * Decoding it is the whole point, and it is why this is separate from `scanIcons`. A header
 * can only say whether an alpha CHANNEL exists, and "RGBA, every pixel opaque" is the normal
 * output of a favicon generator: `android-chrome-512.png` declares alpha and is a solid white
 * square. Ranking on that was harmless, but branding on it was not — it made the adaptive
 * foreground a white box floating in the safe zone AND suppressed the warning that would have
 * said so. One decode, on one file, after the pick is made.
 *
 * Falls back to the header's answer if sharp can't stat the file: a wrong inset is a much
 * smaller failure than no icon at all.
 */
async function resolveTransparency(sharp, pick) {
  try {
    const { isOpaque } = await sharp(pick.file).stats()
    return { ...pick, transparent: !isOpaque }
  } catch {
    return { ...pick, transparent: pick.alpha }
  }
}

/**
 * Brand the launcher icon for one platform from the app's icon set.
 *
 * Returns `{ warning }` — a single `!` line, or null when the set was good. Nothing here is
 * fatal by design: a missing or unusable icon means the app ships Capacitor's stock art,
 * which is worth telling the dev about but is never a reason to fail their build.
 */
export async function brandLauncherIcon(
  nativeRoot,
  platform,
  { appRoot, iconsDir, background, backgroundDark, report },
) {
  const candidates = scanIcons(path.resolve(appRoot, iconsDir))
  if (candidates.length === 0)
    return {
      warning: `no icons in ${iconsDir} — add one to brand the launcher icon`,
    }

  const sharp = await loadSharp()
  //Named as the dev's problem, not the module's: `sharp` is adaptv's own dependency, so
  //"install sharp" would be advice about adaptv's plumbing (R11). All they can act on is
  //that the icon didn't get branded.
  if (!sharp)
    return {
      warning: `could not brand the launcher icon on this platform`,
    }

  const pick = await resolveTransparency(
    sharp,
    pickIcon(candidates, platform),
  )
  report?.("processing resources")
  if (platform === "ios")
    await writeIosIcon(sharp, nativeRoot, pick, parseHex(background))
  else
    await writeAndroidIcons(sharp, nativeRoot, pick, {
      light: background,
      dark: backgroundDark,
    })

  return { warning: iconIssue(pick, platform) }
}
