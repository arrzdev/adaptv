import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, resolve } from "node:path"
import type { Locator, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import type {
  Claim,
  Dialect,
  PrecedenceCase,
} from "../apps/frontend/src/routing/pages/lab/style-precedence.cases"
import { CASES } from "../apps/frontend/src/routing/pages/lab/style-precedence.cases"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The precedence contract (docs/decisions/styling.md §2, §9), on COMPUTED style in a real
 * engine, for every primitive and both kinds of app.
 *
 * Since TUD-225 nothing on an adaptv element is a class of adaptv's: the default look is a
 * rule in `@layer adaptv.components` and the lock is inline style. So the class string
 * says nothing about who wins any more, and the unit suite (happy-dom, no cascade) can
 * only check the mechanism. This file checks the outcome:
 *
 * - bare     — the default is really there (the override below is not passing vacuously)
 * - plain    — an unlayered class (a stylesheet, SCSS, a CSS module) beats the default,
 *              and does not move the lock
 * - tw       — a Tailwind utility (the later `utilities` layer) does the same
 *
 * The matrix is `style-precedence.cases.ts`, shared with the page that renders it.
 */

const ROUTE = "/lab/style-precedence"

/** `user-select` in both engines: WebKit only answers for the prefixed name. */
function read(locator: Locator, property: string): Promise<string> {
  return locator.evaluate((el, prop) => {
    const style = getComputedStyle(el)
    const value = style.getPropertyValue(prop)
    if (value === "" && prop === "user-select") {
      return style.getPropertyValue("-webkit-user-select")
    }
    return value
  }, property)
}

/**
 * Chromium serialises `touch-action: pan-x pan-y pinch-zoom` as its exact equivalent
 * `manipulation`; WebKit keeps the longhand. Same value, two spellings.
 */
function canonical(value: string): string {
  return value === "manipulation" ? "pan-x pan-y pinch-zoom" : value
}

function partIn(page: Page, c: PrecedenceCase, dialect: Dialect): Locator {
  //the portalled parts (menus, the drawer) leave the wrapper, so they are looked up
  //page-wide; everything else is scoped to its row (the app's own launch splash carries
  //the same attribute as the splash row)
  return c.portal
    ? page.locator(c.part).first()
    : page.getByTestId(`sp-${c.id}-${dialect}`).locator(c.part).first()
}

async function assertRow(
  part: Locator,
  c: PrecedenceCase,
  dialect: Dialect,
): Promise<void> {
  await expect(
    part,
    `${c.id} (${dialect}) rendered no ${c.part}`,
  ).toHaveCount(1)
  const check = async (claim: Claim, kind: "override" | "lock") => {
    const value = await read(part, claim.property)
    const label = `${c.id} ${kind} ${claim.property} (${dialect})`
    if (kind === "lock" || dialect !== "bare") {
      expect.soft(canonical(value), label).toBe(canonical(claim.expected))
    } else {
      //bare: the default must differ from what the consumer asks for, or the
      //override assertion proves nothing
      expect.soft(value, label).not.toBe(claim.expected)
    }
  }
  if (c.override) await check(c.override, "override")
  if (c.lock) await check(c.lock, "lock")
}

async function openIsolated(
  page: Page,
  c: PrecedenceCase,
  dialect: Dialect,
): Promise<void> {
  await page.goto(`${ROUTE}?only=${c.id}&dialect=${dialect}`)
  //the splash row IS a splash: the handover gate waits for every splash to leave, so
  //that row is measured on the server-rendered markup, which the stylesheet styles
  if (c.id !== "splash") await awaitClientHandover(page)
  if (c.id === "select-content") {
    await page.getByRole("combobox", { name: "select" }).click()
  }
  await page.locator(c.part).first().waitFor({ state: "attached" })
}

test.describe("style precedence", () => {
  test("every row on the page", async ({ page }) => {
    await page.goto(ROUTE)
    await awaitClientHandover(page)
    for (const c of CASES.filter((row) => !row.isolate)) {
      for (const dialect of ["bare", "plain", "tw"] as const) {
        await assertRow(partIn(page, c, dialect), c, dialect)
      }
    }
  })

  for (const c of CASES.filter((row) => row.isolate)) {
    for (const dialect of ["bare", "plain", "tw"] as const) {
      test(`${c.id} (${dialect})`, async ({ page }) => {
        await openIsolated(page, c, dialect)
        await assertRow(partIn(page, c, dialect), c, dialect)
      })
    }
  }
})

/*
 * §7 ⚠︎: Tailwind v4 emits a theme variable only when something uses it. A Tailwind app
 * that sets `--color-surface` in `@theme` and never writes `bg-surface` must still get
 * the variable, or adaptv's menu reads an undefined token and paints nothing.
 *
 * Measured (Tailwind 4.2.4): a `var(--color-surface)` read anywhere in the same build
 * keeps the variable, under `@theme inline` too — adaptv's own layer rule is that read.
 * So this compiles exactly that app — Tailwind, adaptv's stylesheet, `@theme inline`,
 * no utilities at all — and paints a menu with the attributes the real Dropdown renders.
 */
test("a token set only in @theme reaches the dropdown menu", async ({
  page,
}) => {
  await page.goto("/lab/dropdown")
  await awaitClientHandover(page)
  await page.getByRole("button", { name: "Actions", exact: true }).click()
  const menu = page.locator(
    '[data-adaptv="dropdown"][data-part="content"]',
  )
  await menu.waitFor()
  const attrs = await menu.evaluate((el) =>
    [...el.attributes]
      .filter((a) => a.name.startsWith("data-"))
      .map((a) => `${a.name}="${a.value}"`)
      .join(" "),
  )

  const css = await compileTailwindApp(
    "@theme inline { --color-surface: var(--app-surface); }\n:root { --app-surface: rgb(1, 2, 3); }",
  )
  expect(css).not.toContain(".bg-surface")
  expect(css).toMatch(/--color-surface:\s*var\(--app-surface\)/)

  await page.setContent(
    `<!doctype html><style>${css}</style><div ${attrs}>menu</div>`,
  )
  expect(
    await page
      .locator("div")
      .first()
      .evaluate((el) => getComputedStyle(el).backgroundColor),
  ).toBe("rgb(1, 2, 3)")
})

const REPO = resolve(__dirname, "../..")

async function compileTailwindApp(theme: string): Promise<string> {
  const require = createRequire(resolve(__dirname, "../package.json"))
  const tailwindEntry = require.resolve("tailwindcss")
  const tailwindDir = resolve(dirname(tailwindEntry), "..")
  const { compile } = require(
    tailwindEntry,
  ) as typeof import("tailwindcss")
  const compiler = await compile(
    `@layer theme, base, adaptv, components, utilities;
@import "tailwindcss";
@import "${resolve(REPO, "src/styles/index.css")}";
${theme}`,
    {
      base: REPO,
      loadStylesheet: async (id: string, base: string) => {
        const path =
          id === "tailwindcss"
            ? resolve(tailwindDir, "index.css")
            : id.startsWith("tailwindcss/")
              ? resolve(tailwindDir, id.slice("tailwindcss/".length))
              : resolve(base, id)
        return {
          path,
          base: dirname(path),
          content: readFileSync(path, "utf8"),
        }
      },
    },
  )
  return compiler.build([])
}
