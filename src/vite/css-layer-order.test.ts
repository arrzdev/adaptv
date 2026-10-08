// @vitest-environment node
import type { Plugin } from "vite"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  ADAPTV_LAYER_ORDER,
  adaptvCssLayerOrderPlugin,
  declaresLayerOrder,
  declaresTailwindEntry,
  injectLayerOrder,
  isTransformableCssId,
} from "#adaptv/vite/css-layer-order.ts"

//The whole point of the statement is that it is the FIRST rule in the file: CSS
//fixes layer order by first mention, and a `@layer` statement is one of only two
//rules the spec allows before `@import`. → docs/decisions/styling.md §6.0
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
      `@import "tailwindcss";\n@import "adaptv/styles.css";\n`,
    )
    expect(out).not.toBeNull()
    expect(firstRule(out as string)).toBe(ADAPTV_LAYER_ORDER)
    //the original source survives underneath, unedited
    expect(out).toContain(`@import "tailwindcss";`)
    expect(out).toContain(`@import "adaptv/styles.css";`)
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
    //and the file below it is the original, not shifted by a stray blank line
    expect(out).toBe(
      `@charset "utf-8";\n${ADAPTV_LAYER_ORDER}\n@import "tailwindcss";\n`,
    )
  })

  it("leaves a stylesheet with no Tailwind entry alone", () => {
    expect(injectLayerOrder(`.card { color: red }\n`)).toBeNull()
    expect(injectLayerOrder(`@import "adaptv/styles.css";\n`)).toBeNull()
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
    expect(isTransformableCssId("/app/src/w.css?sharedworker")).toBe(false)
    expect(isTransformableCssId("/app/src/main.css?inline&raw")).toBe(
      false,
    )
    expect(isTransformableCssId("/app/src/main.css?commonjs-proxy")).toBe(
      false,
    )
    expect(
      isTransformableCssId("/app/node_modules/.vite/deps/x.css"),
    ).toBe(false)
  })
})

/*
 * The plugin around the pure functions: what it hands Tailwind, and when it says
 * nothing imports Tailwind. → docs/decisions/styling.md §6.0.2
 *
 * The warning is the ONLY signal when `adaptv()` is listed after `tailwindcss()`:
 * the source this plugin sees is then already compiled, nothing is injected, and
 * adaptv's rules silently beat the app's utilities. So it must fire, fire once,
 * and never fire for an app that is fine.
 */
