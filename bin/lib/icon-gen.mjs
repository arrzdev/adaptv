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
// The two maskable lineages are deliberately different files, and that is a platform
// requirement rather than a preference. The WEB maskable spec wants full-bleed art on a solid
// background. Android's adaptive icon is TWO LAYERS — a transparent foreground the launcher
// composites over `ic_launcher_background` and then masks together — so its foreground must
// carry alpha, or the background layer is invisible and none of what the format exists for
// can happen. One file cannot be both.
//
// Which is the real answer to "do some platforms require transparency?": yes, and they
// disagree. iOS is the opposite — App Store Connect rejects an icon that merely HAS an alpha
// channel. adaptv produces each output in the form its platform demands, from whatever source
// it is given; the requirement is on the FILES, never on the image the dev hands over.
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { hexOf, measureArtwork, monochromeMark } from "./artwork.mjs"
import { encodeIco } from "./ico.mjs"
import { fitScale, TRANSPARENT } from "./icon-geometry.mjs"

/** Sizes packed into `favicon.ico`. 48 is what Windows uses for a desktop shortcut. */
const ICO_SIZES = [16, 32, 48]

const BLACK = { r: 0, g: 0, b: 0, alpha: 1 }

/**
 * Every file `gen icons` writes, as `[name, px, treatment]`.
 *
 * `treatment` is the whole design in two letters — `<shape><alpha>`:
 *   - shape `circle` the slot is masked to a disc, so the mark is fitted by RADIUS inside the
 *            safe ring; `box` nothing crops it, so it is fitted by BOUNDING BOX inside the tile.
 *   - alpha `flat`  always composited onto the background and stripped of its alpha channel,
 *            for slots that must not carry one (App Store Connect rejects an iOS icon that
 *            merely HAS an alpha channel).
 *     alpha `layer` never composited — it is one LAYER of a two-layer icon, and painting the
 *            other layer onto it defeats the format. Exactly one slot: `icon-maskable.png`,
 *            Android's adaptive FOREGROUND.
 *     alpha `keep`  transparency is preserved when the source had none of its own to lose;
 *            a source that DID sit on a background keeps it, because these are standalone
 *            images and the icon is the background plus the mark.
 *     alpha `tint`  desaturated to greyscale and flattened onto BLACK — iOS's tinted
 *            appearance, where the system maps luminance onto the colour the user picked.
 *     alpha `mono`  white, with the mark's luminance encoded into the ALPHA channel — Android's
 *            themed-icon layer, which the launcher tints with `SRC_IN`. Like `layer` it is
 *            never composited onto anything. → {@link monochromeMark}
 *
 * EVERY slot is fitted, which is the fix for an iOS icon sitting flush against its own edges:
 * it used to take the source whole at scale 1, so a mark drawn to fill its frame filled the
 * tile. The margin is one number and it now applies everywhere — only the LIMIT it is measured
 * against changes (`LIMIT` in `icon-geometry.mjs`).
 */
export const ICON_SET = [
  //the native masters — biggest of their family, which is how `pickIcon` finds them
  ["icon.png", 1024, "box", "keep"],
  ["icon-maskable.png", 1024, "circle", "layer"],
  ["icon-monochrome.png", 1024, "circle", "mono"],
  //the web manifest
  ["android-chrome-192.png", 192, "box", "keep"],
  ["android-chrome-512.png", 512, "box", "keep"],
  ["android-maskable-192.png", 192, "circle", "flat"],
  ["android-maskable-512.png", 512, "circle", "flat"],
  //iOS 18 app-icon appearances — see `writeIosIcon`, which puts these in the asset catalog
  ["icon-dark.png", 1024, "box", "layer"],
  ["icon-tinted.png", 1024, "box", "tint"],
  //the head
  ["apple-touch-icon-180.png", 180, "box", "flat"],
  ["favicon-16x16.png", 16, "box", "keep"],
  ["favicon-32x32.png", 32, "box", "keep"],
  ["favicon-96x96.png", 96, "box", "keep"],
  ["favicon-512x512.png", 512, "box", "keep"],
]

