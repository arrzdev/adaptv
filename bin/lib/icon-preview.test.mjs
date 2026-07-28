import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { artTarget, SAFE_ZONE } from "./icon-geometry.mjs"
import { writeIconPreview } from "./icon-preview.mjs"

/**
 * The sheet is ONE big template literal, which makes it the one module in `bin/` that can be
 * syntactically broken by ordinary prose: a backtick in a CSS comment closes the literal and
 * turns the rest of the document into JavaScript. Nothing imported it, so a `SyntaxError` in it
 * survived a green suite and only surfaced when a dev ran the command. Importing it at all is
 * most of the value here; the assertions below are the rest.
 */
async function sheet(over = {}) {
  const sharp = (await import("sharp")).default
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-preview-"))
  const names = ["icon-maskable.png", "favicon-32x32.png"]
  for (const n of names)
    writeFileSync(
      path.join(dir, n),
      await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 1, g: 2, b: 3, alpha: 1 },
        },
      })
        .png()
        .toBuffer(),
    )

  const dest = path.join(dir, "preview.html")
  writeIconPreview({
    dest,
    dirAbs: dir,
    names,
    manifest: [
      { src: "/favicons/a.png", sizes: "512x512", type: "image/png" },
    ],
    meta: {
      dirRel: "./public/favicons",
      sourceRel: "logo.png",
      padding: 0,
      margin: 10,
      artTarget: artTarget(10),
      safeZone: SAFE_ZONE,
      background: "rgb(255 255 255)",
      ...over,
    },
  })
  return readFileSync(dest, "utf8")
}

describe("writeIconPreview", () => {
  it("renders a complete document with the icons inlined", async () => {
    const html = await sheet()
    expect(html.startsWith("<!doctype html>")).toBe(true)
    //self-contained: no file:// or http references to resolve
    expect(html).toContain("data:image/png;base64,")
    expect(html).not.toMatch(/src="(?!data:)/)
  })

  it("draws BOTH rings from the run's own numbers, never a hardcoded gap", async () => {
    //A sheet that draws the default margin next to art generated with `--margin 25` would be
    //showing a gap that isn't there.
    const tight = await sheet({ margin: 0, artTarget: artTarget(0) })
    const loose = await sheet({ margin: 30, artTarget: artTarget(30) })
    const inner = (html) =>
      Number(html.match(/::before\s*{\s*width:(\d+)px/)[1])
    const outer = (html) =>
      Number(html.match(/::after\s*{\s*width:(\d+)px/)[1])

    //the limit never moves; where the art goes does
    expect(outer(tight)).toBe(outer(loose))
    expect(inner(tight)).toBe(outer(tight))
    expect(inner(loose)).toBeLessThan(inner(tight))
  })

  it("names the margin the run used, so the legend matches the drawing", async () => {
    expect(await sheet({ margin: 25 })).toContain("--margin 25")
  })

  it("escapes what it interpolates", async () => {
    const html = await sheet({ sourceRel: "<script>alert(1)</script>" })
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("skips a tile whose file this run did not write", async () => {
    //`icon.svg` only exists for a vector source; a broken <img> would read as a failed run.
    expect(await sheet()).not.toContain("icon.svg")
  })
})
