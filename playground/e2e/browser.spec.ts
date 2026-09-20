import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Browser — what external navigation does on the web path, on both engines.
 *
 * `openExternal()` resolves an outcome and never rejects: `opened`, `blocked` (the
 * browser refused the tab), `invalid` (the URL does not parse, or is a scheme that
 * would run in or replace the app). This spec pins each through the lab page's
 * outcome row, and pins what the new tab can learn about the app: no `opener` and no
 * Referer, neither in the request header nor in `document.referrer`. A `mailto:` is
 * handed to the system through `location`, never `window.open`, and the page stays.
 *
 * The Referer half is only a real check if the app's policy WOULD leak. The default
 * (`strict-origin-when-cross-origin`) sends the origin alone, so a regression that
 * sends a Referer again could still pass a "no query string" assertion. The lab
 * document is therefore given an `unsafe-url` referrer policy and a `?secret=`, and
 * every test first proves that a plain request from the page does carry the full
 * URL — so a missing Referer on the tab is the accessor's doing, not the policy's.
 *
 * Two blockers. Playwright's default Chromium is the headless shell, which has no
 * popup blocker at all, even with `--disable-popup-blocking` dropped; the full
 * Chromium build (`channel: "chromium"`) does, and the last describe uses it — a real
 * click must still open the tab with the blocker on, and a call made once the page's
 * user activation has expired must read `blocked`. Playwright's WebKit exposes no
 * blocker to turn on, so the stubbed case (`window.open` returning `null`, the only
 * signal a blocker ever gives a page) runs on both engines and the real one on
 * Chromium only.
 *
 * `example.com` is answered locally by a context route, so nothing leaves the
 * machine; the tab's requests go through the context, so the route sees them.
 */

const SECRET = "tok-9f2"
const DESTINATION = "https://example.com/"

/** What the destination's first script saw — before anything else could run. */
const DESTINATION_HTML =
  "<!doctype html><head><script>window.firstScript = { opener: window.opener !== null, referrer: document.referrer }</script></head><body>stand-in for example.com</body>"

type Seen = { url: string; referer: string | null }

/**
 * Open the lab page with the most permissive referrer policy there is, answer
 * example.com locally from then on, and return the Referer each of its requests
 * carried.
 *
 * Both are set up only once the app has taken over. Any route makes Chromium send
 * every request through Playwright with the HTTP cache off, and the dev server's
 * hundreds of unbundled modules then load slowly enough to trip the hydration
 * gate. A `<meta name="referrer">` inserted into the document changes its policy on
 * the spot, so the policy needs no route at all.
 */
async function openLab(page: Page): Promise<Seen[]> {
  await page.goto(`/lab/browser?secret=${SECRET}`)
  await awaitClientHandover(page)

  const seen: Seen[] = []
  await page.context().route(`${DESTINATION}**`, async (route) => {
    const request = route.request()
    seen.push({
      url: request.url(),
      referer: await request.headerValue("referer"),
    })
    return route.fulfill({
      contentType: "text/html",
      body: DESTINATION_HTML,
    })
  })
  await page.evaluate(() => {
    const meta = document.createElement("meta")
    meta.name = "referrer"
    meta.content = "unsafe-url"
    document.head.append(meta)
  })

  //the premise: under this policy an ordinary request from the app leaks its URL
  await page.evaluate(
    (url) => fetch(url, { mode: "no-cors" }),
    `${DESTINATION}control`,
  )
  expect(
    seen.find((s) => s.url.endsWith("/control"))?.referer,
    "the unsafe-url premise did not hold, so a missing Referer would prove nothing",
  ).toContain(`secret=${SECRET}`)
  return seen
}

const lastOutcome = (page: Page) =>
  page
    .getByText("last outcome", { exact: true })
    .locator("xpath=following-sibling::*[1]")

const openButton = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true })

