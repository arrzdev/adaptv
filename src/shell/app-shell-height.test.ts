import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import type { ViewportSurface } from "#adaptv/styles/viewport-units.test-helper"
import { resolveLayeredLength } from "#adaptv/styles/viewport-units.test-helper"

//The shell's height is a viewport-unit expression that no DOM we can test in resolves the way
//an iPhone does, so it is resolved from the compiled CSS against numbers read off simulators.
const shellHeight = (surface: ViewportSurface) =>
  resolveLayeredLength("[data-app-shell]", "height", surface)

describe("the app shell is as tall as the screen the app can show", () => {
  it("fits the viewport of an iOS 26 installed app, whose page starts below the status bar", async () => {
    //iOS 26.1: innerHeight, visualViewport and 100dvh are 812, the page starts 62pt down
    //the 874pt screen with a top inset of 0, and 100vh is still the whole screen. A 100vh
    //shell hangs 62pt past the bottom, so the end of a page taller than the screen can
    //never scroll into view.
    expect(
      await shellHeight({
        platform: "standalone",
        vh: 874,
        dvh: 812,
        insetTop: 0,
      }),
    ).toBe(812)
  })

  it("covers the whole screen of an iOS 18 installed app, whichever dynamic viewport it reads", async () => {
    //iOS 18.0 runs the page under the status bar (inset 59) and 100vh is the 852pt screen.
    //The playground read 100dvh 852; a static installed page read 793.
    expect(
      await shellHeight({
        platform: "standalone",
        vh: 852,
        dvh: 793,
        insetTop: 59,
      }),
    ).toBe(852)
    expect(
      await shellHeight({
        platform: "standalone",
        vh: 852,
        dvh: 852,
        insetTop: 59,
      }),
    ).toBe(852)
  })

  it("keeps a native build on the whole layout viewport, and a browser tab on the dynamic one", async () => {
    expect(
      await shellHeight({
        platform: "native",
        vh: 852,
        dvh: 600,
        insetTop: 59,
      }),
    ).toBe(852)
    expect(
      await shellHeight({
        platform: "web",
        vh: 754,
        dvh: 714,
        insetTop: 0,
      }),
    ).toBe(714)
  })

  it("leaves nothing in the shell's own styling for a consumer's height to lose to", () => {
    //The height is a layered rule, which every utility beats. AppShell renders no class
    //of its own (its `className` is the consumer's alone), and its default rule in
    //shell-layout.css declares no height that could compete with screen.css or the
    //consumer's `shellClassName`.
    const css = readFileSync(
      resolve(__dirname, "../styles/shell-layout.css"),
      "utf8",
    )
    const shellRule = css.match(
      /:where\(\[data-adaptv="app-shell"\]\[data-part="root"\]\)\s*\{([^}]*)\}/,
    )
    expect(shellRule, "the app shell's default rule").not.toBeNull()
    expect(shellRule?.[1]).not.toMatch(/(^|[\s;])height\s*:/)
    const source = readFileSync(
      resolve(__dirname, "shell-layout.tsx"),
      "utf8",
    )
    expect(source).not.toMatch(/\bcn\(|composeStyles\(/)
  })
})
