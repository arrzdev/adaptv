import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { rewriteEmptyFallbacks } from "../../src/vite/tailwind-empty-fallback"

/*
 * adaptv's rewrite of Tailwind's empty `var()` fallbacks computes exactly what Tailwind
 * computes, on every engine that was never broken.
 *
 * The rewrite exists for Chromium 113–118 (docs/decisions/register.md), but it is
 * unconditional: every browser and both WebViews get the rewritten CSS. So the half of the
 * claim a desktop engine CAN prove is the one that ships everywhere — no utility, no
 * combination and no inheritance case computes differently from Tailwind's own output.
 * The 113 half is a device reading; this file cannot see it.
 *
 * Runs in both projects on purpose: `webkit` is the engine iOS gets this rewrite in.
 *
 * It renders the SAME fixture twice, once under Tailwind's compiled sheet and once under
 * the rewritten one, and compares every composed property on every element. It needs no
 * route and no app code, so it has no hydration gate: `setContent` replaces the page.
 */

/** Playwright runs from the playground root and transpiles specs to CJS — anchor on cwd. */
const FRONTEND = resolve(process.cwd(), "apps/frontend")

/** The app's own Tailwind, compiled for exactly `candidates`. */
async function compileTailwind(candidates: string[]): Promise<string> {
  const req = createRequire(resolve(FRONTEND, "package.json"))
  const { compile } = req("tailwindcss") as typeof import("tailwindcss")
  const compiler = await compile(
    `@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);`,
    {
      base: FRONTEND,
      loadStylesheet: async (id) => {
        const path = resolve(FRONTEND, "node_modules", id)
        return {
          path,
          base: dirname(path),
          content: readFileSync(path, "utf8"),
        }
      },
    },
  )
  return compiler.build(candidates)
}

/** One probe: classes on an element, optionally under a parent with its own classes. */
type Case = { cls: string; parent?: string; pseudo?: "::before" }

const CASES: Record<string, Case> = {
  //each composition alone, and bare
  "tabular-nums": { cls: "tabular-nums" },
  "slashed-zero": { cls: "slashed-zero" },
  "touch-pan-y": { cls: "touch-pan-y" },
  "touch-pinch-zoom": { cls: "touch-pinch-zoom" },
  blur: { cls: "blur" },
  "brightness-50": { cls: "brightness-50" },
  filter: { cls: "filter" },
  "blur!": { cls: "blur!" },
  "rotate-x-45": { cls: "rotate-x-45" },
  "skew-y-6": { cls: "skew-y-6" },
  transform: { cls: "transform" },
  "transform-gpu": { cls: "transform-gpu rotate-z-3" },
  "backdrop-blur": { cls: "backdrop-blur" },
  "backdrop-invert": { cls: "backdrop-invert" },
  "backdrop-filter": { cls: "backdrop-filter" },
  "contain-paint": { cls: "contain-paint" },
  "contain-size": { cls: "contain-size" },
  ring: { cls: "ring-2 ring-offset-2" },
  "ring-inset": { cls: "ring-1 ring-inset ring-offset-2 shadow-sm" },

  //the parts are independent and combine
  "numeric combo": {
    cls: "tabular-nums slashed-zero ordinal diagonal-fractions",
  },
  "figure combo": {
    cls: "lining-nums proportional-nums stacked-fractions",
  },
  "touch combo": { cls: "touch-pan-x touch-pan-y touch-pinch-zoom" },
  "touch directions": { cls: "touch-pan-left touch-pan-down" },
  "filter combo": { cls: "blur brightness-50 drop-shadow-lg grayscale" },
  "filter none part": { cls: "blur blur-none brightness-50" },
  "filter all parts": {
    cls: "blur-sm brightness-50 contrast-125 grayscale hue-rotate-90 invert saturate-50 sepia drop-shadow",
  },
  "transform combo": { cls: "rotate-x-45 rotate-y-12 skew-y-6 skew-x-12" },
  "backdrop combo": {
    cls: "backdrop-blur backdrop-invert backdrop-opacity-50 backdrop-sepia",
  },
  "contain combo": {
    cls: "contain-size contain-layout contain-paint contain-style",
  },

  //`inherits: false`: a child reads only its own parts
  "under blur": { parent: "blur", cls: "brightness-50" },
  "bare under blur": { parent: "blur", cls: "filter" },
  "under tabular-nums": { parent: "tabular-nums", cls: "slashed-zero" },
  "under rotate-x-45": { parent: "rotate-x-45", cls: "skew-y-6" },
  "under touch-pan-y": { parent: "touch-pan-y", cls: "touch-pinch-zoom" },
  "under contain-paint": { parent: "contain-paint", cls: "contain-size" },
  "under backdrop-blur": {
    parent: "backdrop-blur",
    cls: "backdrop-invert",
  },
  "pseudo under own blur": {
    cls: "blur before:brightness-50",
    pseudo: "::before",
  },
}

