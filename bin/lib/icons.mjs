// Launcher icons — ONE source set, the right art per platform.
//
// The app declares a single icon directory (`icons` in adaptv.config.ts, default
// `./public/favicons`) and adaptv reads it for BOTH the web manifest and the native launcher
// icons. There is deliberately no second `assets/logo.png` convention: a PWA icon set already
// ships platform-specific art, so the framework's job is to PICK the right member of that set
// for the build being produced — not to ask the dev to maintain another file that says the same
// thing. → DECISIONS.md L8 (one config source).
//
// **Reading** the directory is not here — it is `src/vite/icon-set.ts`, because the manifest and
// the head need exactly the same answer and used to compute their own (see that file's header).
// What stays here is everything that is native-only: ranking the set for a PLATFORM, the one
// sentence the dev may need to act on, and writing the iOS/Android art with sharp.
//
// adaptv writes the native icon files itself rather than shelling out to `@capacitor/assets`.
// That package is a 260-package tree pinned to an old `@capacitor/cli` whose `sharp` needs a
// native build step, and the surface it would generate for us is tiny and fully known: one
// 1024px PNG for iOS, fifteen mipmaps plus a colour resource for Android. adaptv already
// hand-writes the native splash + theme resources next door (`patchAndroidSplash`,
// `patchIosTheme`), so the launcher icon belongs in the same place. → DECISIONS.md L20.
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { monochromeMark } from "./artwork.mjs"
import { fitScale, TRANSPARENT } from "./icon-geometry.mjs"
import { ADAPTV_ROOT, loadAdaptvModule } from "./load-ts.mjs"

/* =============================================================================
 * the resolved set
 * ============================================================================= */

/** adaptv's own icon set, shipped in the package. → `DEFAULT_ICONS_URL_BASE` */
export const DEFAULT_ICONS_DIR = path.join(
  ADAPTV_ROOT,
  "assets/default-icons",
)

/** `src/vite/icon-set.ts`, bundled once per process. */
export const iconSetModule = () => loadAdaptvModule("vite/icon-set.ts")

/**
 * The icon set this app will be branded from — the dev's own art, or adaptv's mark when they
 * have none. The SAME function the manifest and the head resolve through, so a run can never
 * brand the launcher from one set and list another in `manifest.json`.
 */
export async function loadIconSet(appRoot, config) {
  const { resolveIconSet, scanIcons } = await iconSetModule()
  return resolveIconSet(appRoot, config, scanIcons(DEFAULT_ICONS_DIR))
}

/**
 * Family preference per SLOT, best first.
 *
 * iOS never masks an icon, so `maskable` art (a small mark floating in a 66dp safe zone)
 * ranks BELOW a full-bleed square — it would ship a tiny logo. Android's adaptive foreground
 * inverts that: a maskable source is already safe-zoned, which is exactly what it wants.
 * `favicon` is last everywhere — it's the 16–48px member of the set.
 *
 * `androidLegacy` is the pre-adaptive square/round mipmap, and it is a THIRD ranking rather
 * than a reuse of `android` because those two slots want opposite art. Nothing masks the
 * legacy square, so it wants the same full-bleed mark iOS does; feeding it the safe-zoned
 * maskable source insets art that is already inset — 0.85 × 72/108 — and the launcher shows a
 * mark at 57% of its icon, adrift in the brand colour. With one ranking for both, adaptv's own
 * generated set hit that every time, because it always ships a maskable master.
 */
const FAMILY_ORDER = {
  ios: ["apple", "generic", "android", "maskable", "ms", "favicon"],
  android: ["maskable", "android", "generic", "apple", "ms", "favicon"],
  androidLegacy: [
    "generic",
    "android",
    "apple",
    "maskable",
    "ms",
    "favicon",
  ],
}

/**
 * The smallest source that still renders crisply for a slot's largest size: iOS has exactly one
 * 1024px slot (the App Store icon), Android's biggest adaptive foreground is xxxhdpi at 432px,
 * and its biggest legacy mipmap is 192px. Below this the source gets upscaled and the dev is
 * told so — above it, adaptv is only ever downscaling and there is nothing to say.
 *
 * Only `ios` and `android` are WARNED about (`iconIssue`): the legacy square is derived from
 * the same directory and a separate `!` about it would be a second sentence for one fix.
 */
