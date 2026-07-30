import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { readImageHeader, scanIcons } from "#adaptv/vite/icon-set"
import { decodeIco, encodeIco } from "./ico.mjs"
import {
  effectiveBackground,
  existingIcons,
  generateIcons,
  ICON_SET,
  sourceError,
  sourceWarnings,
} from "./icon-gen.mjs"
import { artTarget } from "./icon-geometry.mjs"
import { pickIcon } from "./icons.mjs"

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

// A rendered width is the end of a crop and two resizes, so it lands a pixel or two either
// side of the arithmetic. The property under test is always "fitted to the ring", never an
// exact byte count — `toBeCloseTo`'s log scale says that far less clearly than a tolerance.
expect.extend({
  toBeWithin(actual, expected, tolerance) {
    const pass = Math.abs(actual - expected) <= tolerance
    return {
      pass,
      message: () =>
        `expected ${actual} to be within ${tolerance} of ${expected}`,
    }
  },
})

/** A transparent square with an opaque disc in the middle — a mark with real edges to lose. */
async function markPng(sharp, size = 1024) {
  const disc = Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#e0483c"/></svg>`,
  )
  return sharp(disc).png().toBuffer()
}

/** Generate the whole set from a temp source and return `{ dir, names, sharp }`. */
async function generated({ padding = 0, svg = false } = {}) {
  const { default: sharp } = await import("sharp")
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-gen-"))
  const source = path.join(dir, svg ? "src.svg" : "src.png")
  if (svg)
    writeFileSync(
      source,
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><circle cx="256" cy="256" r="256" fill="#e0483c"/></svg>`,
    )
  else writeFileSync(source, await markPng(sharp))
  const out = path.join(dir, "icons")
  const names = await generateIcons({
    source,
    dirAbs: out,
    background: WHITE,
    padding,
    sharp,
  })
  return { dir: out, names, sharp, source }
}

describe("encodeIco — the one format sharp can't write", () => {
  it("round-trips every image at its declared size and offset", () => {
    const images = [16, 32, 48].map((size) => ({
      size,
      png: Buffer.from(`png-payload-${size}`),
    }))
    const decoded = decodeIco(encodeIco(images))
    expect(decoded.map((i) => i.size)).toEqual([16, 32, 48])
    for (const [i, image] of decoded.entries())
      expect(image.png.toString()).toBe(images[i].png.toString())
  })

  it("writes sizes smallest-first whatever order it was handed", () => {
    const decoded = decodeIco(
      encodeIco(
        [48, 16, 32].map((size) => ({ size, png: Buffer.from("x") })),
      ),
    )
    expect(decoded.map((i) => i.size)).toEqual([16, 32, 48])
  })

  it("encodes 256 as the 0 the single-byte field requires", () => {
    const buf = encodeIco([{ size: 256, png: Buffer.from("x") }])
    expect(buf[6]).toBe(0) //the width byte of the first directory entry
    expect(decodeIco(buf)[0].size).toBe(256)
  })

  it("refuses a size the format cannot represent at all", () => {
    expect(() =>
      encodeIco([{ size: 512, png: Buffer.from("x") }]),
    ).toThrow(/too large/)
  })
})

describe("reading the source — warn, never refuse", () => {
  const warn = (meta, ext = ".png") =>
    sourceWarnings({ isolable: true, ...meta }, ext)

  it("says nothing about a big square transparent mark", () => {
    //The bar every warning has to clear: a good source trips none of them, or the `!` stops
    //meaning anything (R5).
    expect(warn({ width: 1024, height: 1024, opaque: false })).toEqual([])
    expect(sourceWarnings({}, ".svg")).toEqual([])
  })

  it("WARNS about a small source rather than refusing to generate from it", () => {
    //This was an `✖` that blocked the run. Refusing is adaptv substituting its judgement for
    //the dev's — a 512px source is a real answer for someone prototyping.
    const [w] = warn({ width: 512, height: 512, opaque: false })
    expect(w).toBe(
      "source is 512px, so every icon is upscaled from it (1024px is ideal)",
    )
  })

  it("says nothing about an opaque source whose background adaptv can isolate", () => {
    //This used to warn for ANY opaque source, which became wrong the moment adaptv learned to
    //detect a flat background: it warned about the case it had just fixed. A logo on white is
    //isolated, re-centred and zoomed out until it clears the mask — nothing to report.
    expect(warn({ width: 1024, height: 1024, isolable: true })).toEqual([])
  })

  it("warns only when the background cannot be isolated at all", () => {
    //A gradient, a photo, a screenshot: there is no "the logo" to move, so the mask cuts
    //whatever is at the edges and only the dev can fix it.
    expect(warn({ width: 1024, height: 1024, isolable: false })).toEqual([
      "source has no flat background, so the mask will crop its edges",
    ])
  })

  it("measures the SHORT edge and says so when the source isn't square", () => {
    const warnings = warn({ width: 2048, height: 300, opaque: false })
    expect(warnings[0]).toContain("2048×300")
    expect(warnings[1]).toContain("300px")
  })

  it("skips the SIZE checks for a vector but still checks its background", () => {
    //A vector has no meaningful pixel size — sharp rasterises it at whatever density each
    //slot asks for. Whether its background can be isolated is real, though: an SVG with a
    //full-bleed gradient behind the mark is exactly as croppable as a flattened PNG.
    expect(
      sourceWarnings({ width: 16, height: 300, isolable: true }, ".svg"),
    ).toEqual([])
    expect(
      sourceWarnings({ width: 16, height: 16, isolable: false }, ".svg"),
    ).toEqual([
      "source has no flat background, so the mask will crop its edges",
    ])
  })

  it("keeps every warning inside a narrow terminal", () => {
    for (const w of warn({ width: 2048, height: 300, opaque: true }))
      expect(w.length).toBeLessThanOrEqual(72)
  })

  it("refuses ONLY bytes it cannot decode", () => {
    expect(sourceError(".png")).toBeNull()
    expect(sourceError(".svg")).toBeNull()
    expect(sourceError(".pdf")).toContain("Use a png or svg")
  })
})

describe("generateIcons — the set adaptv's own consumers read back", () => {
  it("writes every declared slot at exactly its declared size", async () => {
    const { dir, names } = await generated()
    for (const [name, px] of ICON_SET) {
      expect(names).toContain(name)
      const header = readImageHeader(
        readFileSync(path.join(dir, name)).subarray(0, 4096),
      )
      expect([name, header.width, header.height]).toEqual([name, px, px])
    }
  })

  it("produces a set the native ranker resolves to the right masters", async () => {
    //The reason the names are what they are. If `pickIcon` needed a special case for
    //adaptv's own output, the naming would be wrong.
    const { dir } = await generated()
    const set = scanIcons(dir)
    expect(pickIcon(set, "ios").name).toBe("icon.png")
    expect(pickIcon(set, "android").name).toBe("icon-maskable.png")
  })

  it("keeps the Android adaptive foreground transparent and the iOS slot opaque", async () => {
    //Two lineages, on purpose: the launcher composites the foreground over a colour and
    //masks the pair, while App Store Connect rejects an icon that merely HAS an alpha channel.
    const { dir, sharp } = await generated()
    const meta = (name) => sharp(path.join(dir, name)).metadata()
    expect((await meta("icon-maskable.png")).hasAlpha).toBe(true)
    expect((await meta("apple-touch-icon-180.png")).hasAlpha).toBe(false)
  })

  it("gives the web maskable icon a solid background and the `any` icon transparency", async () => {
    //The maskable spec is full-bleed art on a solid bg; `any` art keeps its own shape.
    const { dir, sharp } = await generated()
    const opaque = async (name) =>
      (await sharp(path.join(dir, name)).stats()).isOpaque
    expect(await opaque("android-maskable-512.png")).toBe(true)
    expect(await opaque("android-chrome-512.png")).toBe(false)
  })

  it("fits every slot — the ring for masked art, the tile for the rest", async () => {
    //432 × 72/108 = 288. Measured on the ART, by trimming the transparent surround —
    //the canvas is the same size either way.
    const { dir, sharp } = await generated()
    const spread = async (name) => {
      const { info } = await sharp(path.join(dir, name))
        .trim()
        .toBuffer({ resolveWithObject: true })
      return info.width
    }
    //EVERY slot is fitted now, not just the masked ones — an unmasked icon used to take the
    //source whole, which put a mark drawn to fill its frame flush against the tile's edge.
    expect(await spread("icon.png")).toBeWithin(1024 * 0.9, 4)
    //Within a few px: the mark goes through a crop and two resizes, and the property under
    //test is "fitted to the safe ring", not a byte-exact width.
    expect(await spread("icon-maskable.png")).toBeWithin(
      1024 * artTarget(),
      4,
    )
  })

  it("applies --padding on top of the safe zone, never instead of it", async () => {
    //`--padding 10` on a maskable slot means "10% tighter than the safe zone". Insetting
    //to 10% flat would push the mark OUTSIDE the zone it is supposed to sit inside.
    const { dir, sharp } = await generated({ padding: 10 })
    const { info } = await sharp(path.join(dir, "icon-maskable.png"))
      .trim()
      .toBuffer({ resolveWithObject: true })
    expect(info.width).toBeWithin(1024 * artTarget() * 0.9, 4)
  })

  it("packs favicon.ico with the sizes a desktop actually asks for", async () => {
    const { dir } = await generated()
    const decoded = decodeIco(readFileSync(path.join(dir, "favicon.ico")))
    expect(decoded.map((i) => i.size)).toEqual([16, 32, 48])
    //each payload is a real PNG at its declared size, not a stub
    for (const { size, png } of decoded)
      expect(readImageHeader(png).width).toBe(size)
  })

  it("copies a vector source through verbatim instead of rasterising it", async () => {
    //adaptv has no more faithful version of the dev's SVG than the file they handed over.
    const { dir, names, source } = await generated({ svg: true })
    expect(names).toContain("icon.svg")
    expect(readFileSync(path.join(dir, "icon.svg"), "utf8")).toBe(
      readFileSync(source, "utf8"),
    )
  })

  it("writes no icon.svg for a raster source", async () => {
    const { names } = await generated()
    expect(names).not.toContain("icon.svg")
  })
})

describe("replacing what was there", () => {
  it("removes the OLD icons, so the directory isn't half a generator's set", async () => {
    //"replace them" was a promise the command didn't keep: it writes thirteen fixed names, a
    //favicon-generator set has twenty-seven, and the manifest then read the leftovers as part
    //of one set — a stale `apple-icon-57x57.png` doesn't just linger, it gets linked.
    const { default: sharp } = await import("sharp")
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-replace-"))
    const out = path.join(dir, "icons")
    mkdirSync(out, { recursive: true })
    for (const stale of [
      "apple-icon-57x57.png",
      "pinned-tab.svg",
      "mstile-150x150.png",
    ])
      writeFileSync(path.join(out, stale), "stale")
    writeFileSync(path.join(out, "browserconfig.xml"), "<xml/>")

    const source = path.join(dir, "src.png")
    writeFileSync(source, await markPng(sharp))
    const names = await generateIcons({
      source,
      dirAbs: out,
      background: WHITE,
      sharp,
    })

    expect(readdirSync(out).sort()).toEqual(
      //every icon is one adaptv just wrote; a non-image file is left alone
      [...names, "browserconfig.xml"].sort(),
    )
  })

  it("never deletes the source image, even when it lives in the target directory", async () => {
    const { default: sharp } = await import("sharp")
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-replace-src-"))
    const source = path.join(dir, "logo.png")
    writeFileSync(source, await markPng(sharp))

    await generateIcons({ source, dirAbs: dir, background: WHITE, sharp })
    expect(existsSync(source)).toBe(true)
  })

  it("counts the .ico and .svg the prompt is about to remove, which scanIcons does not", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-count-"))
    for (const n of [
      "icon.png",
      "favicon.ico",
      "pinned-tab.svg",
      "notes.txt",
    ])
      writeFileSync(path.join(dir, n), "x")
    expect(existingIcons(dir).sort()).toEqual([
      "favicon.ico",
      "icon.png",
      "pinned-tab.svg",
    ])
  })
})

describe("an opaque source is a finished tile, not a mark", () => {
  it("draws the maskable slots FULL BLEED so the mask crops them, not floats them", async () => {
    //Insetting a tile into the safe zone produces a tile adrift inside the mask — a green
    //square in a white circle. It also makes the warning a lie: `sourceWarnings` promises
    //"Android's mask crops the edges", and nothing was being cropped.
    const { default: sharp } = await import("sharp")
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-opaque-"))
    const source = path.join(dir, "tile.png")
    await sharp({
      create: {
        width: 1024,
        height: 1024,
        channels: 4,
        background: { r: 31, g: 157, b: 85, alpha: 1 },
      },
    })
      .png()
      .toFile(source)
    const out = path.join(dir, "icons")
    await generateIcons({
      source,
      dirAbs: out,
      background: WHITE,
      opaque: true,
      sharp,
    })
    const spread = async (name) => {
      const { info } = await sharp(path.join(out, name))
        .trim()
        .toBuffer({ resolveWithObject: true })
      return info.width
    }
    expect(await spread("icon-maskable.png")).toBe(1024)
    expect(await spread("android-maskable-512.png")).toBe(512)
  })

  it("still safe-zones a TRANSPARENT mark, which is what the zone is for", async () => {
    const { dir } = await generated()
    const { default: sharp } = await import("sharp")
    const { info } = await sharp(path.join(dir, "icon-maskable.png"))
      .trim()
      .toBuffer({ resolveWithObject: true })
    expect(info.width).toBeWithin(1024 * artTarget(), 4)
  })
})

describe("iOS 18 appearance variants", () => {
  it("writes a dark variant that keeps its alpha and a tinted one that is greyscale on black", async () => {
    //The two iOS 18 slots, and they want opposite things from the light icon: the dark one is
    //composited over the system's own near-black backdrop, so it must carry alpha; the tinted
    //one is a luminance ramp the system maps a colour onto, so it must not.
    const { dir, sharp } = await generated()
    const dark = await sharp(path.join(dir, "icon-dark.png"))
    expect((await dark.metadata()).hasAlpha).toBe(true)
    expect((await dark.stats()).isOpaque).toBe(false)

    const tinted = sharp(path.join(dir, "icon-tinted.png"))
    expect((await tinted.metadata()).hasAlpha).toBe(false)
    //greyscale: every pixel's channels agree
    const { channels } = await tinted.stats()
    expect(channels[0].mean).toBeCloseTo(channels[1].mean, 0)
    expect(channels[1].mean).toBeCloseTo(channels[2].mean, 0)
  })

  it("uses a hand-authored variant WHOLE, without re-fitting it", async () => {
    //The dev drew it for this exact tile — re-framing it is the thing they opted out of. It is
    //also what keeps a hand-inverted dark icon the same size as the light one.
    const { default: sharp } = await import("sharp")
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-appearance-"))
    const source = path.join(dir, "src.png")
    writeFileSync(source, await markPng(sharp))
    const authored = path.join(dir, "mine.png")
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect x="0" y="0" width="1024" height="1024" fill="#4488ff"/></svg>`,
      ),
    )
      .png()
      .toFile(authored)

    const out = path.join(dir, "icons")
    await generateIcons({
      source,
      dirAbs: out,
      background: WHITE,
      appearances: { "icon-dark.png": authored },
      sharp,
    })
    //the authored art fills its frame, so it fills the slot — no 0.9 fit applied
    const { info } = await sharp(path.join(out, "icon-dark.png"))
      .trim()
      .toBuffer({ resolveWithObject: true })
    expect(info.width).toBe(1024)
  })

  it("never lets an appearance variant win a normal platform pick", async () => {
    //`icon-dark.png` is a bare mark on nothing and `icon-tinted.png` is greyscale — either as
    //THE app icon would be a baffling home screen.
    const { dir } = await generated()
    const set = scanIcons(dir)
    expect(set.some((i) => i.family === "dark")).toBe(true)
    expect(pickIcon(set, "ios").name).toBe("icon.png")
    expect(pickIcon(set, "android").name).toBe("icon-maskable.png")
    expect(pickIcon(set, "androidLegacy").name).toBe("icon.png")
  })
})