describe("adaptvCssLayerOrderPlugin", () => {
  const ENTRY = `@import "tailwindcss";\n@import "adaptv/styles.css";\n`
  const COMPILED = `@layer theme, base, components, utilities;\n.card{color:red}\n`

  let warnings: string[]
  beforeEach(() => {
    warnings = []
    vi.spyOn(console, "warn").mockImplementation((message: unknown) => {
      warnings.push(String(message))
    })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  function plugin() {
    const p = adaptvCssLayerOrderPlugin() as Plugin
    const transform = p.transform as (
      code: string,
      id: string,
    ) => { code: string; map: null } | null
    const buildEnd = p.buildEnd as (this: unknown) => void
    const configResolved = p.configResolved as unknown as (config: {
      plugins: { name: string }[]
    }) => void
    return {
      plugin: p,
      configResolved: (pluginNames: string[]) =>
        configResolved({ plugins: pluginNames.map((name) => ({ name })) }),
      transform: (code: string, id: string) =>
        transform.call({}, code, id),
      buildEnd: (environment?: string) =>
        buildEnd.call(
          environment === undefined
            ? {}
            : { environment: { name: environment } },
        ),
    }
  }

  it("runs before Tailwind's own pre transform", () => {
    //Tailwind's CSS transform is `pre` too; a normal-bucket plugin would only
    //ever see compiled CSS with the import already gone
    expect(plugin().plugin.enforce).toBe("pre")
  })

  it("hands Tailwind the entry stylesheet with the order as its first rule", () => {
    const { transform } = plugin()
    //the original bytes below the statement, and deliberately no source map: a
    //one-line offset on a file Tailwind compiles from scratch anyway
    const out = transform(ENTRY, "/app/src/styles/main.css?direct")
    expect(out).toEqual({
      code: `${ADAPTV_LAYER_ORDER}\n${ENTRY}`,
      map: null,
    })
  })

  it("never rewrites a stylesheet imported as data, or a non-CSS module", () => {
    const { transform } = plugin()
    expect(transform(ENTRY, "/app/src/styles/main.css?raw")).toBeNull()
    expect(
      transform(`const css = '@import "tailwindcss";'`, "/app/src/a.ts"),
    ).toBeNull()
  })

  describe("in a build", () => {
    it("warns once, naming the line to paste, when no stylesheet imports Tailwind", () => {
      const { transform, buildEnd } = plugin()
      expect(transform(COMPILED, "/app/src/styles/main.css")).toBeNull()
      buildEnd("client")
      buildEnd("client")
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain("[adaptv]")
      expect(warnings[0]).toContain(ADAPTV_LAYER_ORDER)
    })

    it("stays quiet when a stylesheet imports Tailwind", () => {
      const { transform, buildEnd } = plugin()
      transform(`.a{}`, "/app/src/components/card.css")
      transform(ENTRY, "/app/src/styles/main.css")
      transform(`.b{}`, "/app/src/components/list.css")
      buildEnd("client")
      expect(warnings).toEqual([])
    })

    it("stays quiet for an app with no stylesheets at all", () => {
      //nothing to fix, so nothing to say
      const { transform, buildEnd } = plugin()
      transform(`export default 1`, "/app/src/main.tsx")
      transform(COMPILED, "/app/src/styles/main.css?raw")
      buildEnd("client")
      expect(warnings).toEqual([])
    })

    it("gives the verdict on the client build, not on an SSR build that ends first", () => {
      //The server environment can legitimately see only non-entry stylesheets and
      //finish before the client has transformed the entry. Its verdict would be
      //a false alarm in every SSR app.
      const { transform, buildEnd } = plugin()
      transform(`.a{}`, "/app/src/components/card.css")
      buildEnd("ssr")
      expect(warnings).toEqual([])
      transform(ENTRY, "/app/src/styles/main.css")
      buildEnd("client")
      expect(warnings).toEqual([])
    })

    it("stays quiet in a plain-CSS app, whose config runs no Tailwind plugin", () => {
      //Tailwind is optional: no `utilities` layer means no order to get wrong
      const { configResolved, transform, buildEnd } = plugin()
      configResolved(["vite:css", "adaptv:css-layer-order"])
      transform(`.card{color:red}`, "/app/src/styles/main.css")
      buildEnd("client")
      expect(warnings).toEqual([])
    })

    it("still warns when the Tailwind plugin is in the config but ran first", () => {
      const { configResolved, transform, buildEnd } = plugin()
      configResolved([
        "@tailwindcss/vite:scan",
        "@tailwindcss/vite:generate:build",
      ])
      transform(COMPILED, "/app/src/styles/main.css")
      buildEnd("client")
      expect(warnings).toHaveLength(1)
    })

    it("still gives a verdict where the bundler names no environment", () => {
      const { transform, buildEnd } = plugin()
      transform(COMPILED, "/app/src/styles/main.css")
      buildEnd()
      expect(warnings).toHaveLength(1)
    })
  })

  describe("in dev, which never reaches buildEnd", () => {
    it("warns 5 s after the first stylesheet when none imported Tailwind", () => {
      vi.useFakeTimers()
      const { transform } = plugin()
      transform(COMPILED, "/app/src/styles/main.css")
      vi.advanceTimersByTime(4_000)
      //a later stylesheet does not push the verdict back
      transform(`.a{}`, "/app/src/components/card.css")
      vi.advanceTimersByTime(999)
      expect(warnings).toEqual([])
      vi.advanceTimersByTime(1)
      expect(warnings).toHaveLength(1)
      expect(warnings[0]).toContain(ADAPTV_LAYER_ORDER)
    })

    it("does not warn when the Tailwind entry arrives inside the window", () => {
      vi.useFakeTimers()
      const { transform } = plugin()
      transform(`.a{}`, "/app/src/components/card.css")
      vi.advanceTimersByTime(100)
      transform(ENTRY, "/app/src/styles/main.css")
      vi.advanceTimersByTime(60_000)
      expect(warnings).toEqual([])
    })

    it("warns once per server, however many pages load afterwards", () => {
      vi.useFakeTimers()
      const { transform, buildEnd } = plugin()
      for (let page = 0; page < 3; page++) {
        transform(COMPILED, `/app/src/styles/page-${page}.css`)
        vi.advanceTimersByTime(10_000)
      }
      //and the shutdown-time buildEnd does not repeat it
      buildEnd("client")
      expect(warnings).toHaveLength(1)
    })

    it("never holds a build process open waiting to warn", () => {
      //a build that transforms a non-entry stylesheet arms the dev timer too;
      //a ref'd timer would keep `vite build` alive for 5 s after it finished
      const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout")
      const { transform } = plugin()
      transform(`.a{}`, "/app/src/components/card.css")
      expect(setTimeoutSpy).toHaveBeenCalledTimes(1)
      const timer = setTimeoutSpy.mock.results[0]?.value as NodeJS.Timeout
      clearTimeout(timer)
      expect(timer.hasRef()).toBe(false)
    })
  })
})
