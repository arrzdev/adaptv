// `adaptv gen icons` — one image in, the whole icon set out.
//
// Until this existed, adaptv could pick the best member of an icon set but had no way to
// PRODUCE one: the dev went and found a favicon generator on the web, and adaptv then quietly
// depended on that generator's filename conventions. So the set below is not "what some
// generator emits" — it is exactly what adaptv's own three consumers ask for, which is why
// `src/vite/icon-set.ts` can read it back without guessing:
//
//   native   `icon.png` is the biggest `generic` file, so `pickIcon` takes it for iOS;
//            `icon-maskable.png` is the biggest `maskable` one, so Android's adaptive
//            foreground takes that. Neither needs a filename convention to be inferred.
//   manifest the `android-*` pairs, `any` and `maskable`, at the two sizes that matter.
//   head     the favicons, the `.ico`, and one Apple touch icon.
//
// The two maskable lineages are deliberately different files. The WEB maskable spec wants
// full-bleed art on a solid background; Android's adaptive FOREGROUND must be transparent so
// the launcher can composite it over `ic_launcher_background` and mask the pair. One file
// cannot be both — sharing it is what would make `iconIssue` report the launcher icon as
// opaque, correctly.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { measureArtwork } from "./artwork.mjs"
import { encodeIco } from "./ico.mjs"
import { artTarget, safeScale, TRANSPARENT } from "./icon-geometry.mjs"

/* =============================================================================
 * geometry
 * ============================================================================= */

/** Sizes packed into `favicon.ico`. 48 is what Windows uses for a desktop shortcut. */
const ICO_SIZES = [16, 32, 48]

/**
 * Every file `gen icons` writes, as `[name, px, treatment]`.
 *
 * `treatment` is the whole design in one column:
 *   - `bleed`  the mark fills its square, transparency preserved.
 *   - `safe`   the mark is inset into the 72/108 safe zone, transparency preserved.
 *   - `flat`   like `bleed`, then flattened onto the brand colour and stripped of its alpha
 *              channel — for slots the OS will never mask and must not receive transparency.
 *   - `masked` like `safe`, then flattened. The web maskable icon: art edge-to-edge on a
 *              solid background, with the logo inside the safe zone.
 */
export const ICON_SET = [
  //the native masters — biggest of their family, which is how `pickIcon` finds them
  ["icon.png", 1024, "bleed"],
  ["icon-maskable.png", 1024, "safe"],
  //the web manifest
  ["android-chrome-192.png", 192, "bleed"],
  ["android-chrome-512.png", 512, "bleed"],
  ["android-maskable-192.png", 192, "masked"],
  ["android-maskable-512.png", 512, "masked"],
  //the head
  ["apple-touch-icon-180.png", 180, "flat"],
  ["favicon-16x16.png", 16, "bleed"],
  ["favicon-32x32.png", 32, "bleed"],
  ["favicon-96x96.png", 96, "bleed"],
  ["favicon-512x512.png", 512, "bleed"],
]

/** Whether a slot is masked by the OS and therefore has to respect the safe ring. */
const isMasked = (treatment) =>
  treatment === "safe" || treatment === "masked"

/**
 * What a slot is drawn FROM and at what scale — `{ art, scale, background }`.
 *
 * The two kinds of slot want opposite things and used to be handled by one number:
 *
 *  - **Unmasked** (`bleed`, `flat`: iOS, the favicons, the manifest's `any` icons) take the
 *    source WHOLE, untouched. Nothing crops them, so the dev's own composition — margins,
 *    off-centre placement, a full-bleed background — is theirs to keep.
 *  - **Masked** (`safe`, `masked`: Android's adaptive foreground, the web maskable pair) take
 *    the measured MARK, scaled so its furthest pixel lands on the safe ring, on the background
 *    it was found sitting on. This is the fix for a mask cutting a logo's ears off: the art is
 *    isolated, re-centred and zoomed out until it fits the circle, instead of being inset by a
 *    fixed 0.667 that only ever suited a perfectly round logo.
 *
 * `artwork.mark` is null when the source has no isolable background (a photo, a gradient). Then
 * there is nothing to re-lay-out and every slot takes the source whole — the old behaviour, and
 * the case `sourceWarnings` warns will be cropped.
 */
