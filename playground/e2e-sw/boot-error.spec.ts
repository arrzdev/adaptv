import type { Page, Route } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { RENDER } from "./sw"

/*
 * The boot fallback, in a real browser, on a real build. → rendering.md §3.1.3
 *
 * The one screen that has to survive its own bundle being broken, and until now
 * the only proof it did was `src/shell/boot-failure.test.ts` — happy-dom, a
 * hand-dispatched `error` event, and `location.reload` stubbed. Everything that
 * makes it work in a browser went unmeasured: that the watchdog in the head
 * really hears a module script fail, that the prerendered markup is really in
 * the emitted document, that its button really reloads, and that the reload
 * really lands on a working app once the failure is gone.
 *
 * It lives in THIS suite because the fallback only exists in a BUILT shell: the
 * `vite` dev server behind `e2e/` serves Start's own document, which carries no
 * watchdog and no prerendered screen (`src/vite/shell-emit.ts` is build-only).
 *
 * The trigger is the real one — the entry `<script type="module">` failing. The
 * one thing arranged by hand is WHICH document the navigation gets, because
 * neither preview server hands out the emitted shell on its own:
 *
 * - `spa`: a static host answers every path with `index.html` (the emitted
 *   `_redirects` / `404.html` say so), but `vite preview` answers with Start's
 *   own `_shell.html`, which carries no watchdog — measured: `/` and `/lab` both
 *   come back without `#adaptv-boot-fallback`, `/index.html` with it.
 * - `ssr`: the server renders documents, and the shell is what the service
 *   worker answers a navigation with when the network cannot
 *   (`adaptv-shell.html`). That delivery is `offline.spec.ts`'s subject.
 *
 * So the navigation is answered with the shell's own bytes, fetched from the
 * build, and the worker is blocked so the routes below are the only thing
 * between the page and the server.
 *
 * The screen under test is the playground's `bootErrorScreen`
 * (`src/components/boot-error-screen.tsx`), which branches its copy on `code` —
 * so a pass also proves the per-code variants were prerendered and the watchdog
 * revealed the matching one.
 */

test.use({ serviceWorkers: "block" })

const SHELL = RENDER === "spa" ? "/index.html" : "/adaptv-shell.html"
const FALLBACK = "#adaptv-boot-fallback"

type Failure = "not-served" | "throws"

/** Read the entry chunk's URL out of the emitted shell, the way the browser will. */
async function entryPath(page: Page): Promise<string> {
  const response = await page.request.get(SHELL)
  expect(response.ok(), `${SHELL} must exist in this build`).toBe(true)
  const html = await response.text()
  const entry = html.match(
    /<script type="module" src="([^"]+)"><\/script>/,
  )
  expect(entry, "the shell must load one module entry").not.toBeNull()
  expect(html, "the shell must carry the prerendered fallback").toContain(
    'id="adaptv-boot-fallback"',
  )
  return (entry as RegExpMatchArray)[1]
}

/**
 * Break the entry — and keep it broken until `heal()` — counting every request for
 * it, which is the proof a retry really re-ran the document rather than doing
 * nothing that looks the same.
 */
async function breakEntry(page: Page, failure: Failure) {
  const entry = await entryPath(page)
  let requests = 0
  const handler = (route: Route) => {
    requests++
    return failure === "not-served"
      ? route.fulfill({ status: 404, body: "gone" })
      : route.fulfill({
          contentType: "text/javascript",
          body: 'throw new Error("e2e: this bundle is broken")',
        })
  }
  const matches = (url: URL) => url.pathname === entry
  await page.route(matches, handler)

  //the document a static host or the worker would answer `/` with — see above
  await page.route(
    (url) => url.pathname === "/",
    async (route) =>
      route.fulfill({
        response: await route.fetch({
          url: new URL(SHELL, route.request().url()).href,
        }),
      }),
  )

  return {
    requests: () => requests,
    heal: () => page.unroute(matches, handler),
  }
}

