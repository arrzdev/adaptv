import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Compose — a mail or SMS draft handed to the OS composer through a mailto: or
 * sms: URL. On the web the module cannot ask whether a handler exists (support
 * reads `unknown` for both kinds), builds the URL, and hands it to
 * `window.open(url, "_self")`. That call is what a headless browser cannot follow
 * — the navigation leaves the page for a scheme Playwright has no handler for —
 * so the spec REPLACES `window.open` before the page loads and reads back what
 * the module handed it: the exact URL and the exact target. The page's own rows
 * are the second witness: the outcome badge and the URL row must agree with the
 * intercept.
 */

type Opened = { url: string; target?: string }
/** The page's window, with the intercept the init script installs on it. */
type Intercepted = Window & { __opened: Opened[] }

const MAIL_URL =
  "mailto:support@example.com?subject=Hello%20from%20the%20lab&body=first%20line%0Asecond%20line"

/**
 * The SMS URL per engine. The body separator is the one thing that varies:
 * `?body=` is what Android and every desktop browser take, `&body=` is what iOS
 * needs — and the module picks it with `isIOS()`, which reads the USER AGENT,
 * not the native bridge, because iOS Safari wants the `&` form as much as the
 * iOS WebView does. The webkit project runs on the iPhone 13 device descriptor,
 * whose user agent says iPhone, so webkit takes the iOS branch. Both values
 * below are MEASURED on their engine, not derived.
 */
const SMS_URL: Record<string, string> = {
  //Desktop Chrome descriptor: not iOS, so the `?` form.
  chromium: "sms:+15550001?body=first%20line%0Asecond%20line",
  //iPhone 13 descriptor: `isIOS()` matches `/iPhone/` in the user agent, so the
  //module builds the `&` form here exactly as it would in Mobile Safari. If this
  //ever reads `?`, the module stopped keying on the user agent — which would
  //break real iOS Safari, not just this project.
  webkit: "sms:+15550001&body=first%20line%0Asecond%20line",
}

test.describe("Compose", () => {
  test.beforeEach(async ({ page }) => {
    //BEFORE goto: the module calls window.open synchronously from the click,
    //and a replacement installed after load would still intercept — but one
    //installed before guarantees no navigation to a scheme the harness cannot
    //follow ever fires, on either engine.
    await page.addInitScript(() => {
      const w = window as unknown as Intercepted
      w.__opened = []
      w.open = (url?: string | URL, target?: string) => {
        w.__opened.push({ url: String(url), target })
        return null
      }
    })
    await page.goto("/lab/compose")
    await awaitClientHandover(page)
  })

  const opened = (page: Page) =>
    page.evaluate(() => (window as unknown as Intercepted).__opened)

  test("support reads unknown for both kinds and nothing has been composed", async ({
    page,
  }) => {
    await expect(page.getByTestId("compose-mail-support")).toHaveText(
      "unknown",
      { timeout: 5_000 },
    )
    await expect(page.getByTestId("compose-sms-support")).toHaveText(
      "unknown",
      { timeout: 5_000 },
    )
    await expect(page.getByTestId("compose-last")).toHaveText("—")
    await expect(page.getByTestId("compose-url")).toHaveText("—")
    expect(await opened(page)).toEqual([])
  })

  test("compose mail hands the exact mailto: to window.open in _self", async ({
    page,
  }) => {
    await page.getByTestId("compose-mail").click()

    await expect(page.getByTestId("compose-last")).toHaveText("opened")
    await expect(page.getByTestId("compose-url")).toHaveText(MAIL_URL)
    expect(await opened(page)).toEqual([
      { url: MAIL_URL, target: "_self" },
    ])
  })

  test("compose sms hands the exact sms: to window.open in _self", async ({
    page,
    browserName,
  }) => {
    const expected = SMS_URL[browserName]
    if (expected === undefined) {
      throw new Error(`no pinned sms: URL for engine ${browserName}`)
    }

    await page.getByTestId("compose-sms").click()

    await expect(page.getByTestId("compose-last")).toHaveText("opened")
    await expect(page.getByTestId("compose-url")).toHaveText(expected)
    expect(await opened(page)).toEqual([
      { url: expected, target: "_self" },
    ])
  })
})