test.describe("openExternal on the web", () => {
  test("opens a tab at the URL with no opener and no Referer, and reports `opened`", async ({
    page,
  }) => {
    const seen = await openLab(page)
    await expect(lastOutcome(page)).toHaveText("not attempted yet")

    const popup = page.waitForEvent("popup")
    await openButton(page, "https://example.com").click()
    const tab = await popup

    await tab.waitForURL(DESTINATION)
    await expect(lastOutcome(page)).toHaveText("opened")
    //the header first: it is what reaches the other site
    expect(seen.filter((s) => s.url === DESTINATION)).toEqual([
      { url: DESTINATION, referer: null },
    ])
    expect(await tab.evaluate(() => window.firstScript)).toEqual({
      opener: false,
      referrer: "",
    })
  })

  test("hands mailto: to the system through location: no window.open, the app stays, and it reads `opened`", async ({
    page,
    browserName,
  }) => {
    //a pass-through recorder: neither engine reports a popup for a mailto: tab (it
    //closes itself), so the call is the only trace a `window.open` hand-off leaves
    await page.addInitScript(() => {
      const open = window.open.bind(window)
      window.openCalls = []
      window.open = (...args: Parameters<typeof window.open>) => {
        window.openCalls?.push(String(args[0]))
        return open(...args)
      }
    })
    await openLab(page)
    const url = page.url()
    //Chromium surfaces a location hand-off as an aborted request; WebKit shows nothing
    const handedOver =
      browserName === "chromium"
        ? page.waitForRequest((request) =>
            request.url().startsWith("mailto:"),
          )
        : null

    await openButton(page, "mailto:").click()

    await expect(lastOutcome(page)).toHaveText("opened")
    expect(await page.evaluate(() => window.openCalls)).toEqual([])
    if (handedOver) {
      expect((await handedOver).url()).toBe("mailto:hello@example.com")
    }
    expect(page.url()).toBe(url)
  })

  test("an unparseable URL reads `invalid`, opens nothing, and raises nothing", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(String(error)))
    await openLab(page)
    const popups: Page[] = []
    page.on("popup", (tab) => popups.push(tab))

    await openButton(page, "https:// (unparseable)").click()

    await expect(lastOutcome(page)).toHaveText("invalid")
    expect(errors).toEqual([])
    expect(popups).toEqual([])
  })

  test("a popup `window.open` refuses reads `blocked`, not success", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.open = () => null
    })
    await openLab(page)
    const popups: Page[] = []
    page.on("popup", (tab) => popups.push(tab))

    await openButton(page, "https://example.com").click()

    await expect(lastOutcome(page)).toHaveText("blocked")
    expect(popups).toEqual([])
  })
})

test.describe("ExternalLink on the web", () => {
  test("lets its own anchor open the tab: nothing intercepted, no Referer, no opener", async ({
    page,
  }) => {
    const seen = await openLab(page)
    //a document listener runs after React's root listener, so it sees whether the
    //component took the click away from the anchor
    await page.evaluate(() => {
      document.addEventListener("click", (event) => {
        window.clickPrevented = event.defaultPrevented
      })
    })

    const popup = page.waitForEvent("popup")
    await page.getByRole("link", { name: "Open example.com" }).click()
    const tab = await popup

    await tab.waitForURL(DESTINATION)
    //the header first: it is what reaches the other site
    expect(seen.filter((s) => s.url === DESTINATION)).toEqual([
      { url: DESTINATION, referer: null },
    ])
    expect(await tab.evaluate(() => window.firstScript)).toEqual({
      opener: false,
      referrer: "",
    })
    expect(await page.evaluate(() => window.clickPrevented)).toBe(false)
  })
})

/*
 * Full Chromium with its popup blocker left on. `channel` and launch arguments
 * cannot be `test.use`d inside a describe (they force a new worker), and top-level
 * they would reach the WebKit project too, so the browser is launched in the test.
 * One test, one extra browser: the real click and the expired call share it.
 */
test.describe("openExternal under a real popup blocker", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "only full Chromium exposes a popup blocker under Playwright; WebKit is covered by the stubbed case",
  )

  test("a real click opens the tab, and a call after the user activation expired reads `blocked`", async ({
    playwright,
    baseURL,
    viewport,
  }) => {
    //a second, full Chromium launched inside the test, plus a wait for the click's
    //activation to lapse: under a loaded suite that took past the 30 s default in
    //about one run in six, so the budget covers the launch, not a slow product
    test.setTimeout(60_000)
    const browser = await playwright.chromium.launch({
      channel: "chromium",
      ignoreDefaultArgs: ["--disable-popup-blocking"],
    })
    try {
      const context = await browser.newContext({ baseURL, viewport })
      const page = await context.newPage()
      await openLab(page)

      //the blocker is on, and a real click's activation still reaches `window.open`
      const popup = page.waitForEvent("popup")
      await openButton(page, "https://example.com").click()
      await (await popup).waitForURL(DESTINATION)
      await expect(lastOutcome(page)).toHaveText("opened")

      const popups: Page[] = []
      page.on("popup", (tab) => popups.push(tab))
      //Playwright's own `evaluate` grants the page a few seconds of activation, so
      //the wait for it to lapse happens inside the same call that then clicks — a
      //synthetic click, which carries no activation of its own
      const activeAtCall = await page.evaluate(async () => {
        while (navigator.userActivation.isActive) {
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
        const button = [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "https://example.com",
        )
        button?.click()
        return navigator.userActivation.isActive
      })
      //the premise: the call really was made without an activation
      expect(activeAtCall).toBe(false)

      await expect(lastOutcome(page)).toHaveText("blocked")
      expect(popups).toEqual([])
    } finally {
      await browser.close()
    }
  })
})

declare global {
  interface Window {
    firstScript?: { opener: boolean; referrer: string }
    clickPrevented?: boolean
    openCalls?: string[]
  }
}
