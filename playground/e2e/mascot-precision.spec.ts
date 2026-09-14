import { readdirSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { expect, test } from "@playwright/test"

/*
 * The mascots' path data is rounded, and this keeps it that way.
 *
 * The art came out of the vectoriser at 3 decimals on a 1024–4096 unit
 * viewBox, drawn at most 18–20rem wide: under 1 device px per unit at DPR
 * 3, so the third decimal moved nothing on screen and cost 15–23% of
 * each file's bytes. The splash mascot rides in the shell's initial JS,
 * the chilling and sleeping ones in the tasks route, and the stressed
 * file is precached.
 *
 * Relative commands were rounded against the ROUNDED pen position, so the
 * error stays one rounding step and never accumulates along a path: every
 * point is within 0.07 units of the original at 1 decimal (0.06 device px
 * on the splash), 0.013 at 2. Rounding each relative number on its own
 * instead drifts shapes by up to 1.16 units.
 *
 * The stressed mascot keeps 2 decimals. At 1 it changed 0.75% of its
 * pixels by more than 8/255 on Chromium, past the 0.5% the change was held
 * to; the other three stayed under 0.3% on Chromium and WebKit.
 *
 * Re-exported art at full precision fails here, naming the file, and so
 * does a new art file until it is given a precision. Reading is text-only
 * and anchored on cwd (the playground root), like route-tint.spec.
 */

const ART = resolve(
  process.cwd(),
  "apps/frontend/src/components/illustrations",
)
const MAX_DECIMALS: Record<string, number> = {
  "splash-mascot.tsx": 1,
  "chilling-mascot.tsx": 1,
  "sleeping-mascot.tsx": 1,
  "stressed-mascot.svg": 2,
}
//an SVG number, exponent included (`1.5e-3` counts as 4 decimals)
const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

function decimals(text: string) {
  const [mantissa, exponent = "0"] = text.toLowerCase().split("e")
  const fraction = mantissa.split(".")[1] ?? ""
  return Math.max(0, fraction.length - Number(exponent))
}

test.describe("mascot path precision", () => {
  //reads files, never a page: once per run is enough, on the project CI runs
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "engine-independent file check; runs on the chromium project only",
  )

  test("every art file in illustrations/ has a precision here", () => {
    const art = readdirSync(ART)
      .filter((file) =>
        readFileSync(resolve(ART, file), "utf8").includes("<path"),
      )
      .sort()
    expect(
      art,
      "a file with <path> art was added or removed: round it and give it " +
        "a precision in MAX_DECIMALS",
    ).toEqual(Object.keys(MAX_DECIMALS).sort())
  })

  for (const [file, maxDecimals] of Object.entries(MAX_DECIMALS)) {
    test(`${file} path data has at most ${maxDecimals} decimals`, () => {
      const source = readFileSync(resolve(ART, file), "utf8")
      const paths = [...source.matchAll(/\sd="([^"]*)"/g)].map((m) => m[1])
      const gradients = [
        ...source.matchAll(
          /\s[xy][12]=(?:\{([-+\d.eE]+)\}|"([-+\d.eE]+)")/g,
        ),
      ].map((m) => m[1] ?? m[2])
      //THE PREMISE: the patterns still find the art, or every number
      //below passes for free
      expect(paths.length, `no <path d> found in ${file}`).toBeGreaterThan(
        50,
      )
      expect(
        gradients.length,
        `no gradient x1/y1/x2/y2 found in ${file}`,
      ).toBeGreaterThan(0)

      const numbers = [
        ...paths.flatMap((d) => d.match(NUMBER) ?? []),
        ...gradients,
      ]
      const tooPrecise = numbers.filter((n) => decimals(n) > maxDecimals)
      expect(
        tooPrecise.slice(0, 5),
        `${file}: ${tooPrecise.length} of ${numbers.length} numbers carry ` +
          `more than ${maxDecimals} decimals — round it again against the ` +
          "rounded pen (see this spec's header)",
      ).toEqual([])
    })
  }
})