const CANDIDATES = [
  ...new Set(
    Object.values(CASES).flatMap((c) =>
      `${c.cls} ${c.parent ?? ""}`.split(/\s+/).filter(Boolean),
    ),
  ),
]

/** Ids in declaration order, so both renders index the same elements. */
const IDS = Object.keys(CASES)

function fixture(css: string): string {
  const body = IDS.map((name, i) => {
    const { cls, parent } = CASES[name]
    const probe = `<div id="p${i}" class="${cls}">0123 1/2</div>`
    return parent ? `<div class="${parent}">${probe}</div>` : probe
  }).join("\n")
  return `<!doctype html><style>${css}</style>${body}`
}

const PROPERTIES = [
  "filter",
  "backdrop-filter",
  "-webkit-backdrop-filter",
  "transform",
  "touch-action",
  "font-variant-numeric",
  "contain",
  "box-shadow",
] as const

type Reading = Record<string, Record<string, string>>

async function read(page: Page, css: string): Promise<Reading> {
  await page.setContent(fixture(css))
  return page.evaluate(
    ({ ids, cases, properties }) => {
      const out: Record<string, Record<string, string>> = {}
      ids.forEach((name, i) => {
        const el = document.getElementById(`p${i}`)
        if (!el) throw new Error(`probe ${name} missing`)
        const cs = getComputedStyle(el, cases[name].pseudo ?? null)
        out[name] = Object.fromEntries(
          properties.map((p) => [p, cs.getPropertyValue(p)]),
        )
      })
      return out
    },
    { ids: IDS, cases: CASES, properties: [...PROPERTIES] },
  )
}

test("the rewritten sheet computes exactly what Tailwind's computes", async ({
  page,
}) => {
  const original = await compileTailwind(CANDIDATES)
  const rewritten = rewriteEmptyFallbacks(original)
  expect(rewritten, "the rewrite had nothing to do").not.toBeNull()
  expect(rewritten).not.toMatch(/var\(\s*--tw-[\w-]+\s*,\s*\)/)

  const before = await read(page, original)
  const after = await read(page, rewritten as string)
  expect(after).toEqual(before)

  //Non-vacuous: equal-and-broken would also pass the line above. Every setter must have
  //applied, and every inheritance case must read its own parts only.
  expect(before.blur.filter).not.toBe("none")
  expect(before["tabular-nums"]["font-variant-numeric"]).not.toBe("normal")
  expect(before["touch-pan-y"]["touch-action"]).not.toBe("auto")
  expect(before["rotate-x-45"].transform).not.toBe("none")
  expect(before["contain-paint"].contain).not.toBe("none")
  expect(before["backdrop-blur"]["backdrop-filter"]).not.toBe("none")
  expect(before.ring["box-shadow"]).not.toBe("none")
  expect(before["filter combo"].filter).not.toBe(before.blur.filter)
  expect(before.filter.filter).toBe("none")
  expect(before["under blur"].filter).toBe(before["brightness-50"].filter)
  expect(before["bare under blur"].filter).toBe("none")
  expect(before["under tabular-nums"]["font-variant-numeric"]).toBe(
    before["slashed-zero"]["font-variant-numeric"],
  )
  expect(before["under rotate-x-45"].transform).toBe(
    before["skew-y-6"].transform,
  )
  expect(before["under touch-pan-y"]["touch-action"]).toBe(
    before["touch-pinch-zoom"]["touch-action"],
  )
  expect(before["under contain-paint"].contain).toBe(
    before["contain-size"].contain,
  )
  expect(before["under backdrop-blur"]["backdrop-filter"]).toBe(
    before["backdrop-invert"]["backdrop-filter"],
  )
  expect(before["pseudo under own blur"].filter).toBe(
    before["brightness-50"].filter,
  )
})
