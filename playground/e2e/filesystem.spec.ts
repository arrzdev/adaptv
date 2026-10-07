import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Filesystem — the web tier is OPFS. Chromium round-trips a file; Playwright's
 * WebKit 26.5 exposes both entry points and then rejects `getDirectory()`
 * itself (`UnknownError: The operation failed for an unknown transient
 * reason`), on a real http origin, before any file is touched — measured
 * 2026-09-02 with a step-by-step probe on macOS. The same WebKit 26.5 build on
 * Linux, where CI runs, has no `navigator.storage.getDirectory` at all
 * (measured 2026-10-06), so there the capability names the missing API rather
 * than a refusal. So the engines pin different truths: chromium the round trip,
 * webkit that the capability reports unsupported with the host's reason named,
 * and that every call after it answers unsupported rather than failing one by
 * one. The real WebKit on the iOS simulator is a device row, not this spec.
 */

const WEBKIT_CAVEAT =
  process.platform === "darwin"
    ? "refused to open it: UnknownError"
    : "This browser has no origin-private file system."

test.describe("Filesystem where WebKit refuses or lacks its root", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "webkit",
      "the refusal is Playwright WebKit's",
    )
    await page.goto("/lab/filesystem")
    await awaitClientHandover(page)
  })

  test("reports unsupported with the reason named, and every call answers unsupported", async ({
    page,
  }) => {
    await expect(page.getByTestId("fs-backend")).toHaveText("none")
    await expect(page.getByTestId("fs-caveat")).toContainText(
      WEBKIT_CAVEAT,
    )
    await page.getByRole("button", { name: "Run round trip" }).click()
    await expect(page.getByTestId("fs-readout")).toHaveText(
      "write unsupported · bytes-write unsupported · read unsupported · bytes 0/256 · list unsupported · stat unsupported · delete unsupported · bytes-delete unsupported · after unsupported",
    )
  })
})

test.describe("Filesystem on the web", () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "OPFS round-trips on chromium only",
    )
    await page.goto("/lab/filesystem")
    await awaitClientHandover(page)
  })

  test("reports the origin-private file system as its backend, with the caveat", async ({
    page,
  }) => {
    await expect(page.getByTestId("fs-backend")).toHaveText("opfs")
    await expect(page.getByTestId("fs-caveat")).toContainText(
      "origin-private",
    )
  })

  test("writes, reads, lists, stats and deletes with the status each step claims", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Run round trip" }).click()
    const readout = page.getByTestId("fs-readout")
    await expect(readout).not.toHaveText("not run yet")
    await expect(readout).toHaveText(
      "write written · bytes-write written · read ok 12 chars · bytes 256/256 · list ok 2 · stat ok 12 bytes · delete deleted · bytes-delete deleted · after missing",
    )
  })

  test("a note written before a reload is readable after it", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Write the note" }).click()
    await expect(page.getByTestId("fs-note")).toContainText("written")
    const stamp = (await page.getByTestId("fs-note").textContent())
      ?.replace("written ", "")
      .trim()
    await page.reload()
    await awaitClientHandover(page)
    await page.getByRole("button", { name: "Read the note" }).click()
    await expect(page.getByTestId("fs-note")).toHaveText(`ok ${stamp}`)
  })
})