export const MIN_SOURCE_PX = {
  ios: 1024,
  android: 432,
  androidLegacy: 192,
}

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
  // The opacity warning is about art that will be INSET into the safe zone: an opaque block
  // scaled to 72/108 shows its own background as a square floating inside the mask. Art of the
  // `maskable` family is not inset — `writeAndroidIcons` gives it `foregroundScale = 1` because
  // it is already drawn to the spec — so an opaque one is full-bleed, the launcher masks it, and
  // there is nothing to report. Warning anyway is what `gen icons` output started tripping the
  // moment it learned to keep a detected background on the foreground it writes.
  if (
    platform === "android" &&
    !pick.transparent &&
    pick.family !== "maskable"
  )
    return `android launcher icon is opaque — add one with a transparent background`
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

/** A measured `{r,g,b}` back to the `#rrggbb` an Android colour resource needs. */
const hexOf = ({ r, g, b }) =>
  `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`

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

/** The iOS 18 appearance slots, as the asset catalog names and declares them. */
const IOS_APPEARANCES = [
  { file: "AppIcon-512@2x.png", family: null, value: null },
  { file: "AppIcon-Dark-512@2x.png", family: "dark", value: "dark" },
  {
    file: "AppIcon-Tinted-512@2x.png",
    family: "tinted",
    value: "tinted",
  },
]

/**
 * iOS: the app icon and its two iOS 18 APPEARANCES, plus the `Contents.json` that declares them.
 *
 * The catalog used to hold one universal slot, which is what Xcode scaffolds and what adaptv
 * left alone. That is the state every app is in until someone does this work, and it is why so
 * many App Store apps still show their light icon unchanged on a dark home screen: with no
 * variant supplied, iOS has nothing to switch to. Apps that DO change — the ones this was
 * reported against — ship authored variants, and this is that.
 *
 *   light    flattened onto the brand colour and stripped of its alpha channel. App Store
 *            Connect rejects an icon that merely HAS the channel, days after the archive.
 *   dark     the mark with NO background: the system draws its own near-black backdrop under
 *            it. The opposite requirement to the light slot, from the same vendor.
 *   tinted   greyscale on black. iOS reads the luminance and maps the user's chosen colour
 *            onto it, so this one is a ramp rather than a picture.
 *
 * Each is written only if the resolved set actually has that art (`gen icons` produces
 * `icon-dark.png` / `icon-tinted.png`; a hand-dropped favicon set will not have them), and the
 * `Contents.json` declares exactly the files that got written — a catalog naming a file that
 * is not there fails the build.
 */
async function writeIosIcon(sharp, nativeRoot, pick, background, set) {
  const dir = path.join(
    nativeRoot,
    "App/App/Assets.xcassets/AppIcon.appiconset",
  )
  mkdirSync(dir, { recursive: true })

  const images = []
  for (const slot of IOS_APPEARANCES) {
    // The light slot is the ranked pick — whatever the app's best art is. The appearance slots
    // are matched by FAMILY, never by rank: they are not "a better icon", they are a different
    // one, and `pickIcon` must never return them for a normal build.
    const art = slot.family
      ? set?.icons?.find((i) => i.family === slot.family)
      : pick
    if (!art) continue

    // MEASURED, not guessed. The light slot was `pick.transparent ? 0.82 : 1` — full bleed for
    // anything opaque, on the theory that an opaque source carries its own background and
    // insetting would frame one background inside another. True of a finished tile, and false
    // of the far more common case: a logo exported flat on white. Those went edge to edge,
    // reported as *"o icon para iOS fica completamente sem margem colado às margens"*.
    //
    // The appearance variants are already composed for their slot — `gen icons` fitted them, or
    // the dev authored them — so they go in whole.
    const size = Math.round(1024 * (slot.family ? 1 : pick.fit))
    let out = await compose(sharp, art.file, {
      canvas: 1024,
      size,
      background: slot.family === "dark" ? TRANSPARENT : background,
    })
    //Only the light slot must lose its alpha. The dark one MUST keep it (the system composites
    //it), and the tinted one is already opaque on black.
    if (!slot.family) out = out.flatten({ background }).removeAlpha()
    await out.toFile(path.join(dir, slot.file))

    images.push({
      ...(slot.value
        ? {
            appearances: [{ appearance: "luminosity", value: slot.value }],
          }
        : {}),
      filename: slot.file,
      idiom: "universal",
      platform: "ios",
      size: "1024x1024",
    })
  }

  writeFileSync(
    path.join(dir, "Contents.json"),
    `${JSON.stringify(
      { images, info: { author: "adaptv", version: 1 } },
      null,
      2,
    )}\n`,
  )
}