/**
 * The colour the mark will actually sit on — `{r,g,b}`.
 *
 * One function because THREE things have to agree about it: the slots `generateIcons` flattens,
 * the `!` that tells the dev which colour was read, and the preview sheet's adaptive tiles.
 * They didn't. The sheet drew its tiles on the flag's value while the files were flattened onto
 * the measured one, so a green-backed logo previewed on white and shipped on green — the
 * preview disagreeing with the platforms about the one colour the run had just warned about.
 *
 * `chosen` is whether the dev NAMED the colour, and it is the whole precedence: a measurement
 * is adaptv guessing on their behalf, a flag is them answering, and the answer wins (R39).
 */
export function effectiveBackground(artwork, background, chosen = false) {
  if (chosen) return background
  return artwork?.background ?? background
}

/**
 * What a slot is drawn FROM, at what scale, on what background — `{ art, scale, background,
 * flatten }`.
 *
 * Every slot now goes through the same measurement. It used to be only the masked ones: the
 * unmasked slots took the source WHOLE at scale 1, on the theory that nothing crops them so the
 * dev's own composition is theirs to keep. That was right about cropping and wrong about the
 * result — a mark drawn to fill its frame produced an iOS icon flush against its own edges,
 * reported as *"fica completamente sem margem colado às margens"*. Nothing was cutting it; it
 * simply looked wrong, and adaptv had measured exactly what it needed to know to fix it.
 *
 * `artwork.mark` is null when the source has no isolable background (a photo, a gradient). Then
 * there is nothing to lift out and every slot takes the source whole — the old behaviour, and
 * the case `sourceWarnings` warns will be cropped.
 */