/**
 * The app booted: the tasks screen is up and working, the launch splash has left,
 * and nothing of the failure is left on the document.
 *
 * Not `#root` — the client renders the whole document, so the shell's mount
 * point (and the hidden fallback beside it) is replaced rather than filled.
 * `toBeHidden` passes for a fallback that is gone as well as one re-hidden.
 */
async function expectBooted(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Your tasks" }),
  ).toBeVisible({ timeout: 20_000 })
  await expect(page.locator("[data-adaptv-splash]")).toHaveCount(0, {
    timeout: 20_000,
  })
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-adaptv-boot-failed",
  )
  await expect(page.locator(FALLBACK)).toBeHidden()
}

/**
 * Exactly one prerendered variant is showing, and it is `code`'s. The playground's
 * screen branches on the code, so the four renders differ and all four ship.
 */
async function expectOnlyVariant(page: Page, code: string) {
  const shown = page.locator(
    `${FALLBACK} [data-adaptv-boot-code]:not([hidden])`,
  )
  await expect(shown).toHaveCount(1)
  await expect(shown).toHaveAttribute("data-adaptv-boot-code", code)
  await expect(
    page.locator(`${FALLBACK} [data-adaptv-boot-code]`),
  ).toHaveCount(4)
}

/** What a finger lands on at the centre of the screen. */
function centreIsFallback(page: Page) {
  return page.evaluate(
    (selector) =>
      !!document
        .elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
        ?.closest(selector),
    FALLBACK,
  )
}

test.describe(`boot fallback (render: ${RENDER})`, () => {
  test("an entry that is not served shows BOOT-LOAD, and retry recovers once it is", async ({
    page,
  }) => {
    const entry = await breakEntry(page, "not-served")
    await page.goto("/")

    const fallback = page.locator(FALLBACK)
    await expect(fallback).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute(
      "data-adaptv-boot-failed",
      "BOOT-LOAD",
    )
    //the app's copy for THIS code — and only this code's variant is revealed
    await expect(
      fallback.getByRole("heading", { name: "We can't reach ChopChop" }),
    ).toBeVisible()
    await expect(fallback.getByText("Error BOOT-LOAD")).toBeVisible()
    await expectOnlyVariant(page, "BOOT-LOAD")
    //nothing mounted, and nothing else is reachable
    expect(
      await page.locator("#root").evaluate((r) => r.childElementCount),
    ).toBe(0)
    expect(await centreIsFallback(page)).toBe(true)

    //While the failure persists, retry reloads into the same screen. The request
    //count is what separates "reloaded and failed again" from "did nothing".
    const reload = fallback.getByRole("button", { name: "Reload" })
    expect(entry.requests()).toBe(1)
    await reload.click()
    await expect.poll(entry.requests).toBe(2)
    await expect(page.locator("html")).toHaveAttribute(
      "data-adaptv-boot-failed",
      "BOOT-LOAD",
    )
    await expect(fallback).toBeVisible()

    //The deploy finishes rolling out. The same button is the way back.
    await entry.heal()
    await reload.click()
    await expectBooted(page)
    expect(await centreIsFallback(page)).toBe(false)
  })

  test("an entry that throws shows BOOT-THROW's copy, and retry recovers", async ({
    page,
  }) => {
    const entry = await breakEntry(page, "throws")
    await page.goto("/")

    const fallback = page.locator(FALLBACK)
    await expect(fallback).toBeVisible()
    await expect(page.locator("html")).toHaveAttribute(
      "data-adaptv-boot-failed",
      "BOOT-THROW",
    )
    await expect(
      fallback.getByRole("heading", { name: "ChopChop hit a bad update" }),
    ).toBeVisible()
    await expect(fallback.getByText("Error BOOT-THROW")).toBeVisible()
    await expectOnlyVariant(page, "BOOT-THROW")

    await entry.heal()
    await fallback.getByRole("button", { name: "Reload" }).click()
    await expectBooted(page)
  })
})