/**
 * Android: the legacy square + round mipmaps, the adaptive-icon foreground and monochrome
 * layers, the `mipmap-anydpi-v26/*.xml` that wire them together, and the colour the adaptive
 * background resolves to.
 *
 * The XMLs used to be left alone as "part of Capacitor's template and already correct". They
 * are correct for the two layers they declare and silently incomplete about the third:
 * Capacitor's template has no `<monochrome>`, so on Android 13+ the app simply opted out of
 * themed icons and sat in full colour on a home screen where everything else had taken the
 * wallpaper's palette. Same symptom as an iOS icon with no dark variant, same fix.
 *
 * TWO sources, because the two slots want opposite art: `pick` is the adaptive foreground
 * (safe-zoned, transparent, masked by the launcher) and `legacy` is the pre-adaptive square,
 * which nothing masks and which therefore wants the same full-bleed mark iOS gets. They are
 * often the same file — a set with only `icon.png` has one answer for both — and when they
 * differ it is exactly the case that used to ship a 57%-scale logo adrift in the brand colour.
 */
async function writeAndroidIcons(
  sharp,
  nativeRoot,
  pick,
  legacy,
  { light, dark, set },
) {
  const res = path.join(nativeRoot, "app/src/main/res")
  const background = parseHex(light)

  // `ic_launcher_background` is the layer the transparent foreground is composited over, and it
  // should be the colour the MARK WAS DRAWN ON whenever adaptv can see one. Otherwise a logo
  // exported flat on white becomes a white mark on the config's brand colour, or — the case
  // that first showed this up — a white mark on a white resource, i.e. nothing at all.
  //
  // The same colour on both appearances, deliberately: it is what the art was composed
  // against, and adaptv has no dark-mode variant of the mark to justify swapping it.
  // Read from the LEGACY pick, not the foreground one. The foreground is a layer and carries no
  // background by construction — that is the whole point of it — so the colour has to come from
  // a member of the set that is a standalone image. For a generated set that is `icon.png`; for
  // a raw favicon set it is whatever full square `androidLegacy` chose.
  const source = legacy.artBackground ?? pick.artBackground
  const adaptive = source ? hexOf(source) : null
  // Art of the `maskable` family is DRAWN to the adaptive spec, so it is already safe-zoned and
  // must not be inset a second time; anything else is measured into the ring like every other
  // circle-masked slot. The legacy square is never masked, so it takes the box fit.
  const foregroundScale = pick.family === "maskable" ? 1 : pick.fitCircle
  const legacyScale = legacy.family === "maskable" ? 1 : legacy.fit

  // The themed layer, matched by FAMILY and never by rank — like the iOS appearance slots, it
  // is not "a better icon" but a different one. `gen icons` writes `icon-monochrome.png` (and
  // `--monochrome` replaces it); a hand-dropped favicon set has nothing of the sort, so the
  // layer is DERIVED from the foreground instead. Deriving is the important half: an app that
  // never ran `gen icons` is exactly the one that would otherwise ship no themed icon at all.
  const authoredMono = set?.icons?.find((i) => i.family === "monochrome")
  const monoScale = authoredMono ? 1 : foregroundScale

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

    // Themed icon. An AUTHORED layer goes in whole — the dev drew the alpha they want and the
    // launcher's `SRC_IN` tint will use it verbatim. A derived one is ramped from the
    // foreground's luminance AFTER composition, so the transparent surround stays out of the
    // range the ramp is normalised against.
    const mono = await (
      await compose(sharp, authoredMono?.file ?? pick.file, {
        canvas: foregroundPx,
        size: Math.round(foregroundPx * monoScale),
        background: TRANSPARENT,
      })
    ).toBuffer()
    writeFileSync(
      path.join(dir, "ic_launcher_monochrome.png"),
      authoredMono ? mono : await monochromeMark(sharp, mono),
    )

    const square = await (
      await compose(sharp, legacy.file, {
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

  writeAdaptiveRes(path.join(res, "mipmap-anydpi-v26"))
  writeColorRes(path.join(res, "values"), adaptive ?? light)
  // `values-night` is resolved by the launcher the same way any other config-qualified
  // resource is, so a dark-mode home screen gets the dark brand colour behind the mark.
  writeColorRes(path.join(res, "values-night"), adaptive ?? dark)
}

/**
 * The two `mipmap-anydpi-v26` descriptors, THREE layers each.
 *
 * `ic_launcher_round.xml` gets the identical document rather than something round: an
 * adaptive icon is already shape-agnostic — the launcher owns the mask — and the round entry
 * exists only so a launcher that asks for `@mipmap/ic_launcher_round` by name on API 26+
 * doesn't fall through to the pre-adaptive bitmap.
 */
function writeAdaptiveRes(dir) {
  mkdirSync(dir, { recursive: true })
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>
</adaptive-icon>
`
  for (const name of ["ic_launcher.xml", "ic_launcher_round.xml"])
    writeFileSync(path.join(dir, name), xml)
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
  let transparent = pick.alpha
  try {
    const { isOpaque } = await sharp(pick.file).stats()
    transparent = !isOpaque
  } catch {}

  // Where the art actually sits inside this file, and therefore how much of each native slot it
  // may fill. The native brander used to guess with two constants — `0.82` for a transparent
  // iOS pick, `0.85` for a transparent legacy square, full bleed otherwise — and the guess was
  // wrong in the most common direction: a logo exported flat on white is opaque, so it went edge
  // to edge on iOS. `measureArtwork` already knows better; `gen icons` was simply the only
  // caller using it. Falls back to the old constants only if the measurement fails.
  //Full bleed is the fallback for BOTH failure modes, and it is the same answer `slotPlan`
  //gives: a source with no isolable mark (a photo, a gradient) is a finished picture, so the
  //mask crops it rather than adaptv shrinking a picture it does not understand.
  let fit = 1
  let fitCircle = 1
  let artBackground = null
  try {
    const { measureArtwork } = await import("./artwork.mjs")
    const art = await measureArtwork(sharp, pick.file)
    if (art.mark) {
      //`whole: true` — these scale the FILE ON DISK, not a crop. See `fitScale`.
      fit = fitScale(art, { shape: "box", whole: true })
      fitCircle = fitScale(art, { shape: "circle", whole: true })
      artBackground = art.background
    }
  } catch {}

  return { ...pick, transparent, fit, fitCircle, artBackground }
}

/**
 * The source adaptv will brand this platform's launcher icon from, and the ONE thing the dev
 * may need to act on about it — `{ sharp, pick, warning }`, with a null `pick` when there is
 * nothing to brand from.
 *
 * Takes an already-resolved {@link loadIconSet} rather than a directory, so the answer is
 * available before the native project exists: `preflight` states the warning under the banner,
 * before the run touches anything, and `brandLauncherIcon` acts on the same answer later (R33).
 * Both go through here so the sentence the dev reads and the file adaptv writes can never
 * disagree.
 *
 * The warning is only ever about THE ART FOR THIS PLATFORM — a source too small for iOS's
 * 1024px slot, an opaque one where Android's foreground needs transparency. That the app has no
 * art of its own at all is an app-level fact and belongs to `iconWarnings`, once (R21): it is
 * equally true of a `dev web` run with no platforms in it, which never calls this at all.
 */
export async function resolveLauncherSource(set, platform) {
  if (set.icons.length === 0) return { pick: null, warning: null }

  const sharp = await loadSharp()
  //Named as the dev's problem, not the module's: `sharp` is adaptv's own dependency, so
  //"install sharp" would be advice about adaptv's plumbing (R11). All they can act on is
  //that the icon didn't get branded.
  if (!sharp)
    return {
      pick: null,
      warning: `could not brand the launcher icon on this platform`,
    }

  const pick = await resolveTransparency(
    sharp,
    pickIcon(set.icons, platform),
  )
  //adaptv's own mark is by construction a good source, so there is nothing to say about it.
  return {
    sharp,
    pick,
    warning: set.source === "default" ? null : iconIssue(pick, platform),
  }
}

/**
 * Brand the launcher icon for one platform from the app's icon set.
 *
 * Returns `{ warning }` — a single `!` line, or null when the set was good. Nothing here is
 * fatal by design: a missing or unusable icon means the app ships Capacitor's stock art,
 * which is worth telling the dev about but is never a reason to fail their build. The caller
 * has normally already PRINTED that warning at preflight; it is returned rather than dropped
 * so this stays the whole answer for anyone branding without one.
 */
export async function brandLauncherIcon(
  nativeRoot,
  platform,
  { set, background, backgroundDark, report, source },
) {
  const { sharp, pick, warning } =
    source ?? (await resolveLauncherSource(set, platform))
  if (!pick) return { warning }

  report?.("processing resources")
  if (platform === "ios")
    await writeIosIcon(sharp, nativeRoot, pick, parseHex(background), set)
  else {
    //The legacy square wants full-bleed art, which is usually a DIFFERENT member of the set
    //from the safe-zoned adaptive foreground. Decoded the same way as the foreground pick,
    //because `legacyScale` turns on whether the art actually uses transparency.
    const legacy = await resolveTransparency(
      sharp,
      pickIcon(set.icons, "androidLegacy"),
    )
    await writeAndroidIcons(sharp, nativeRoot, pick, legacy, {
      light: background,
      dark: backgroundDark,
      set,
    })
  }

  return { warning }
}
