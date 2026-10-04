// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"
import { patchIosTheme } from "./native.mjs"

// adaptv's iOS launch screen is a colour, not art: the storyboard paints the
// `AdaptvSplash` colourset and names no image. The native project the scaffold starts
// from still carries the template's `Splash.imageset`, whose PNGs are the vendor's logo.
// Nothing adaptv ships draws it, but the privacy screen plugin's app-switcher cover
// looks it up BY NAME (`UIImage(named: "Splash")`) before it falls back to the launch
// storyboard, so while it exists the app switcher shows a brand that is not the app's.

const MASK = { light: "#eeeeec", dark: "#0a0a0c", follow: "system" }

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

/** An iOS project skeleton shaped like a fresh scaffold, template splash art included. */
function project() {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-ios-"))
  dirs.push(appRoot)
  const iosApp = path.join(appRoot, ADAPTV_DIR, "ios/App/App")
  const imageset = path.join(iosApp, "Assets.xcassets/Splash.imageset")
  mkdirSync(imageset, { recursive: true })
  writeFileSync(path.join(imageset, "Contents.json"), "{}")
  writeFileSync(path.join(imageset, "splash-2732x2732.png"), "png")
  mkdirSync(path.join(iosApp, "Base.lproj"), { recursive: true })
  return { appRoot, iosApp, imageset }
}

describe("patchIosTheme — the launch screen is the colour and nothing else", () => {
  it("removes the template Splash.imageset, so nothing can show the vendor's art by name", () => {
    const { appRoot, imageset } = project()
    patchIosTheme(appRoot, MASK)
    expect(existsSync(imageset)).toBe(false)
  })

  it("still writes the colourset and the storyboard that paints it", () => {
    const { appRoot, iosApp } = project()
    patchIosTheme(appRoot, MASK)
    expect(
      readFileSync(
        path.join(
          iosApp,
          "Assets.xcassets/AdaptvSplash.colorset/Contents.json",
        ),
        "utf8",
      ),
    ).toContain('"red": "0.933"')
    const storyboard = readFileSync(
      path.join(iosApp, "Base.lproj/LaunchScreen.storyboard"),
      "utf8",
    )
    expect(storyboard).toContain('name="AdaptvSplash"')
    expect(storyboard).not.toContain("<image ")
  })

  it("is idempotent: a second run over an already-patched project changes nothing and does not throw", () => {
    const { appRoot, iosApp, imageset } = project()
    patchIosTheme(appRoot, MASK)
    const storyboard = path.join(
      iosApp,
      "Base.lproj/LaunchScreen.storyboard",
    )
    const first = readFileSync(storyboard, "utf8")
    expect(() => patchIosTheme(appRoot, MASK)).not.toThrow()
    expect(existsSync(imageset)).toBe(false)
    expect(readFileSync(storyboard, "utf8")).toBe(first)
  })
})