function slotPlan(
  [, , shape, alpha],
  artwork,
  source,
  background,
  margin,
  chosen = false,
) {
  // `layer` and `mono` are the slots that must stay clear whatever the source looked like —
  // both are ONE LAYER of a two-layer Android icon, and painting the other layer onto them
  // defeats the format. Everything else reproduces the icon as a STANDALONE image, so a mark
  // that was lifted off a background gets it back: the icon is the background plus the mark.
  const layered = alpha === "layer" || alpha === "mono"
  const flatten =
    alpha === "flat" ||
    alpha === "tint" ||
    (!layered && artwork.background !== null)
  const greyscale = alpha === "tint"
  const mono = alpha === "mono"
  //iOS composites the tinted variant itself, from luminance, over its own backdrop — so the
  //art has to sit on BLACK rather than on the app's brand colour.
  const onBlack = greyscale ? BLACK : null
  //Through `effectiveBackground` like the branch below, not the raw value. A source that is
  //ENTIRELY background reaches here with a colour measured and no mark to lift off it, and
  //using the flag's default instead would letterbox that source onto white while the preview
  //sheet — which asks the same function — drew the measured colour.
  if (!artwork.mark)
    return {
      art: source,
      scale: 1,
      background:
        onBlack ?? effectiveBackground(artwork, background, chosen),
      flatten,
      greyscale,
      mono,
    }

  return {
    art: artwork.mark,
    scale: fitScale(artwork, { shape, margin }),
    greyscale,
    mono,
    //Keep the colour the art was found on, so a logo exported as a flat-coloured tile stays
    //that colour instead of jumping to the config's brand background — UNLESS the dev named
    //one. `--background` used to lose to the measurement, which made it a no-op in the only
    //case anyone reaches for it: a source that HAS a background whose colour they want
    //changed. A measurement is adaptv's guess and the flag is the dev's answer, so the flag
    //wins; with no flag there is nothing to prefer and the measurement stands.
    background:
      onBlack ?? effectiveBackground(artwork, background, chosen),
    flatten,
  }
}

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
  { canvas, scale, background, flatten, greyscale, mono },
) {
  const inner = Math.max(1, Math.round(canvas * scale))
  let art = sharp(source, { density: 384 }).resize(inner, inner, {
    fit: "contain",
    background: TRANSPARENT,
  })
  // Desaturate the MARK, not the finished tile. sharp applies `greyscale()` to the image it is
  // called on and then composites overlays on top, so greyscaling the canvas afterwards left
  // the composited art in full colour — a "tinted" icon that iOS would map a colour onto a
  // picture that already had its own. The backdrop it lands on is black, which is grey already.
  if (greyscale) art = art.greyscale()
  let mark = await art.png().toBuffer()
  // After the resize, so the ramp is computed over the pixels that actually ship — and on the
  // MARK rather than the canvas, so the transparent surround never enters its range.
  if (mono) mark = await monochromeMark(sharp, mark)

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
 * `appearances` maps a slot name to a hand-authored file — `{ "icon-dark.png": "…" }`, from
 * `--dark` / `--tinted`. Those slots are then copied at full size rather than derived, because
 * the cases that need them are the ones adaptv cannot compute: a dark mark needs INVERTING for
 * iOS's dark appearance, and no amount of measuring turns black art into white art.
 *
 * `padding` is EXTRA room, on top of whatever a slot already needs — never instead of it. The
 * masked slots are sized from the measured art (`fitScale`) so they clear the mask with room
 * to spare; `--padding 10` makes those 10% tighter again, and insets the unmasked slots, which
 * have no fit of their own, by 10%. Defaulting to 0 is the point: nobody should have to pass a
 * number to stop their logo being cropped.
 */
export async function generateIcons({
  source,
  dirAbs,
  background,
  backgroundChosen = false,
  padding = 0,
  margin,
  artwork,
  appearances = {},
  sharp,
}) {
  const bg = { ...background, alpha: 1 }
  const inset = 1 - Math.min(Math.max(padding, 0), 40) / 100
  mkdirSync(dirAbs, { recursive: true })
  clearIcons(dirAbs, source)

  //Measured by the caller so the WARNINGS and the LAYOUT come from one reading of the pixels —
  //a `!` that says the mask will crop, next to a set where it doesn't, is worse than silence.
  const art = artwork ?? (await measureArtwork(sharp, source))

  const written = []
  for (const slot of ICON_SET) {
    const [name, px, , alpha] = slot
    // A hand-authored appearance variant is used WHOLE, at scale 1, with no measuring and no
    // re-fitting. The dev drew it for this exact 1024 tile — second-guessing their framing is
    // the one thing they were opting out of by passing the flag.
    const authored = appearances[name]
    const plan = authored
      ? {
          art: authored,
          scale: 1,
          background: alpha === "tint" ? BLACK : bg,
          flatten: alpha === "tint",
          greyscale: alpha === "tint",
          //An authored `--monochrome` is NOT re-ramped. The whole reason to reach for the flag
          //is that the derived alpha was wrong for this mark; deriving it again from the file
          //the dev drew to replace it would put the same decision back.
          mono: false,
        }
      : slotPlan(slot, art, source, bg, margin, backgroundChosen)
    const png = await render(sharp, plan.art, {
      canvas: px,
      scale: plan.scale * inset,
      background: plan.background,
      flatten: plan.flatten,
      greyscale: plan.greyscale,
      mono: plan.mono,
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
    return `${ext} isn't an image adaptv can read. Use a png or svg`
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
export function sourceWarnings(
  {
    width,
    height,
    isolable,
    luminance,
    hasDark,
    hasTinted,
    background,
    backgroundChosen,
  },
  ext,
) {
  const warnings = []
  //A vector has no meaningful pixel size — sharp rasterises it at whatever density each slot
  //asks for — so the SIZE checks below say nothing true about one.
  const vector = ext.toLowerCase() === ".svg"

  if (!vector && width && height && width !== height)
    warnings.push(
      `source is ${width}\u00d7${height}, and icons are square, so it will be letterboxed`,
    )

  const size = Math.min(width ?? 0, height ?? 0)
  if (!vector && size > 0 && size < MIN_SOURCE_PX)
    warnings.push(
      `source is ${size}px, so every icon is upscaled from it (${MIN_SOURCE_PX}px is ideal)`,
    )

  // The one that is genuinely hard to discover on your own — and the ONLY case adaptv can no
  // longer rescue.
  //
  // ⚠︎ A transparent background is NOT required, and asking for one would be adaptv demanding
  // something it does not need. What it needs is to know where the logo ENDS, and a flat colour
  // says that just as clearly as alpha does: the mark is lifted off it, re-centred, fitted, and
  // the colour is repainted around it. A logo exported flat on white — the normal output of
  // every favicon generator — goes down exactly the same path as a transparent PNG and comes
  // out identical. Requiring alpha would reject the most common working input there is.
  //
  // A photo, a gradient or a screenshot is the real failure: there is no "the logo" to move, so
  // the mask cuts whatever is at the edges. That is what this warns about, and it is the only
  // background shape the dev has to act on. It used to fire for ANY opaque source, which was
  // wrong the moment adaptv learned to detect a flat background: it warned about the case it
  // had just fixed.
  if (isolable === false)
    warnings.push(
      `source has no flat background, so the mask will crop its edges`,
    )

  // NOT a complaint about the source — a statement of the one measurement everything visible
  // downstream is derived from. This colour becomes the iOS tile, Android's
  // `ic_launcher_background` and the favicon backdrop, while the mark is lifted off it for the
  // slots that must stay clear (iOS dark, Android's adaptive foreground).
  //
  // It carries the `!` because it is ACTIONABLE (R5): adaptv read the colour off the border
  // ring, and a logo with a border, a drop shadow or a near-white-but-not-white canvas can be
  // read one shade off — which is invisible in the source and obvious on a home screen. The
  // fix is named, and naming it is what made `--background` have to outrank the measurement.
  // Deliberately silent for a transparent source: there is no colour that was chosen, and a
  // line every project sees is noise (R4). Silent too when the dev PASSED `--background` —
  // adaptv used their colour, not the measured one, so the whole notice is answering a
  // question they already answered.
  if (background && !backgroundChosen)
    warnings.push(
      `background ${hexOf(background)} lifted off the mark; --background overrides`,
    )

  // BOTH iOS 18 appearances need light art, and the first version of this warning only said
  // one of them. The dark icon is the mark on a near-black backdrop the system draws; the
  // tinted one is a luminance ramp, so dark pixels stay dark there too — a black wordmark
  // measured 0.005 mean luminance through the tint and was a black rectangle. adaptv can
  // derive both from a light or colourful logo, and neither from a dark one: turning black art
  // white is an INVERSION, a design decision rather than a transform.
  const missing = [!hasDark && "dark", !hasTinted && "tinted"].filter(
    Boolean,
  )
  if (
    missing.length > 0 &&
    isolable !== false &&
    Number.isFinite(luminance) &&
    luminance < DARK_ICON_FLOOR
  )
    warnings.push(
      `mark is dark — iOS ${missing.join(" + ")} ${
        missing.length > 1 ? "need" : "needs"
      } light art (${missing.map((m) => `--${m}`).join(", ")})`,
    )

  return warnings
}

/**
 * Below this mean luminance a mark cannot carry iOS's dark appearance on its own.
 *
 * Deliberately low. The question is not "is this the prettiest dark icon" — it is "would the
 * dev see nothing at all", and a warning that fires on every mid-tone logo is one devs learn to
 * ignore (R5). A mid grey still reads against near-black; a near-black mark does not.
 */
const DARK_ICON_FLOOR = 0.28

/** The size every slot can be produced from without upscaling — iOS's App Store icon. */
const MIN_SOURCE_PX = 1024
