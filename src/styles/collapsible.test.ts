import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  compileAdaptvStyles,
  ruleFor,
} from "#adaptv/styles/compile.test-helper"

//Text assertions, like utils.test.ts: the claims below are about WHICH selector
//carries the transition and WHICH property it animates, and happy-dom runs no
//transitions at all, so a rendered DOM could not tell the right spelling from a
//wrong one. `import.meta.url` is not a file: URL under happy-dom, so resolve from
//the project root.
const collapsibleCss = readFileSync(
  join(process.cwd(), "src/styles/collapsible.css"),
  "utf8",
)
const declarations = collapsibleCss.replace(/\/\*[\s\S]*?\*\//g, "")

const PANEL_IN_TRANSITION =
  '[data-adaptv="collapsible-panel"]:is([data-collapsible-opening], [data-collapsible-closing])'

describe("collapsible.css — the height transition", () => {
  //`height: auto` cannot animate (WebKit 295132, interpolate-size Chrome 129+),
  //so the panel rests at `auto` with no inline height. A transition that is
  //always on would animate the px-to-auto jump at the end of every open.
  it("keys the transition on the opening/closing attributes, never on the resting panel", () => {
    expect(declarations).toContain(PANEL_IN_TRANSITION)
    const resting = declarations.match(
      /\[data-adaptv="collapsible-panel"\](?!:is\(\[data-collapsible-opening\], \[data-collapsible-closing\]\))/g,
    )
    expect(resting).toBeNull()
  })

  //docs/decisions/styling.md §3.1: state is a PRESENCE attribute namespaced per
  //component, never a multiplexed value attribute. The resting `data-collapsible-open`
  //is on the panel too, and must not be what the transition keys on.
  it("spells the phase as presence attributes, with no value attribute anywhere", () => {
    expect(collapsibleCss).not.toMatch(/data-(state|transition)\b/)
    expect(declarations).not.toContain("[data-collapsible-open]")
    //the part selector (`data-adaptv="…"`, §3) carries a value; the state never does
    expect(declarations).not.toMatch(/\[data-collapsible-[a-z-]+=/)
  })

  it("transitions height only, from the panel-local custom properties", () => {
    const transitions = declarations.match(/transition:\s*[^;]+;/g) ?? []
    expect(transitions.length).toBeGreaterThan(0)
    for (const transition of transitions) {
      const value = transition.replace(/\s+/g, " ")
      expect(
        value === "transition: none;" ||
          value.startsWith("transition: height "),
      ).toBe(true)
    }
    const body = ruleFor(declarations, PANEL_IN_TRANSITION)
    expect(body).toContain("overflow: hidden")
    expect(body).toContain(
      "transition: height var(--collapsible-duration, 200ms) var(--collapsible-easing, cubic-bezier(0.2, 0, 0, 1))",
    )
    //unprefixed: scoped to one component's subtree (docs/decisions/styling.md §3.2)
    expect(declarations).not.toContain("--adaptv-collapsible")
  })

  it("turns the transition off under prefers-reduced-motion", () => {
    const start = declarations.indexOf(
      "@media (prefers-reduced-motion: reduce)",
    )
    expect(start).toBeGreaterThan(-1)
    const reduced = declarations.slice(start)
    expect(ruleFor(reduced, PANEL_IN_TRANSITION)).toBe("transition: none;")
  })

  it("lives in the adaptv.components layer", () => {
    expect(
      declarations.trim().startsWith("@layer adaptv.components {"),
    ).toBe(true)
  })

  it("is imported by index.css", () => {
    const indexCss = readFileSync(
      join(process.cwd(), "src/styles/index.css"),
      "utf8",
    )
    expect(indexCss).toContain('@import "./collapsible.css";')
  })

  //compiled, not just read: a file the bundle imports but Tailwind fails to parse
  //ships nothing, silently
  it("reaches the shipped stylesheet", async () => {
    const css = await compileAdaptvStyles([])
    expect(css).toContain("--collapsible-duration")
    expect(css).toContain("--collapsible-easing")
    expect(css).toContain("[data-collapsible-opening]")
    expect(css).toContain("[data-collapsible-closing]")
  })
})