describe("the background adaptv lifted off the mark", () => {
  const warn = (over = {}) =>
    sourceWarnings(
      {
        width: 1024,
        height: 1024,
        isolable: true,
        luminance: 0.6,
        hasDark: false,
        hasTinted: false,
        ...over,
      },
      ".png",
    ).filter((w) => w.startsWith("background "))

  it("names the colour it measured, because everything visible comes from it", async () => {
    //It becomes the iOS tile, Android's ic_launcher_background and the favicon backdrop. Read
    //off the border ring, so a drop shadow or a near-white canvas can put it a shade out —
    //invisible in the source, obvious on a home screen.
    expect(warn({ background: { r: 30, g: 122, b: 79 } })).toEqual([
      "background #1e7a4f lifted off the mark; --background overrides",
    ])
  })

  it("says nothing for a transparent source — no colour was chosen", async () => {
    expect(warn({ background: null })).toEqual([])
  })

  it("says nothing once the dev has named the colour themselves", async () => {
    //The whole notice answers a question they already answered.
    expect(
      warn({
        background: { r: 30, g: 122, b: 79 },
        backgroundChosen: true,
      }),
    ).toEqual([])
  })

  it("resolves ONE colour for the files, the notice and the preview sheet", async () => {
    //Three consumers used to work it out separately and the sheet got it wrong: it drew the
    //adaptive tiles on the flag's value while the files were flattened onto the measured one,
    //so a green-backed logo previewed on white and shipped on green.
    const measured = { background: { r: 30, g: 122, b: 79 } }
    const flag = { r: 255, g: 0, b: 0 }
    expect(effectiveBackground(measured, flag)).toEqual({
      r: 30,
      g: 122,
      b: 79,
    })
    expect(effectiveBackground(measured, flag, true)).toEqual(flag)
    //a transparent source measured no colour, so there is nothing to prefer
    expect(effectiveBackground({ background: null }, flag)).toEqual(flag)
  })

  it("lets --background outrank the measurement it warned about", async () => {
    //It used to lose to it, which made the flag a no-op in the only case anyone reaches for
    //it: a source that HAS a background whose colour they want changed.
    const { default: sharp } = await import("sharp")
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-bg-"))
    const source = path.join(dir, "src.png")
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#1e7a4f"/><circle cx="256" cy="256" r="150" fill="#ffffff"/></svg>`,
      ),
    )
      .png()
      .toFile(source)

    const corner = async (out) => {
      const { data } = await sharp(path.join(out, "icon.png"))
        .extract({ left: 2, top: 2, width: 1, height: 1 })
        .raw()
        .toBuffer({ resolveWithObject: true })
      return [data[0], data[1], data[2]]
    }

    const measured = path.join(dir, "measured")
    await generateIcons({
      source,
      dirAbs: measured,
      background: WHITE,
      sharp,
    })
    expect(await corner(measured)).toEqual([30, 122, 79])

    const chosen = path.join(dir, "chosen")
    await generateIcons({
      source,
      dirAbs: chosen,
      background: { r: 255, g: 0, b: 0 },
      backgroundChosen: true,
      sharp,
    })
    expect(await corner(chosen)).toEqual([255, 0, 0])
  })

  it("keeps the iOS dark variant transparent whichever colour won", async () => {
    //Apple's requirement, and it is about the LAYER, not about the source: the system draws
    //its own near-black backdrop under it. A background colour, measured or named, must never
    //reach this slot.
    const { default: sharp } = await import("sharp")
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-bgdark-"))
    const source = path.join(dir, "src.png")
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#1e7a4f"/><circle cx="256" cy="256" r="150" fill="#ffffff"/></svg>`,
      ),
    )
      .png()
      .toFile(source)

    for (const over of [{}, { backgroundChosen: true }]) {
      const out = path.join(dir, `d${Object.keys(over).length}`)
      await generateIcons({
        source,
        dirAbs: out,
        background: { r: 255, g: 0, b: 0 },
        sharp,
        ...over,
      })
      const dark = sharp(path.join(out, "icon-dark.png"))
      expect((await dark.metadata()).hasAlpha).toBe(true)
      expect((await dark.stats()).isOpaque).toBe(false)
    }
  })
})

