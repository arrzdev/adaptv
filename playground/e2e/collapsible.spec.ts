import type { Locator, Page } from "@playwright/test"
// biome-ignore lint/style/noRestrictedImports: e2e has no self-alias to import through
import { awaitClientHandover, expect, test } from "./client-handover"

/*
 * Collapsible — a disclosure whose whole contract is its PHASES:
 *
 *   closed at rest  → `hidden` (server: "", upgraded to "until-found" where the
 *                     engine has it), no data-collapsible-open, no inline height
 *   opening         → hidden gone, data-collapsible-open, data-collapsible-opening,
 *                     inline height 0 → measured px over --collapsible-duration
 *   open at rest    → NO inline height, no opening/closing attribute (later growth
 *                     is not clipped)
 *   closing         → data-collapsible-open gone, data-collapsible-closing, px → 0
 *                     and `hidden` ONLY after the transition settles
 *   reduced motion  → no opening/closing phase at all: one commit
 *   beforematch     → opens instantly, no transition (the browser's find-in-page path)
 *
 * The state is PRESENCE attributes (docs/decisions/styling.md §3.1), so every read
 * below is `getAttribute(...) !== null`, never a value compare.
 *
 * Every test here pins one of those phases in a real engine. Both projects run:
 * the `hidden` upgrade is the one place engines legitimately differ (the iOS 18
 * WebKit floor has no until-found; Playwright's desktop WebKit does), so the spec
 * reads the engine's own support bit and asserts the CORRECT answer for it rather
 * than pinning one value or skipping the difference.
 */

const NEEDLE = "until-found-needle-7f3a"
const PANEL = '[data-adaptv="collapsible-panel"]'
const TRIGGER = '[data-adaptv="collapsible-trigger"]'

/** The lab section under the given heading — the page's own structure, no test ids. */
const section = (page: Page, title: string): Locator =>
  page.locator("section").filter({
    has: page.getByRole("heading", { name: title, exact: true }),
  })

/** The value cell of a LabRow, found by its label — the innermost div holding both. */
const rowValue = (sec: Locator, label: string): Locator =>
  sec
    .locator("div")
    //`has` is resolved against each candidate, so the inner locator must be
    //page-rooted — chained off `sec` it would look for the section INSIDE the div
    .filter({ has: sec.page().getByText(label, { exact: true }) })
    .last()
    .locator("span")
    .last()

type Snapshot = {
  expanded: string | null
  hidden: string | null
  open: boolean
  phase: "opening" | "closing" | null
  inlineHeight: string
  clientHeight: number
}

/** One atomic read of a trigger + panel pair, so no field is a frame older than another. */
const snapshot = (sec: Locator): Promise<Snapshot> =>
  sec.evaluate(
    (root, selectors) => {
      const trigger = root.querySelector(selectors.trigger) as HTMLElement
      const panel = root.querySelector(selectors.panel) as HTMLElement
      return {
        expanded: trigger.getAttribute("aria-expanded"),
        hidden: panel.getAttribute("hidden"),
        open: panel.getAttribute("data-collapsible-open") !== null,
        phase:
          panel.getAttribute("data-collapsible-opening") !== null
            ? "opening"
            : panel.getAttribute("data-collapsible-closing") !== null
              ? "closing"
              : null,
        inlineHeight: panel.style.height,
        clientHeight: panel.clientHeight,
      }
    },
    { trigger: TRIGGER, panel: PANEL },
  )

/** Poll until no transition is running on the section's panel. */
async function awaitRest(sec: Locator) {
  await expect
    .poll(async () => (await snapshot(sec)).phase, {
      message: "the panel never left its transition phase",
    })
    .toBeNull()
}

