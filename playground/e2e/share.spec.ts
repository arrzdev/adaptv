import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Share — what the web path reports, on both engines, and that the no-sheet case is
 * an outcome rather than an error.
 *
 * The two engines differ, and the spec asserts the difference instead of skipping
 * one of them: desktop Chromium has no `navigator.share`, Playwright's WebKit has it
 * on macOS and not on Linux, where CI runs (WebKit 26.5, measured 2026-10-06).
 * So the premise is read from the page and pinned per engine first — if either
 * engine ever changes, that line fails and names it, rather than the support badge
 * silently agreeing with a different world.
 *
 * The documented fallback is the no-sheet case: `share()` resolves `"unsupported"`
 * and never rejects for it. Chromium gives that for free; on WebKit the API is
 * removed before any page script runs, so both engines walk the same path. The
 * sheet itself is not opened here — a real share sheet is an OS surface, walked on
 * the simulator.
 */

const ENGINE_HAS_WEB_SHARE: Record<string, boolean> = {
  chromium: false,
  webkit: process.platform === "darwin",
}

const row = (page: Page, label: string) =>
  page.getByText(label, { exact: true }).locator("..")

test.describe("Share on the web", () => {
  test("the support badge reports the engine's own Web Share", async ({
    page,
    browserName,
  }) => {
    await page.goto("/lab/share")
    await awaitClientHandover(page)

    const hasShare = await page.evaluate(
      () => typeof navigator.share === "function",
    )
    expect(hasShare, `navigator.share on ${browserName}`).toBe(
      ENGINE_HAS_WEB_SHARE[browserName],
    )

    await expect(
      page.getByText(
        hasShare
          ? "Share sheet available"
          : "No share sheet on this target",
        { exact: true },
      ),
    ).toBeVisible()
  })

  test("with no navigator.share, sharing resolves `unsupported` and raises nothing", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      //WebKit defines both on the prototype; Chromium defines neither
      delete (Navigator.prototype as { share?: unknown }).share
      delete (Navigator.prototype as { canShare?: unknown }).canShare
    })
    await page.goto("/lab/share")
    await awaitClientHandover(page)
    expect(
      await page.evaluate(() => typeof navigator.share === "undefined"),
    ).toBe(true)

    await expect(
      page.getByText("No share sheet on this target", { exact: true }),
    ).toBeVisible()
    for (const payload of [
      "text only",
      "title + text + url",
      "a text file",
    ]) {
      await expect(row(page, payload)).toContainText("refused")
    }

    await page.getByRole("button", { name: "Share text only" }).click()

    await expect(row(page, "last outcome")).toContainText("unsupported")
    await expect(row(page, "error")).toContainText("not reported here")
  })
})
