import { dirname, join } from "node:path"
import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import {
  declaredRoutes,
  parseSource,
  readDeclaredRoutes,
  readVisits,
  specVisits,
} from "./support/route-inventory"

/*
 * The lab inventory — every route the playground declares is walked by some spec.
 *
 * The suite grew one spec per component, and a lab page with no spec of its own was
 * never loaded by anything: it could throw on mount, log a hydration error on every
 * load, or 404 after a rename, and CI stayed green because no test ever asked for
 * it. `capabilities-smoke.spec.ts` closed that for the capability pages by listing
 * them; nothing closed it for the rest, and nothing noticed when a new route was
 * added without a visit.
 *
 * So this spec has two halves. The GUARD reads the route config and every spec
 * source under `e2e/` and `e2e-sw/` (see `support/route-inventory.ts` for what
 * counts as a visit) and fails naming each declared route no spec navigates to —
 * a new page without a visit, or a visit deleted from an existing spec. A route
 * that genuinely cannot be walked in a browser goes in {@link NOT_WALKED} with its
 * reason, and nowhere else. The MOUNT half walks the pages nothing else walks, with
 * the same error bar as the capabilities smoke: no uncaught error and no
 * `console.error` from before the navigation to the end of the test.
 */

/**
 * Declared routes that no spec visits, on purpose. One line of reason each; the
 * guard fails on an entry that is not a declared route or that some spec does visit,
 * so this cannot quietly turn into a list of everything nobody got round to.
 */
const NOT_WALKED: Record<string, string> = {}

/**
 * The pages no other spec walks, with the `<h1>` each one renders. Declared as a
 * literal on purpose: the guard reads this list like any other spec's, so a page
 * belongs here because someone decided it does — deriving it from the guard's own
 * answer would make the guard pass by construction.
 */
const UNWALKED = [
  ["/lab/pressable", "Pressable"],
  ["/lab/app-feel", "App feel"],
  ["/lab/cascade-layers", "Cascade layers"],
  ["/lab/ota", "OTA & the store gap"],
] as const

/**
 * Console errors the mount checks do NOT fail on. Same rule as the capabilities
 * smoke: each entry is an understood error with its reason, no wildcard. Empty,
 * because a run of these pages on both engines logged none.
 */
const KNOWN_CONSOLE_ERRORS: { pattern: RegExp; reason: string }[] = []