describe("Android's themed-icon layer", () => {
  it("writes a monochrome layer that is white and never flattened", async () => {
    //It is ONE LAYER of a two-layer icon, like `icon-maskable.png`: the launcher tints it with
    //SRC_IN and draws it on its own background, so painting a background onto it here would
    //make the tile a solid rectangle of ink.
    const { dir, sharp } = await generated()
    const mono = sharp(path.join(dir, "icon-monochrome.png"))
    expect((await mono.metadata()).hasAlpha).toBe(true)
    expect((await mono.stats()).isOpaque).toBe(false)
    //White WHERE THERE IS INK — the transparent surround keeps sharp's rgba(0,0,0,0), so this
    //has to be read off the inked pixels rather than off the whole frame's channel stats.
    const { data, info } = await sharp(
      path.join(dir, "icon-monochrome.png"),
    )
      .raw()
      .toBuffer({ resolveWithObject: true })
    let inked = 0
    for (let i = 0; i < info.width * info.height; i++) {
      if (data[i * 4 + 3] < 250) continue
      inked++
      expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]).toEqual([
        255, 255, 255,
      ])
    }
    expect(inked).toBeGreaterThan(0)
  })

  it("keeps the layer out of every web surface it would be invisible on", async () => {
    //White on white. It has exactly one consumer — `mipmap-anydpi-v26/ic_launcher.xml`.
    const { dir } = await generated()
    const set = scanIcons(dir)
    expect(set.some((i) => i.family === "monochrome")).toBe(true)
    expect(pickIcon(set, "ios").name).toBe("icon.png")
    expect(pickIcon(set, "android").name).toBe("icon-maskable.png")
    expect(pickIcon(set, "androidLegacy").name).toBe("icon.png")
  })

  it("uses a hand-authored --monochrome whole, without re-deriving its alpha", async () => {
    //Re-ramping it would put back the decision the flag exists to take away.
    const { default: sharp } = await import("sharp")
    const dir = mkdtempSync(path.join(tmpdir(), "adaptv-mono-"))
    const source = path.join(dir, "src.png")
    writeFileSync(source, await markPng(sharp))
    const authored = path.join(dir, "mine.png")
    await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><circle cx="512" cy="512" r="512" fill="#101010"/></svg>`,
      ),
    )
      .png()
      .toFile(authored)

    const out = path.join(dir, "icons")
    await generateIcons({
      source,
      dirAbs: out,
      background: WHITE,
      appearances: { "icon-monochrome.png": authored },
      sharp,
    })
    //Derived, a near-black disc would come out at the ramp's floor. Authored, it is opaque.
    const { channels } = await sharp(
      path.join(out, "icon-monochrome.png"),
    ).stats()
    expect(channels[3].max).toBe(255)
  })
})

describe("the dark-mark warning covers BOTH iOS appearances", () => {
  const dark = (over = {}) =>
    sourceWarnings(
      {
        width: 1024,
        height: 1024,
        isolable: true,
        luminance: 0.05,
        ...over,
      },
      ".png",
    )

  it("names both when neither is supplied", () => {
    //It first said only `--dark`, which was half the problem: the tinted variant is a
    //luminance ramp, so dark pixels stay dark there too. A black wordmark measured 0.005
    //through the tint — a black rectangle.
    expect(dark()).toEqual([
      "mark is dark — iOS dark + tinted need light art (--dark, --tinted)",
    ])
  })

  it("names only what is still missing", () => {
    expect(dark({ hasDark: true })).toEqual([
      "mark is dark — iOS tinted needs light art (--tinted)",
    ])
    expect(dark({ hasTinted: true })).toEqual([
      "mark is dark — iOS dark needs light art (--dark)",
    ])
  })

  it("goes quiet once both are hand-authored", () => {
    expect(dark({ hasDark: true, hasTinted: true })).toEqual([])
  })

  it("says nothing about a light mark", () => {
    expect(dark({ luminance: 0.7 })).toEqual([])
  })

  it("stays inside a narrow terminal in every form", () => {
    for (const w of [
      ...dark(),
      ...dark({ hasDark: true }),
      ...dark({ hasTinted: true }),
    ])
      expect(w.length).toBeLessThanOrEqual(72)
  })
})
