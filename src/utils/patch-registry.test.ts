import { readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"
import { isPatchDisabled } from "#adaptv/utils/is-patch-disabled"
import type { PatchName } from "#adaptv/utils/patch-registry"
import {
  BOOLEAN_PATCHES,
  HATCHED_PATCHES,
  hatchAttribute,
  PATCHES,
  UI_PATCHES,
} from "#adaptv/utils/patch-registry"
import { UI_STAMPS } from "#adaptv/utils/platform"

/*
 * The registry exists so a patch's config key, `<html>` stamp and element hatch
 * cannot drift apart (patch-delivery.md §2.1). These tests are the "cannot".
 */

const SRC = join(process.cwd(), "src")

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      return entry.name === "fixtures" ? [] : sourceFiles(path)
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)
      ? [path]
      : []
  })
}

//comments may name an attribute to explain it; code may not spell one
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
}

const stamps = UI_STAMPS.map(([, attr]) => attr)
const hatches = HATCHED_PATCHES.map((name) => hatchAttribute(name))

describe("the patch registry", () => {
  it("names the five behavioural hatches and no others (§2.5: five is a design)", () => {
    expect(hatches).toEqual([
      "data-adaptv-no-hover",
      "data-adaptv-no-active",
      "data-adaptv-no-caret-repaint",
      "data-adaptv-no-text-magnifier",
      "data-adaptv-no-viewport-freeze",
    ])
  })

  it("gives every patch without a hatch a written reason", () => {
    const without = (Object.keys(PATCHES) as PatchName[]).filter(
      (name) => PATCHES[name].hatch === false,
    )
    expect(without).toEqual([
      "focusRing",
      "autofill",
      "tapHighlight",
      "safeAreaOrder",
      "ringShadow",
    ])
    for (const name of without) {
      const row = PATCHES[name] as { noHatchBecause?: string }
      expect(row.noHatchBecause?.length).toBeGreaterThan(10)
    }
  })

  it("derives the config keys, and keeps today's split between the two blocks", () => {
    expect(BOOLEAN_PATCHES).toEqual([
      "caretRepaint",
      "textMagnifier",
      "viewportFreeze",
    ])
    expect(UI_PATCHES).toEqual([
      "noSelect",
      "hideScrollbars",
      "touchCallout",
    ])
  })

  it("derives the pre-paint stamp list from the ui rows", () => {
    expect(UI_STAMPS).toEqual([
      ["noSelect", "data-adaptv-no-select"],
      ["hideScrollbars", "data-adaptv-hide-scrollbars"],
      ["touchCallout", "data-adaptv-no-touch-callout"],
    ])
  })

  it("is the only place in src/ code that spells a stamp or hatch attribute", () => {
    const registry = join(SRC, "utils/patch-registry.ts")
    const offenders = sourceFiles(SRC)
      .filter((file) => file !== registry)
      .flatMap((file) => {
        const code = stripComments(readFileSync(file, "utf8"))
        return [...stamps, ...hatches]
          .filter((attr) => code.includes(attr))
          .map((attr) => `${relative(SRC, file)}: ${attr}`)
      })
    expect(offenders).toEqual([])
  })

  it("keeps the hatch namespace closed: no unregistered data-adaptv-no-* in code", () => {
    const known = new Set([...stamps, ...hatches])
    const strays = sourceFiles(SRC).flatMap((file) =>
      [
        ...stripComments(readFileSync(file, "utf8")).matchAll(
          /data-adaptv-no-[a-z-]+/g,
        ),
      ]
        .map((match) => match[0])
        .filter((attr) => !known.has(attr))
        .map((attr) => `${relative(SRC, file)}: ${attr}`),
    )
    expect(strays).toEqual([])
  })
})

describe("isPatchDisabled", () => {
  it("finds the hatch on the element or any ancestor", () => {
    const host = document.createElement("div")
    host.setAttribute("data-adaptv-no-caret-repaint", "")
    const leaf = host.appendChild(document.createElement("input"))
    document.body.appendChild(host)
    expect(isPatchDisabled(host, "caretRepaint")).toBe(true)
    expect(isPatchDisabled(leaf, "caretRepaint")).toBe(true)
    //a hatch is per patch: opting out of one opts out of nothing else
    expect(isPatchDisabled(leaf, "textMagnifier")).toBe(false)
    host.remove()
  })

  it("is false for a target that is not an element", () => {
    expect(isPatchDisabled(null, "hover")).toBe(false)
    expect(isPatchDisabled(window, "hover")).toBe(false)
  })

  it("refuses a patch whose row says hatch: false, at compile time", () => {
    const el = document.createElement("div")
    // @ts-expect-error — the focus-ring reset has no hatch (WCAG 2.4.7)
    isPatchDisabled(el, "focusRing")
    // @ts-expect-error — a property patch is undone by the property, not a marker
    isPatchDisabled(el, "noSelect")
  })
})