/** Collect uncaught errors and console errors; attach BEFORE the navigation. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", (error) =>
    errors.push(`uncaught: ${String(error)}`),
  )
  page.on("console", (message) => {
    if (message.type() !== "error") return
    const text = message.text()
    if (!KNOWN_CONSOLE_ERRORS.some(({ pattern }) => pattern.test(text)))
      errors.push(`console.error: ${text}`)
  })
  return errors
}

test.describe("route inventory guard", () => {
  test("every declared route is visited by a spec or listed as not walked", () => {
    const root = dirname(test.info().config.configFile ?? "")
    const routes = readDeclaredRoutes(
      join(root, "apps/frontend/src/routing/config.ts"),
    )
    const { visits, unresolved } = readVisits(
      root,
      ["e2e", "e2e-sw"],
      routes,
    )
    //a parser that finds nothing would pass everything below vacuously
    expect(
      routes.length,
      "no routes read from the config",
    ).toBeGreaterThan(10)

    const visited = (path: string) =>
      visits.filter(
        (visit) =>
          routes.find(({ matcher }) => matcher.test(visit.path))?.path ===
          path,
      )
    const missing = routes
      .map(({ path }) => path)
      .filter(
        (path) => !(path in NOT_WALKED) && visited(path).length === 0,
      )
    expect(
      missing,
      "declared routes no spec navigates to — add a visit (a spec, or a row in " +
        "UNWALKED here) or a NOT_WALKED entry with its reason.\n" +
        "Navigations the guard could not resolve to a path (their callers are " +
        `counted instead):\n${unresolved.map((u) => `  ${u.where}  ${u.call}`).join("\n")}`,
    ).toEqual([])

    const declared = new Set(routes.map(({ path }) => path))
    const stale = Object.keys(NOT_WALKED).filter(
      (path) => !declared.has(path) || visited(path).length > 0,
    )
    expect(
      stale,
      "NOT_WALKED entries that are not declared routes, or that a spec visits",
    ).toEqual([])
    const renamed = UNWALKED.map(([path]) => path).filter(
      (path) => !declared.has(path),
    )
    expect(renamed, "UNWALKED rows that are not declared routes").toEqual(
      [],
    )
  })

  test("the matching counts navigations, not mentions", () => {
    //the guard is only as honest as this: params and splats match concrete paths,
    //a query/hash/trailing slash does not hide a visit, and a path that is merely
    //WRITTEN in a spec (an expected href, a log row) is not a visit
    const routes = declaredRoutes(
      parseSource(
        "config.ts",
        `export const routes = rootRoute([
          layout("shell", "layouts/shell.tsx", [
            index("pages/home.tsx"),
            route("/posts", "pages/posts.tsx", [
              route("/$postId", "pages/post.tsx"),
            ]),
            route("/files/$", "pages/files.tsx"),
            route("/group", [route("/leaf", "pages/leaf.tsx")]),
            route("/mentioned", "pages/mentioned.tsx"),
            route("/ambiguous-a", "pages/a.tsx"),
            route("/ambiguous-b", "pages/b.tsx"),
          ]),
        ])`,
      ),
    )
    expect(routes.map(({ path }) => path)).toEqual([
      "/",
      "/ambiguous-a",
      "/ambiguous-b",
      "/files/$",
      "/group/leaf",
      "/mentioned",
      "/posts",
      "/posts/$postId",
    ])

    const { visits } = specVisits(
      parseSource(
        "fixture.spec.ts",
        `const POST = "/posts/42/?tab=comments#top"
        const ROWS = [["/files/a/b.txt", "Files"], ["/group/leaf/", "Leaf"]] as const
        test("x", async ({ page }) => {
          await page.goto(POST)
          for (const [route, title] of ROWS) await page.goto(route)
          await expect(page).toHaveURL(/\\/$/)
          await expect(page).toHaveURL(/ambiguous/)
          await expect(link).toHaveAttribute("href", "/mentioned")
          expectRow("/mentioned", "false")
        })`,
      ),
      "fixture.spec.ts",
      routes,
    )
    const hit = routes
      .filter(({ matcher }) => visits.some((v) => matcher.test(v.path)))
      .map(({ path }) => path)
    expect(hit).toEqual(["/", "/files/$", "/group/leaf", "/posts/$postId"])
  })
})

test.describe("pages no other spec walks mount clean", () => {
  for (const [route, title] of UNWALKED) {
    test(`${route} mounts with no page error and no console.error`, async ({
      page,
    }) => {
      const errors = collectErrors(page)
      await page.goto(route)
      await awaitClientHandover(page)
      await expect(
        page.getByRole("heading", { level: 1, name: title }),
      ).toBeVisible()
      //the pages that measure themselves after mount read "measuring…" /
      //"reading…" until their effects ran — an error from an effect lands before
      //these go, so the error read below is not taken mid-mount
      await expect(page.getByText(/^(measuring|reading)…$/)).toHaveCount(0)
      expect(errors, `error on ${route}:\n${errors.join("\n")}`).toEqual(
        [],
      )
    })
  }
})

/*
 * `/lab/app-feel` documents three `<html>` stamps and what each turns off. The
 * playground's `adaptv.config.ts` sets no `ui`, so the defaults decide
 * (`UI_SCOPE_DEFAULTS`, src/utils/platform.ts): `noSelect` and `touchCallout` are
 * "app" — stamped only in an installed app — and `hideScrollbars` is "all". Each
 * stamp is checked on the elements the page points at, by computed style, in a
 * browser tab and in a tab claiming to be installed (`navigator.standalone`, the
 * one installed signal a headless tab can be given — see edge-swipe.spec.ts).
 *
 * `-webkit-touch-callout` is iOS WebKit only: neither Playwright engine parses it
 * (`CSS.supports` is false on both), so its computed half is asserted only where
 * the engine supports it, and the stamp is what is checked everywhere else. The
 * long-press sheet itself stays a simulator walk.
 */