test.describe("Collapsible", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/collapsible")
    await awaitClientHandover(page)
    await section(page, "Uncontrolled").locator(TRIGGER).waitFor()
  })

  test("server HTML carries the closed content under hidden", async ({
    page,
  }) => {
    const html = await (await page.request.get("/lab/collapsible")).text()
    expect(html, "the closed content is in the document").toContain(NEEDLE)
    // the needle's nearest `hidden` ancestor: from a tag carrying the attribute up
    // to the needle with no closing </div> in between (the panel wraps one padded
    // div, which wraps the paragraph). `hidden=""` is how React serialises `hidden`.
    expect(
      html,
      "the needle sits inside an element with `hidden`",
    ).toMatch(
      new RegExp(
        `<div[^>]*\\shidden(?:=""|(?=[\\s>]))[^>]*>(?:(?!</div>)[\\s\\S])*${NEEDLE}`,
      ),
    )
  })

  test("hidden is upgraded to until-found where the engine supports it", async ({
    page,
  }) => {
    const sec = section(page, "Find in page (until-found)")
    const supported = await page.evaluate(
      () => "onbeforematch" in document.body,
    )
    const hidden = await sec.locator(PANEL).getAttribute("hidden")
    test.info().annotations.push(
      { type: "hidden", description: JSON.stringify(hidden) },
      {
        type: "onbeforematch in document.body",
        description: String(supported),
      },
    )
    console.log(
      `[${test.info().project.name}] hidden=${JSON.stringify(hidden)} onbeforematch=${supported}`,
    )
    // closed at rest is hidden on EVERY engine — the upgrade only changes the value
    expect(
      hidden,
      "a closed panel at rest carries `hidden`",
    ).not.toBeNull()
    if (supported) expect(hidden).toBe("until-found")
  })

  test("opening animates a measured height and rests at auto", async ({
    page,
  }) => {
    const sec = section(page, "Uncontrolled")
    await sec.locator(TRIGGER).click()

    // the click handler's commit is synchronous: by the time click() returns the
    // panel is already unhidden and announced
    const first = await snapshot(sec)
    expect(first.expanded).toBe("true")
    expect(first.hidden).toBeNull()
    expect(first.open).toBe(true)

    // sample the height through the slide: it must only ever grow
    const heights: number[] = [first.clientHeight]
    for (let i = 0; i < 6; i += 1) {
      await page.waitForTimeout(45)
      heights.push((await snapshot(sec)).clientHeight)
    }
    for (let i = 1; i < heights.length; i += 1) {
      expect(
        heights[i],
        `height went backwards while opening: ${heights.join(" → ")}`,
      ).toBeGreaterThanOrEqual(heights[i - 1] as number)
    }

    // at rest: no inline height (so later growth is not clipped), no phase marker
    await awaitRest(sec)
    const rest = await snapshot(sec)
    expect(rest.inlineHeight).toBe("")
    expect(rest.phase).toBeNull()
    expect(rest.clientHeight).toBeGreaterThan(0)
    expect(rest.hidden).toBeNull()
  })

  test("closing adds hidden only after the height reaches 0", async ({
    page,
  }) => {
    const sec = section(page, "Uncontrolled")
    const trigger = sec.locator(TRIGGER)
    await trigger.click()
    await awaitRest(sec)

    await trigger.click()
    // closed for the accessibility tree at once, but still in the document while
    // the slide runs — `hidden` now would make it jump shut
    const closing = await snapshot(sec)
    expect(closing.expanded).toBe("false")
    expect(closing.open).toBe(false)
    expect(closing.hidden).toBeNull()

    // the first frame `hidden` appears on is the settled one: no inline height left
    let settled: Snapshot | null = null
    await expect
      .poll(
        async () => {
          settled = await snapshot(sec)
          return settled.hidden
        },
        { message: "the panel never became hidden after closing" },
      )
      .not.toBeNull()
    expect((settled as unknown as Snapshot).inlineHeight).toBe("")
    expect((settled as unknown as Snapshot).phase).toBeNull()
  })

  test("reduced motion flips in one commit", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    await page.reload()
    await awaitClientHandover(page)
    const sec = section(page, "Uncontrolled")
    const trigger = sec.locator(TRIGGER)
    await trigger.waitFor()

    await trigger.click()
    const opened = await snapshot(sec)
    expect(
      opened.phase,
      "no transition phase under reduced motion",
    ).toBeNull()
    expect(opened.expanded).toBe("true")
    expect(opened.hidden).toBeNull()
    expect(opened.inlineHeight).toBe("")
    expect(opened.clientHeight).toBeGreaterThan(0)

    await trigger.click()
    const closed = await snapshot(sec)
    expect(
      closed.phase,
      "no transition phase under reduced motion",
    ).toBeNull()
    expect(closed.expanded).toBe("false")
    expect(
      closed.hidden,
      "one commit: hidden lands with the state",
    ).not.toBeNull()
    expect(closed.inlineHeight).toBe("")
  })

  test("beforematch opens instantly and reports", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "a synthetic beforematch is pinned on the engine that fires the real one",
    )
    const found = section(page, "Find in page (until-found)")
    await page
      .getByRole("button", { name: "dispatch beforematch" })
      .click()

    // instant: no slide, already open for the tree and the eye
    const opened = await snapshot(found)
    expect(opened.expanded).toBe("true")
    expect(opened.hidden).toBeNull()
    expect(opened.phase).toBeNull()
    expect(opened.inlineHeight).toBe("")
    await expect(found.getByText(NEEDLE)).toBeVisible()

    // and the same open path reports through onOpenChange: the controlled
    // section's counter is the visible proof of the callback contract
    const controlled = section(page, "Controlled")
    const calls = () =>
      rowValue(controlled, "onOpenChange calls").innerText().then(Number)
    const before = await calls()
    await controlled.locator(TRIGGER).click()
    await expect.poll(calls).toBe(before + 1)
    await expect(controlled.locator(TRIGGER)).toHaveAttribute(
      "aria-expanded",
      "true",
    )
  })

  test("a double tap ends consistent", async ({ page }) => {
    const sec = section(page, "Uncontrolled")
    const trigger = sec.locator(TRIGGER)
    await trigger.click()
    await page.waitForTimeout(60)
    await trigger.click()

    await awaitRest(sec)
    const rest = await snapshot(sec)
    expect(rest.inlineHeight, "no inline height survives a reversal").toBe(
      "",
    )
    expect(
      rest.hidden !== null,
      `hidden=${JSON.stringify(rest.hidden)} disagrees with aria-expanded=${rest.expanded}`,
    ).toBe(rest.expanded === "false")
    expect(rest.open).toBe(rest.expanded === "true")
  })

  test("the trigger is a real button", async ({ page }) => {
    const sec = section(page, "Uncontrolled")
    const trigger = sec.locator(TRIGGER)
    const panel = sec.locator(PANEL)
    await expect(trigger).toHaveJSProperty("tagName", "BUTTON")
    await expect(trigger).toHaveAttribute("type", "button")

    await trigger.focus()
    await page.keyboard.press("Space")
    await expect(trigger).toHaveAttribute("aria-expanded", "true")
    await page.keyboard.press("Enter")
    await expect(trigger).toHaveAttribute("aria-expanded", "false")

    // the two ids point at each other
    const controls = await trigger.getAttribute("aria-controls")
    const panelId = await panel.getAttribute("id")
    const labelledBy = await panel.getAttribute("aria-labelledby")
    const triggerId = await trigger.getAttribute("id")
    expect(controls).toBeTruthy()
    expect(controls).toBe(panelId)
    expect(labelledBy).toBeTruthy()
    expect(labelledBy).toBe(triggerId)
  })
})
