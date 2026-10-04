import { describe, expect, it } from "vitest"
import { measureArtwork, monochromeMark } from "./artwork.mjs"
import { artTarget, fitScale, SAFE_ZONE } from "./icon-geometry.mjs"

const sharpP = import("sharp").then((m) => m.default)

//The describes that render through sharp take ~1.4s a test at worst on a 2-CPU host at load 6,
//against the 5s default. They carry this budget; it is for the slow host only.
const BUDGET = { timeout: 20_000 }

/** Render an SVG to a PNG buffer at `size`. */
async function png(svg, size = 512) {
  const sharp = await sharpP
  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer()
}

const disc = (bg = "none") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
     ${bg === "none" ? "" : `<rect width="512" height="512" fill="${bg}"/>`}
     <circle cx="256" cy="256" r="256" fill="#e0483c"/></svg>`

const square = (bg = "none") =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
     ${bg === "none" ? "" : `<rect width="512" height="512" fill="${bg}"/>`}
     <rect width="512" height="512" fill="#e0483c"/></svg>`

/** A mark occupying the middle half of its frame, on `bg`. */
const inset = (bg) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
     ${bg === "none" ? "" : `<rect width="512" height="512" fill="${bg}"/>`}
     <circle cx="256" cy="256" r="128" fill="#e0483c"/></svg>`

/** How far the opaque pixels of `buf` reach from its centre, 1 = the inscribed circle. */
async function reachOf(buf) {
  const sharp = await sharpP
  const { data, info } = await sharp(buf)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const { width: w, height: h, channels } = info
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  let max = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * channels + 3] <= 8) continue
      const d = Math.hypot(x - cx, y - cy)
      if (d > max) max = d
    }
  return max / (w / 2)
}

describe("fitScale — the placement falls out of the measurement", () => {
  const art = (reach, fill = 1) => ({ reach, fill })

  it("lands every shape the same distance from the centre in a CIRCLE slot", () => {
    //The whole bug in two numbers. Android's safe zone is a CIRCLE, so art inset to a 0.667
    //SQUARE puts its corners at 0.667 × √2 = 0.94 — outside the circle every time. Measuring
    //instead means a round mark and a square one both end up reaching the same target.
    for (const reach of [1, 1.17, Math.SQRT2])
      expect(
        reach * fitScale(art(reach), { shape: "circle" }),
      ).toBeCloseTo(artTarget(), 5)
  })

  it("insets a BOX slot by the margin, whatever shape the art is", () => {
    //Nothing crops these, so the constraint is the tile, not a radius — and a mark drawn to
    //fill its frame used to come out flush against the edge of an iOS icon.
    for (const reach of [1, Math.SQRT2])
      expect(fitScale(art(reach), { shape: "box" })).toBeCloseTo(0.9, 5)
  })

  it("stops SHORT of every limit, so nothing sits flush", () => {
    expect(artTarget()).toBeLessThan(SAFE_ZONE)
    expect(fitScale(art(1), { shape: "box" })).toBeLessThan(1)
  })

  it("never blows up art the dev already framed with room around it", () => {
    //`gen icons` reproduces a logo; it does not redesign one. `fill` is the ceiling.
    expect(fitScale(art(1, 0.4), { shape: "box" })).toBeCloseTo(0.4, 5)
    expect(fitScale(art(1, 0.4), { shape: "circle" })).toBeCloseTo(0.4, 5)
  })

  it("honours the margin on both shapes", () => {
    expect(fitScale(art(1), { shape: "box", margin: 0 })).toBeCloseTo(1, 5)
    expect(fitScale(art(1), { shape: "circle", margin: 0 })).toBeCloseTo(
      SAFE_ZONE,
      5,
    )
    expect(fitScale(art(1), { shape: "box", margin: 30 })).toBeCloseTo(
      0.7,
      5,
    )
  })

  it("falls back rather than dividing by nothing", () => {
    expect(fitScale({}, { shape: "circle" })).toBeCloseTo(artTarget(), 5)
    expect(
      fitScale({ reach: Number.NaN, fill: Number.NaN }, { shape: "box" }),
    ).toBeCloseTo(0.9, 5)
  })
})

describe("measureArtwork — where the background stops", BUDGET, () => {
  it("reads a transparent surround as background", async () => {
    const art = await measureArtwork(await sharpP, await png(disc()))
    expect(art.background).toBeNull()
    expect(art.mark).not.toBeNull()
    //a disc fills the inscribed circle of its box exactly
    expect(art.reach).toBeCloseTo(1, 1)
  })

  it("reads a FLAT COLOUR surround as background too", async () => {
    //The case that produced the bug report: `android-chrome-512.png` out of a favicon
    //generator is RGBA with every pixel opaque, on white. "Transparent" is not the test.
    const art = await measureArtwork(
      await sharpP,
      await png(inset("#ffffff")),
    )
    expect(art.background).toMatchObject({ r: 255, g: 255, b: 255 })
    expect(art.reach).toBeCloseTo(1, 1)
  })

  it("cuts the flat background OUT of the mark, not just around it", async () => {
    //Shipping without this measured the mark correctly and then drew the whole white BOX at
    //the mark's scale — whose corners land back outside the ring the measurement just cleared.
    const art = await measureArtwork(
      await sharpP,
      await png(inset("#ffffff")),
    )
    expect(await reachOf(art.mark)).toBeCloseTo(1, 1)
  })

  it("measures a square mark as reaching its corners", async () => {
    const art = await measureArtwork(await sharpP, await png(square()))
    expect(art.reach).toBeCloseTo(Math.SQRT2, 1)
  })

  it("re-centres art that sat off-centre in its own file", async () => {
    //Otherwise one side of the mask crops more than the other, which reads as a bug in the
    //art rather than in the placement.
    const off = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
      <circle cx="150" cy="150" r="100" fill="#e0483c"/></svg>`
    const art = await measureArtwork(await sharpP, await png(off))
    expect(art.reach).toBeCloseTo(1, 1)
  })

  it("gives up on a background it cannot isolate, rather than inventing a mark", async () => {
    //A gradient, a photo, a screenshot: there is no "the logo" to move, so every slot takes
    //the source whole and `sourceWarnings` says the mask will crop it.
    const gradient = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
      <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/>
      </linearGradient></defs>
      <rect width="512" height="512" fill="url(#g)"/></svg>`
    const art = await measureArtwork(await sharpP, await png(gradient))
    expect(art.mark).toBeNull()
    expect(art.reach).toBeCloseTo(Math.SQRT2, 5)
  })

  it("treats an all-background image as having nothing to protect", async () => {
    const art = await measureArtwork(
      await sharpP,
      await png(square("#ffffff")),
    )
    //the square IS the art here — a flat red frame on… itself. Border is red, so red is the
    //background, and there is no content left.
    expect(art.mark).toBeNull()
  })
})

describe("the fitted mark actually clears the ring", BUDGET, () => {
  it("puts the furthest pixel of an awkward mark ON the safe circle, not past it", async () => {
    //End to end, in the units the mask uses: measure → scale → place → re-measure.
    const sharp = await sharpP
    //a square with spikes at the corners — the shape a fixed 0.667 inset always cropped
    const spiky = await png(
      `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
         <rect x="96" y="96" width="320" height="320" fill="#e0483c"/>
         <circle cx="96" cy="96" r="48" fill="#e0483c"/>
         <circle cx="416" cy="96" r="48" fill="#e0483c"/></svg>`,
    )
    const art = await measureArtwork(sharp, spiky)
    const scale = fitScale(art, { shape: "circle" })

    const canvas = 512
    const inner = Math.round(canvas * scale)
    const placed = await sharp({
      create: {
        width: canvas,
        height: canvas,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp(art.mark)
            .resize(inner, inner, {
              fit: "contain",
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            })
            .png()
            .toBuffer(),
          gravity: "center",
        },
      ])
      .png()
      .toBuffer()

    expect(await reachOf(placed)).toBeLessThanOrEqual(artTarget() + 0.01)
    //…and comfortably inside the ring, not touching it
    expect(await reachOf(placed)).toBeLessThan(SAFE_ZONE - 0.05)
  })
})

describe("fitScale — whole file vs cropped mark", () => {
  const art = (fill, reach = 1) => ({ reach, fill })

  it("does not apply the fit twice to a file that is already fitted", () => {
    //`gen icons` writes `icon.png` with the mark at 0.9. The native brander then measured that
    //file and, using the crop's answer, fitted it to 0.9 AGAIN — 0.81. For a loosely framed
    //logo it was worse: 0.20 next to a 0.45 hand-authored dark variant left alone.
    const already = art(0.9)
    expect(
      0.9 * fitScale(already, { shape: "box", whole: true }),
    ).toBeCloseTo(0.9, 3)
  })

  it("scales a raw file DOWN to the target when its art overflows", () => {
    //A favicon set's square, art nearly edge to edge.
    const raw = art(0.98)
    expect(
      0.98 * fitScale(raw, { shape: "box", whole: true }),
    ).toBeCloseTo(0.9, 3)
  })

  it("leaves a loosely framed file alone rather than enlarging it", () => {
    expect(fitScale(art(0.4), { shape: "box", whole: true })).toBe(1)
  })

  it("lands a circle-masked file on the ring, wherever its art started", () => {
    for (const [fill, reach] of [
      [0.9, 1],
      [0.5, 1.3],
      [1, Math.SQRT2],
    ])
      expect(
        fill *
          reach *
          fitScale(art(fill, reach), { shape: "circle", whole: true }),
      ).toBeLessThanOrEqual(artTarget() + 0.001)
  })
})

describe(
  "measureArtwork — luminance decides the dark appearance",
  BUDGET,
  () => {
    it("reads the MARK, not the frame — a black logo on white is a dark mark", async () => {
      //Averaging the whole image would call this bright and let adaptv derive an iOS dark icon
      //that is invisible on the system's near-black backdrop.
      const art = await measureArtwork(
        await sharpP,
        await png(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
        <rect width="512" height="512" fill="#ffffff"/>
        <circle cx="256" cy="256" r="150" fill="#0a0a0a"/></svg>`),
      )
      expect(art.luminance).toBeLessThan(0.1)
    })

    it("reads a light mark as light, whatever it sits on", async () => {
      const art = await measureArtwork(
        await sharpP,
        await png(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
        <rect width="512" height="512" fill="#123456"/>
        <circle cx="256" cy="256" r="150" fill="#ffffff"/></svg>`),
      )
      expect(art.luminance).toBeGreaterThan(0.9)
    })
  },
)

describe("monochromeMark — Android's themed layer", BUDGET, () => {
  /** `{ coverage, mean, opaqueShare }` over the alpha channel's non-empty pixels. */
  async function alphaStats(buf) {
    const sharp = await sharpP
    const { data, info } = await sharp(buf)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    let n = 0
    let sum = 0
    let opaque = 0
    for (let i = 0; i < info.width * info.height; i++) {
      const a = data[i * 4 + 3]
      if (a <= 8) continue
      n++
      sum += a
      if (a > 250) opaque++
    }
    return {
      coverage: n / (info.width * info.height),
      mean: sum / n,
      opaqueShare: opaque / n,
    }
  }

  it("keeps a two-tone mark's internal contrast, as a range of alpha", async () => {
    //The whole reason not to ship a flat silhouette: these two halves are the mark's structure
    //and a launcher tinting one solid shape would lose them.
    const art = await measureArtwork(
      await sharpP,
      await png(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
        <rect width="512" height="512" fill="#ffffff"/>
        <rect x="120" y="120" width="272" height="136" fill="#f0f0f0"/>
        <rect x="120" y="256" width="272" height="136" fill="#202020"/></svg>`),
    )
    const stats = await alphaStats(
      await monochromeMark(await sharpP, art.mark),
    )
    expect(stats.opaqueShare).toBeGreaterThan(0.3)
    expect(stats.opaqueShare).toBeLessThan(0.7)
  })

  it("falls back to a flat silhouette for a mark with no internal contrast", async () => {
    //A solid black wordmark. Mapping luminance straight onto alpha would delete it outright,
    //and this is the case `--tinted` exists for on iOS precisely because iOS cannot do this.
    const art = await measureArtwork(
      await sharpP,
      await png(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
        <rect width="512" height="512" fill="#ffffff"/>
        <rect x="140" y="140" width="232" height="232" fill="#000000"/></svg>`),
    )
    const stats = await alphaStats(
      await monochromeMark(await sharpP, art.mark),
    )
    expect(stats.opaqueShare).toBeGreaterThan(0.98)
    expect(stats.mean).toBeGreaterThan(250)
  })

  it("measures the range off SOLID pixels, so an anti-aliased fringe can't set the scale", async () => {
    //The bug this locks: a black disc's fringe is a ring of near-white pixels left behind by
    //`cutBackground`. Counting them made a flat mark measure a full 0-1 spread, take the ramp,
    //and come out at 30% alpha with a bright halo.
    const art = await measureArtwork(
      await sharpP,
      await png(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
        <rect width="512" height="512" fill="#ffffff"/>
        <circle cx="256" cy="256" r="180" fill="#000000"/></svg>`),
    )
    const stats = await alphaStats(
      await monochromeMark(await sharpP, art.mark),
    )
    expect(stats.opaqueShare).toBeGreaterThan(0.95)
  })

  it("never returns an empty layer, whatever the mark's luminance", async () => {
    for (const fill of ["#000000", "#ffffff", "#5563d6"]) {
      const art = await measureArtwork(
        await sharpP,
        await png(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
          <circle cx="256" cy="256" r="180" fill="${fill}"/></svg>`),
      )
      const stats = await alphaStats(
        await monochromeMark(await sharpP, art.mark),
      )
      expect(stats.coverage).toBeGreaterThan(0.3)
      expect(stats.mean).toBeGreaterThan(120)
    }
  })
})
