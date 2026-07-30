import { describe, expect, it } from "vitest"
import {
  ADAPTV_LAYER_ORDER,
  declaresLayerOrder,
  declaresTailwindEntry,
  injectLayerOrder,
  isTransformableCssId,
} from "#adaptv/vite/css-layer-order.ts"

//The whole point of the statement is that it is the FIRST rule in the file: CSS
//fixes layer order by first mention, and a `@layer` statement is one of only two
//rules the spec allows before `@import`. → STYLING.md §6.0
const firstRule = (css: string) =>
  css
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)[0]

describe("declaresTailwindEntry", () => {
  it("matches both quote styles", () => {
    expect(declaresTailwindEntry(`@import "tailwindcss";`)).toBe(true)
    expect(declaresTailwindEntry(`@import 'tailwindcss';`)).toBe(true)
  })

  it("matches the à-la-carte entry files", () => {
    expect(declaresTailwindEntry(`@import "tailwindcss/theme";`)).toBe(
      true,
    )
    expect(
      declaresTailwindEntry(
        `@import "tailwindcss/preflight" layer(base);`,
      ),
    ).toBe(true)
    expect(
      declaresTailwindEntry(`@import "tailwindcss/utilities.css";`),
    ).toBe(true)
  })

  it("matches the url() and trailing-clause forms", () => {
    expect(declaresTailwindEntry(`@import url("tailwindcss");`)).toBe(true)
    expect(
      declaresTailwindEntry(`@import "tailwindcss" source("../src");`),
    ).toBe(true)
  })

  it("does not match another package that merely mentions tailwind", () => {
    expect(declaresTailwindEntry(`@import "tailwindcss-safe-area";`)).toBe(
      false,
    )
    expect(declaresTailwindEntry(`/* uses tailwindcss */`)).toBe(false)
  })
})

describe("declaresLayerOrder", () => {
  it("recognises the hand-written statement", () => {
    expect(declaresLayerOrder(ADAPTV_LAYER_ORDER)).toBe(true)
    expect(
      declaresLayerOrder(`@layer theme,base,adaptv,components,utilities;`),
    ).toBe(true)
  })

  //adaptv's own index.css opens with `@layer adaptv.reset, adaptv.patches, …`.
  //That registers the `adaptv` parent AT THAT POINT — which is precisely the
  //broken position this plugin exists to fix, so it must not read as "handled".
  it("does not count a sub-layer statement as the order", () => {
    expect(
      declaresLayerOrder(
        `@layer adaptv.reset, adaptv.patches, adaptv.components;`,
      ),
    ).toBe(false)
  })

  it("does not count a layer BLOCK", () => {
    expect(declaresLayerOrder(`@layer adaptv { .a { color: red } }`)).toBe(
      false,
    )
  })
})

describe("injectLayerOrder", () => {
  it("prepends the statement to a Tailwind entry stylesheet", () => {
    const out = injectLayerOrder(
      `@import "tailwindcss";\n@import "@arrzdev/adaptv/styles.css";\n`,
    )
    expect(out).not.toBeNull()
    expect(firstRule(out as string)).toBe(ADAPTV_LAYER_ORDER)
    //the original source survives underneath, unedited
    expect(out).toContain(`@import "tailwindcss";`)
    expect(out).toContain(`@import "@arrzdev/adaptv/styles.css";`)
  })

  it("works with single quotes too", () => {
    const out = injectLayerOrder(`@import 'tailwindcss';\n`)
    expect(firstRule(out as string)).toBe(ADAPTV_LAYER_ORDER)
  })

  it("goes above a leading comment, so it is still the first RULE", () => {
    const out = injectLayerOrder(
      `/* the app's tokens */\n@import "tailwindcss";\n`,
    )
    expect(firstRule(out as string)).toBe(ADAPTV_LAYER_ORDER)
  })

  //`@charset` is the only rule that must precede a `@layer` statement.
  it("stays below a leading @charset", () => {
    const out = injectLayerOrder(
      `@charset "utf-8";\n@import "tailwindcss";\n`,
    ) as string
    expect(out.startsWith(`@charset "utf-8";`)).toBe(true)
    expect(out.split("\n")[1]).toBe(ADAPTV_LAYER_ORDER)
  })

  it("leaves a stylesheet with no Tailwind entry alone", () => {
    expect(injectLayerOrder(`.card { color: red }\n`)).toBeNull()
    expect(
      injectLayerOrder(`@import "@arrzdev/adaptv/styles.css";\n`),
    ).toBeNull()
  })

  it("leaves a hand-written statement alone", () => {
    expect(
      injectLayerOrder(`${ADAPTV_LAYER_ORDER}\n@import "tailwindcss";\n`),
    ).toBeNull()
  })

  it("is idempotent — running the transform twice changes nothing", () => {
    const source = `@import "tailwindcss";\n`
    const once = injectLayerOrder(source) as string
    expect(injectLayerOrder(once)).toBeNull()
  })

  it("does not care where the app puts its own layer order", () => {
    //a consumer who wrote a different order (adaptv last) has made a decision;
    //re-stating it above them would silently change their cascade
    const source = `@layer base, components, utilities, adaptv;\n@import "tailwindcss";\n`
    expect(injectLayerOrder(source)).toBeNull()
  })
})

describe("isTransformableCssId", () => {
  it("accepts real stylesheets, with or without Vite's query suffixes", () => {
    expect(isTransformableCssId("/app/src/main.css")).toBe(true)
    expect(isTransformableCssId("/app/src/main.css?used")).toBe(true)
    expect(isTransformableCssId("/app/src/main.css?direct")).toBe(true)
  })

  it("rejects non-CSS modules", () => {
    expect(isTransformableCssId("/app/src/main.tsx")).toBe(false)
    expect(isTransformableCssId("/app/src/main.scss")).toBe(false)
  })

  //`?raw` / `?url` hand the file to the app as DATA — rewriting one is a silent
  //corruption of a string the app is about to read, not a cascade fix.
  it("rejects the asset-import queries and the optimiser cache", () => {
    expect(isTransformableCssId("/app/src/main.css?raw")).toBe(false)
    expect(isTransformableCssId("/app/src/main.css?url")).toBe(false)
    expect(isTransformableCssId("/app/src/w.css?worker")).toBe(false)
    expect(
      isTransformableCssId("/app/node_modules/.vite/deps/x.css"),
    ).toBe(false)
  })
})
