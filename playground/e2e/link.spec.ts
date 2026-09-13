import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Link & ExternalLink — what a headless browser can verify is the STRUCTURE both
 * components guarantee, which is most of their contract:
 *
 *   - Link renders a real <a href> whose href is the resolved route (SEO, ⌘-click
 *     and route preload all ride on the anchor being real, not a div);
 *   - a disabled Link stays an <a> but is untappable BY CONSTRUCTION — aria-disabled
 *     + tabindex=-1 — rather than by tearing the anchor down;
 *   - ExternalLink is a real <a> to the outside: target=_blank,
 *     rel="noopener noreferrer", tagged data-adaptv="external-link";
 *   - isExternalUrl() sorts every scheme the way both components branch on it.
 *
 * NOT here, on purpose: tap-navigation, the 300ms hold threshold, and smartBack's
 * pop-vs-push. Those fire through the shared gesture engine, which — exactly like
 * Checkbox/Switch — does not respond to Playwright's synthetic mouse/keyboard/
 * dispatched input; only a real finger or the OS drives it, so they are walked on
 * the simulator. (Separately: TanStack Router's PRELOAD path logs `_nonReactive`
 * here from a react-router/router-core version skew. It is caught and non-fatal,
 * orthogonal to these two components, and flagged for its own cleanup.)
 */

test.describe("Link & ExternalLink", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/link")
    await awaitClientHandover(page)
    await page.locator('a[data-adaptv="link"]').first().waitFor()
  })

  test("an in-app link is a real anchor to its resolved route", async ({
    page,
  }) => {
    const index = page.getByRole("link", { name: "to the testing index" })
    await expect(index).toHaveAttribute("href", "/lab")
    await expect(index).toHaveAttribute("data-adaptv", "link")
    // a router link, not an external hand-off
    await expect(index).not.toHaveAttribute("target", "_blank")
  })

  test("a disabled link stays an anchor but is untappable by construction", async ({
    page,
  }) => {
    const disabled = page.getByText("disabled — must not navigate")
    await expect(disabled).toHaveAttribute("aria-disabled", "true")
    await expect(disabled).toHaveAttribute("tabindex", "-1")
    // disabled is a behaviour, not a teardown — it is still a real <a>
    expect(await disabled.evaluate((el) => el.tagName)).toBe("A")
  })

  test("ExternalLink is a real anchor that opens outside the app", async ({
    page,
  }) => {
    const external = page.locator(
      'a[data-adaptv="external-link"][href="https://example.com"]',
    )
    await expect(external).toHaveAttribute("target", "_blank")
    await expect(external).toHaveAttribute("rel", "noopener noreferrer")

    // a mailto: is somebody else's app — still a real, external anchor
    await expect(
      page.locator('a[href="mailto:hello@example.com"]'),
    ).toHaveAttribute("data-adaptv", "external-link")
  })

  test("isExternalUrl classifies every scheme the components rely on", async ({
    page,
  }) => {
    // scope to the predicate's own section: the same URLs appear as visible link
    // text elsewhere on the page, so an unscoped match would be ambiguous
    const section = page.locator("section").filter({
      has: page.getByRole("heading", { name: "isExternalUrl()" }),
    })

    const expectRow = (url: string, verdict: "true" | "false") =>
      expect(
        section.getByText(url, { exact: true }).locator(".."),
      ).toContainText(verdict)

    await expectRow("https://example.com", "true")
    await expectRow("mailto:hello@example.com", "true")
    await expectRow("tel:+15550100", "true")
    await expectRow("/lab/link", "false")
  })
})
