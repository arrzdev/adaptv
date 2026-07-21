import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

//These assert on the stylesheet text rather than on computed style: the rules
//below encode WebKit bug workarounds that are *indistinguishable from the naive
//spelling* in any DOM we can test against. happy-dom resolves both spellings
//identically, and so does every engine except the one that's broken. Locking the
//text is the only regression guard that actually fires.
//`import.meta.url` is not a file: URL under the happy-dom environment, so resolve
//from the project root instead.
const utilsCss = readFileSync(
  join(process.cwd(), "src/styles/utils.css"),
  "utf8",
)

function ruleBody(name: string): string {
  const start = utilsCss.indexOf(`@utility ${name} {`)
  expect(start, `@utility ${name} not found`).toBeGreaterThan(-1)
  return utilsCss.slice(start, utilsCss.indexOf("\n}", start))
}

describe("utils.css — clickable must not use the touch-action shorthand", () => {
  //WebKit 240917 (NEW, 2022): `pointercancel` is NOT dispatched when an element
  //has `touch-action: manipulation`. The expanded longhand is spec-identical and
  //does dispatch it. Ionic hit the same wall and ships the same workaround.
  //
  //This is not cosmetic: `pointercancel` is how a gesture learns that a scroll
  //took over. Any nativ surface that is both tappable and gesture-driven — a
  //Button inside Swipeable, a drawer handle — strands its gesture state machine
  //on iOS if the shorthand comes back.
  it("spells touch-action as the longhand, never `manipulation`", () => {
    const clickable = ruleBody("clickable")
    expect(clickable).toContain("touch-action: pan-x pan-y pinch-zoom")
    expect(clickable).not.toContain("touch-action: manipulation")
  })

  it("carries the bug reference so the shorthand is not 'simplified' back in", () => {
    expect(utilsCss).toContain("240917")
  })

  it("keeps the shorthand out of every other utility too", () => {
    //strip comments first: the rule above *names* the shorthand in prose to explain
    //why it's banned, and that must not read as a violation
    const declarations = utilsCss.replace(/\/\*[\s\S]*?\*\//g, "")
    expect(declarations).not.toContain("manipulation")
  })
})