function slotPlan(treatment, artwork, source, background, target) {
  //`flat`/`masked` must never carry alpha; `bleed`/`safe` normally keep it.
  const opaqueSlot = treatment === "flat" || treatment === "masked"
  if (!isMasked(treatment) || !artwork.mark)
    return { art: source, scale: 1, background, flatten: opaqueSlot }

  return {
    art: artwork.mark,
    scale: safeScale(artwork.radius, target),
    //Keep the colour the art was found on, so a logo exported as a flat-coloured tile stays
    //that colour instead of jumping to the config's brand background.
    background: artwork.background ?? background,
    // `safe` is Android's adaptive FOREGROUND, normally transparent so the launcher can
    // composite it over `ic_launcher_background`. But once the mark has been lifted off a
    // detected background, that colour is the icon's brand and lives nowhere else — leaving
    // the foreground transparent hands the launcher a white chevron to draw on a white
    // resource, and the icon vanishes. A source that HAD a background keeps it.
    flatten: opaqueSlot || artwork.background !== null,
  }
}

/* =============================================================================
 * rendering
 * ============================================================================= */

/**
 * Render one slot: the source scaled to fit, centred on `canvas` px of `background`.
 *
 * `fit: "contain"` rather than `"cover"`: a logo is not a photograph, and cropping the top off
 * a wordmark to fill a square is never the right answer. A non-square source gets letterboxed
 * into the transparent (or brand-coloured) surround, which is what the dev can see and fix.
 */
async function render(
  sharp,
  source,
  { canvas, scale, background, flatten },
) {
  const inner = Math.max(1, Math.round(canvas * scale))
  const mark = await sharp(source, { density: 384 })
    .resize(inner, inner, { fit: "contain", background: TRANSPARENT })
    .png()
    .toBuffer()

  let out = sharp({
    create: {
      width: canvas,
      height: canvas,
      channels: 4,
      background: flatten ? background : TRANSPARENT,
    },
  }).composite([{ input: mark, gravity: "center" }])

  // `flatten` composites the transparency away but LEAVES the (now redundant) channel, and a
  // slot that must not carry alpha is checked for HAVING one, not for using it — App Store
  // Connect rejects the upload after the archive, not before it. `removeAlpha` is the fix.
  if (flatten) out = out.flatten({ background }).removeAlpha()
  return out.png().toBuffer()
}

/**
 * Generate the whole set into `dirAbs`.
 *
 * Returns the names written, in the order they were produced — the caller reports a count and
 * the directory, never the list (R4: the dev asked for an icon set, not an inventory).
 *
 * `padding` is EXTRA room, on top of whatever a slot already needs — never instead of it. The
 * masked slots are sized from the measured art (`safeScale`) so they clear the mask with room
 * to spare; `--padding 10` makes those 10% tighter again, and insets the unmasked slots, which
 * have no fit of their own, by 10%. Defaulting to 0 is the point: nobody should have to pass a
 * number to stop their logo being cropped.
 */
export async function generateIcons({
  source,
  dirAbs,
  background,
  padding = 0,
  margin,
  artwork,
  sharp,
}) {
  const bg = { ...background, alpha: 1 }
  const inset = 1 - Math.min(Math.max(padding, 0), 40) / 100
  mkdirSync(dirAbs, { recursive: true })
  clearIcons(dirAbs, source)

  //Measured by the caller so the WARNINGS and the LAYOUT come from one reading of the pixels —
  //a `!` that says the mask will crop, next to a set where it doesn't, is worse than silence.
  const art = artwork ?? (await measureArtwork(sharp, source))
  const target = artTarget(margin)

  const written = []
  for (const [name, px, treatment] of ICON_SET) {
    const plan = slotPlan(treatment, art, source, bg, target)
    const png = await render(sharp, plan.art, {
      canvas: px,
      scale: plan.scale * inset,
      background: plan.background,
      flatten: plan.flatten,
    })
    writeFileSync(path.join(dirAbs, name), png)
    written.push(name)
  }

  // `favicon.ico` — flattened, because an .ico's transparency support is the one thing about
  // the format that is genuinely inconsistent across the browsers still asking for it.
  const ico = encodeIco(
    await Promise.all(
      ICO_SIZES.map(async (size) => ({
        size,
        png: await render(sharp, source, {
          canvas: size,
          scale: inset,
          background: bg,
          flatten: true,
        }),
      })),
    ),
  )
  writeFileSync(path.join(dirAbs, "favicon.ico"), ico)
  written.push("favicon.ico")

  // A vector source is copied through verbatim, NOT rasterised into `icon.svg`. It is the best
  // tab icon there is — resolution-independent, a few hundred bytes — and adaptv has no more
  // faithful version of it than the file the dev handed over.
  if (path.extname(source).toLowerCase() === ".svg") {
    writeFileSync(path.join(dirAbs, "icon.svg"), readFileSync(source))
    written.push("icon.svg")
  }

  return written
}

