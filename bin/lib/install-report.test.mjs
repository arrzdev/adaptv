// @vitest-environment node
import { describe, expect, it } from "vitest"
import { describeOwnInstall } from "./install-report.mjs"
import { namesPlumbing } from "./opacity.mjs"

/**
 * `doctor` printed twelve of its thirty-one lines as the engine's package names, under a
 * heading that said out loud they were adaptv's own. Nothing failed, because opacity was
 * enforced on text lifted out of TOOL output (R8b) and these were adaptv's own authored
 * rows — the leak came in through the one door the boundary does not stand in.
 *
 * So the input to this function is the plumbing, by name, and the assertion is that none of
 * it reaches the surface the dev sees. Feeding it the real names matters: a test built on
 * `["a", "b"]` would pass with the old twelve rows restored.
 */
const MODULES = [
  "@capacitor/app",
  "@capacitor/browser",
  "@capacitor/core",
  "@capacitor/haptics",
  "@capacitor/preferences",
]
const CLI = "8.4.2"

/** Every line the default screen would show for a report. */
const shown = (r) => [`${r.label}  ${r.note}`, ...r.notices, ...r.detail]

describe("adaptv's own install is reported without naming what it is", () => {
  it("says nothing about the engine when it is complete", () => {
    const r = describeOwnInstall({
      modules: MODULES,
      missing: [],
      runnable: true,
      version: CLI,
    })
    expect(r.ok).toBe(true)
    expect(shown(r).filter(namesPlumbing)).toEqual([])
  })

  it("says nothing about the engine when it is broken either", () => {
    //The case that matters: the names are IN HAND and are the reason the row is red.
    const r = describeOwnInstall({
      modules: MODULES,
      missing: MODULES,
      runnable: false,
      version: null,
    })
    expect(r.ok).toBe(false)
    expect(shown(r).filter(namesPlumbing)).toEqual([])
  })

  it("is one row and one outcome, however many parts are missing", () => {
    //Twelve rows for one fact was the shape of the leak, and it is also just wrong: the dev
    //has a single action, so there is a single glyph.
    const one = describeOwnInstall({
      modules: MODULES,
      missing: [MODULES[0]],
      runnable: true,
      version: CLI,
    })
    const all = describeOwnInstall({
      modules: MODULES,
      missing: MODULES,
      runnable: false,
      version: null,
    })
    expect(one.note).toBe(all.note)
    expect(one.notices).toEqual(all.notices)
    expect(one.label).toBe(all.label)
  })

  it("names the fix, and quotes the command with ' (R43)", () => {
    const r = describeOwnInstall({
      modules: MODULES,
      missing: [MODULES[0]],
      runnable: true,
      version: CLI,
    })
    expect(r.notices).toContain("Reinstall with 'pnpm install'.")
    expect(r.notices.join(" ")).not.toContain("`")
  })

  it("a broken half the dev cannot tell apart still reads the same", () => {
    //Modules present, the command dead: a different cause, the same remedy, so the same row.
    const deadCli = describeOwnInstall({
      modules: MODULES,
      missing: [],
      runnable: false,
      version: null,
    })
    expect(deadCli.ok).toBe(false)
    expect(shown(deadCli).filter(namesPlumbing)).toEqual([])
  })

  it("keeps the names under --verbose, which is where they are worth something", () => {
    //The other half of the rule. A guard that only suppressed would eventually be satisfied
    //by deleting the diagnostic, and then a broken install could not be reported at all.
    const r = describeOwnInstall({
      modules: MODULES,
      missing: [MODULES[0]],
      runnable: true,
      version: CLI,
      verbose: true,
    })
    expect(r.detail.filter(namesPlumbing).length).toBe(MODULES.length)
    expect(r.detail).toContain(`${MODULES[0]}  MISSING`)
    expect(r.detail).toContain(`native cli ${CLI}`)
  })

  it("does not point at --verbose while --verbose is printing (R6)", () => {
    const r = describeOwnInstall({
      modules: MODULES,
      missing: [MODULES[0]],
      runnable: true,
      version: CLI,
      verbose: true,
    })
    expect(r.notices).toEqual(["Reinstall with 'pnpm install'."])
  })
})