test.describe("app-feel stamps take effect", () => {
  const cases = [
    {
      name: "a browser tab",
      installed: false,
      stamps: {
        "data-adaptv-no-select": false,
        "data-adaptv-hide-scrollbars": true,
        "data-adaptv-no-touch-callout": false,
      },
    },
    {
      name: "an installed app",
      installed: true,
      stamps: {
        "data-adaptv-no-select": true,
        "data-adaptv-hide-scrollbars": true,
        "data-adaptv-no-touch-callout": true,
      },
    },
  ] as const

  for (const { name, installed, stamps } of cases) {
    test(`in ${name}`, async ({ page }) => {
      const errors = collectErrors(page)
      if (installed)
        await page.addInitScript(() => {
          Object.defineProperty(window.navigator, "standalone", {
            value: true,
            configurable: true,
          })
        })
      await page.goto("/lab/app-feel")
      await awaitClientHandover(page)
      await expect(page.getByText("reading…")).toHaveCount(0)
      expect(
        await page.evaluate(
          () => document.documentElement.dataset.adaptvPlatform,
        ),
        "the platform did not resolve as the case claims — the gate under test is off",
      ).toBe(installed ? "standalone" : "web")

      const html = page.locator("html")
      for (const [attr, on] of Object.entries(stamps)) {
        if (on) await expect(html).toHaveAttribute(attr, "")
        else await expect(html).not.toHaveAttribute(attr)
        //the page's own readout must agree with the attribute it reports
        await expect(
          page.getByText(attr, { exact: true }).locator("xpath=.."),
        ).toContainText(on ? "stamped" : "absent")
      }

      //WebKit exposes only the prefixed property; Chromium both
      const userSelect = (locator: ReturnType<Page["locator"]>) =>
        locator.evaluate((el) => {
          const style = getComputedStyle(el) as CSSStyleDeclaration & {
            webkitUserSelect?: string
          }
          return style.userSelect || style.webkitUserSelect
        })

      const paragraph = page.getByText(
        "In a browser tab the default leaves selection alone",
      )
      const selectable = page.locator("p.selectable")
      const field = page.locator('input[type="text"]')
      const graphic = page.getByRole("img", { name: "A test graphic" })
      const scrollBox = page
        .getByText("Line one — scroll me and watch the gutter.")
        .locator("xpath=..")
      const link = page.locator('a[href="https://example.com"]')

      //noSelect: the plain paragraph follows the stamp; the `selectable` utility,
      //text fields and media do not
      if (stamps["data-adaptv-no-select"])
        expect(await userSelect(paragraph)).toBe("none")
      else expect(await userSelect(paragraph)).not.toBe("none")
      expect(await userSelect(selectable)).not.toBe("none")
      expect(await userSelect(field)).not.toBe("none")
      expect(await userSelect(graphic)).toBe("none")

      //hideScrollbars: the scroll box really overflows, and has no scrollbar
      expect(
        await scrollBox.evaluate(
          (el) => el.scrollHeight > el.clientHeight,
        ),
        "the scroll box does not overflow, so a hidden scrollbar proves nothing",
      ).toBe(true)
      expect(
        await scrollBox.evaluate(
          (el) => getComputedStyle(el).scrollbarWidth,
        ),
      ).toBe(stamps["data-adaptv-hide-scrollbars"] ? "none" : "auto")

      //touchCallout: computed where the engine has the property at all
      const callout = await link.evaluate((el) =>
        CSS.supports("-webkit-touch-callout", "none")
          ? getComputedStyle(el).getPropertyValue("-webkit-touch-callout")
          : null,
      )
      if (callout === null)
        test.info().annotations.push({
          type: "not measurable",
          description:
            "-webkit-touch-callout is not a property this engine parses; the stamp was checked, the effect is a simulator walk",
        })
      else if (stamps["data-adaptv-no-touch-callout"])
        expect(callout).toBe("none")
      else expect(callout).not.toBe("none")

      expect(errors, errors.join("\n")).toEqual([])
    })
  }
})
