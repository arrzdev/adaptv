// @vitest-environment node
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  clearIconCaches,
  DEFAULT_ICONS_DIR,
  loadIconSet,
} from "./icons.mjs"

/** A real, decodable PNG — `scanIcons` reads the header, so a placeholder byte is not an icon. */
const REAL_PNG = path.join(DEFAULT_ICONS_DIR, "android-chrome-512.png")

// The per-run memos exist because one CLI run asks the same question about the same files
// several times. The ONLY thing that can go wrong with them is an answer outliving the file it
// describes — so that is what these test.

//a case may make more than one app root, so every one is kept for the cleanup
const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
  clearIconCaches()
})

/** An app root with `public/favicons/` containing `names`. */
function app(names = []) {
  const dir = mkdtempSync(path.join(tmpdir(), "adaptv-iconcache-"))
  dirs.push(dir)
  const icons = path.join(dir, "public/favicons")
  mkdirSync(icons, { recursive: true })
  for (const n of names) writeFileSync(path.join(icons, n), "x")
  return dir
}

const CONFIG = { icons: "./public/favicons" }

describe("the icon-set memo — one scan per run, and never one scan too many", () => {
  it("answers the second ask from memory (this is the whole point: preflight, then once per platform)", async () => {
    const root = app(["icon-512.png"])
    const first = await loadIconSet(root, CONFIG)
    const second = await loadIconSet(root, CONFIG)
    //Identity, not equality — a fresh equal object would mean the scan ran again.
    expect(second).toBe(first)
  })

  it("does not answer for a DIFFERENT icons directory from the same app root", async () => {
    const root = app(["icon-512.png"])
    const a = await loadIconSet(root, CONFIG)
    const b = await loadIconSet(root, { icons: "./public/other" })
    expect(b).not.toBe(a)
  })

  it("does not answer for the same directory under a different app root", async () => {
    const one = app(["icon-512.png"])
    const a = await loadIconSet(one, CONFIG)
    const two = app(["icon-512.png"])
    const b = await loadIconSet(two, CONFIG)
    expect(b).not.toBe(a)
  })

  it("forgets on clearIconCaches, so a command that WRITES art reads back what it wrote", async () => {
    const root = app([])
    const before = await loadIconSet(root, CONFIG)
    //An empty directory is not an empty SET — it resolves to adaptv's own mark (R38).
    expect(before.source).toBe("default")

    // what `gen icons` does: write into the very directory it just scanned
    copyFileSync(
      REAL_PNG,
      path.join(root, "public/favicons/android-chrome-512.png"),
    )
    // …without the clear, the run would still believe the app has no art of its own
    expect(await loadIconSet(root, CONFIG)).toBe(before)

    clearIconCaches()
    const after = await loadIconSet(root, CONFIG)
    expect(after).not.toBe(before)
    expect(after.source).toBe("app")
  })
})