/* =============================================================================
 * clearing what was there
 * ============================================================================= */

/** Everything `existingIcons` counts and `clearIcons` removes. */
const REPLACEABLE = new Set([
  ".png",
  ".webp",
  ".jpg",
  ".jpeg",
  ".ico",
  ".svg",
])

/**
 * Icons already in `dirAbs` — what the dev is being asked to give up, and the count the
 * confirm prompt quotes. Broader than `scanIcons`, which only reports art it can RANK: a
 * `favicon.ico` and a `pinned-tab.svg` are both about to be replaced, so both are counted.
 */
export function existingIcons(dirAbs) {
  try {
    return readdirSync(dirAbs).filter((n) =>
      REPLACEABLE.has(path.extname(n).toLowerCase()),
    )
  } catch {
    return []
  }
}

/**
 * Empty the icon directory of icons before writing the new set.
 *
 * Without this, "replace them" was a promise the command didn't keep. `generateIcons` writes
 * thirteen FIXED names, and a favicon-generator set has twenty-seven — so the directory came
 * out a mix of thirteen fresh files and fourteen stale ones, which the manifest and the head
 * then went on to read as one set. The stale `apple-icon-57x57.png` doesn't just linger; it
 * gets linked.
 *
 * Only image files, and never the source itself — a dev pointing `gen icons` at a `logo.png`
 * that happens to live in their icon directory must not have it deleted mid-read.
 */
function clearIcons(dirAbs, source) {
  const keep = path.resolve(source)
  for (const name of existingIcons(dirAbs)) {
    const file = path.join(dirAbs, name)
    if (path.resolve(file) === keep) continue
    try {
      rmSync(file)
    } catch {}
  }
}

/* =============================================================================
 * reading the source
 * ============================================================================= */

/** Formats sharp can decode AND that make sense as a logo master. */
const SOURCE_EXTS = new Set([
  ".png",
  ".svg",
  ".webp",
  ".jpg",
  ".jpeg",
  ".avif",
  ".tiff",
  ".gif",
])

/**
 * The one thing that STOPS the command: bytes adaptv cannot decode at all. Everything else the
 * dev might want to reconsider is a warning — see {@link sourceWarnings}.
 */
export function sourceError(ext) {
  if (!SOURCE_EXTS.has(ext.toLowerCase()))
    return `${ext} isn't an image adaptv can read — use a png or svg`
  return null
}

/**
 * What the dev may want to fix about the image they pointed at — `!` lines, never a refusal.
 *
 * These used to be a single `✖` that refused to generate from anything under 1024px, on the
 * theory that a generator run is deliberate and should be held to a standard. That was adaptv
 * substituting its judgement for the dev's: a 512px source is a real answer for someone
 * prototyping, or someone whose logo genuinely only exists at that size, and blocking them
 * teaches nothing except that the tool is in the way. The generator's job is to say what will
 * be worse and let them decide — the same contract every other adaptv command has (R5/R7b),
 * and the same reason the build warns rather than fails on a small icon.
 *
 * Each line names what is wrong with THEIR file and what it costs, never what adaptv wanted.
 * A good source — a big square transparent mark — trips none of them.
 */
export function sourceWarnings({ width, height, isolable }, ext) {
  const warnings = []
  //A vector has no meaningful pixel size — sharp rasterises it at whatever density each slot
  //asks for — so the SIZE checks below say nothing true about one.
  const vector = ext.toLowerCase() === ".svg"

  if (!vector && width && height && width !== height)
    warnings.push(
      `source is ${width}\u00d7${height} — icons are square, so it will be letterboxed`,
    )

  const size = Math.min(width ?? 0, height ?? 0)
  if (!vector && size > 0 && size < MIN_SOURCE_PX)
    warnings.push(
      `source is ${size}px — every icon is upscaled from it (${MIN_SOURCE_PX}px is ideal)`,
    )

  // The one that is genuinely hard to discover on your own — and the ONLY case adaptv can no
  // longer rescue. When the border is transparent, or a single flat colour, the mark is
  // isolated and zoomed out until it clears the mask (`measureArtwork`). When it is a photo, a
  // gradient or a screenshot, there is no "the logo" to move and the mask cuts whatever is at
  // the edges. This used to fire for ANY opaque source, which was wrong the moment adaptv
  // learned to detect a flat background: it warned about the case it had just fixed.
  if (isolable === false)
    warnings.push(
      `source has no flat background — the mask will crop its edges`,
    )

  return warnings
}

/** The size every slot can be produced from without upscaling — iOS's App Store icon. */
const MIN_SOURCE_PX = 1024
