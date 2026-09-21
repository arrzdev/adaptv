import type { Locator, Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"
import {
  domCount,
  heapUsed,
  installListenerCounter,
  listenerSeq,
  liveListeners,
  mb,
} from "./support/stress"

/*
 * Select under stress. select.spec.ts pins the contract on the happy path; this
 * file hits the same contract with the inputs a real session produces out of
 * order, too fast, or too many at once, and asserts that every observable
 * (`aria-expanded`, the listbox count, `data-select-open`, the lab readouts,
 * `document.activeElement`, the window listeners) is CONSISTENT afterwards.
 *
 * What the source promises (src/components/select.tsx), and so what is asserted:
 *
 *   - There is no open/close transition. The panel is conditionally mounted and
 *     hidden for one pre-measure frame, so "faster than the transition" collapses
 *     to mount/unmount races: a burst of toggles must land on a state where the
 *     trigger, the root stamp and the DOM agree.
 *   - One listbox at a time: opening a second Select is an outside press on the
 *     first (outside-press.ts decides mouse on `pointerdown` capture).
 *   - Escape, Enter, Space and Tab are the keyboard closes and refocus the
 *     trigger; an outside press and the back chain close WITHOUT refocusing.
 *   - The back chain closes an open list at the Transient band and defers while
 *     closed (behaviors.md §12, the `Select` entry). The headless seam is
 *     `window.__adaptvBack`, the `adaptvBack()` call every LabPage installs.
 *   - The list re-anchors on `resize` (window listener) and is placed by
 *     dropdown-position.ts: 8px from every viewport edge, capped and scrolling
 *     inside when the space runs out — at 500 options as at 12.
 *   - Unmount (a route change) removes every window/document listener the open
 *     list added, and a long session of opens and closes must plateau.
 *
 * Every spec waits on `awaitClientHandover` first. No retries, no warm-ups, no
 * sleeps where a condition can be awaited, and every stress scenario asserts
 * its PREMISE (the burst really toggled, the listeners really registered, the
 * disabled flip really landed) before it asserts the outcome
 * (playground-touch-e2e-patterns).
 *
 * Both projects run the mouse/keyboard describes. The touch describe is
 * chromium-only: its driver is CDP `Input.dispatchTouchEvent` (what
 * `page.touchscreen.tap` sends on chromium), on a portrait viewport so the
 * playground's rotate guard never covers the page
 * (touch-emulation-desktop-is-landscape). The long session is chromium-only too:
 * the heap read is a CDP `HeapProfiler` call.
 */

const PAD = 8 // DROPDOWN_VIEWPORT_PADDING

const readout = (page: Page, name: string): Locator =>
  page.locator(`[data-lab-readout='${name}']`)
const trigger = (page: Page, name: string): Locator =>
  page.getByRole("combobox", { name, exact: true })
const listbox = (page: Page): Locator => page.getByRole("listbox")
const option = (page: Page, label: string): Locator =>
  page.getByRole("option", { name: label, exact: true })
const root = (page: Page, name: string): Locator =>
  page
    .locator('[data-adaptv="select"]')
    .filter({ has: trigger(page, name) })

async function open(page: Page, name: string) {
  const t = trigger(page, name)
  await t.scrollIntoViewIfNeeded()
  await t.click()
  await listbox(page).waitFor()
}

/** The trigger, the root stamp, the readout and the DOM all say the same thing. */
async function expectConsistent(
  page: Page,
  name: string,
  isOpen: boolean,
  readoutName?: string,
) {
  await expect(trigger(page, name)).toHaveAttribute(
    "aria-expanded",
    String(isOpen),
  )
  await expect(listbox(page)).toHaveCount(isOpen ? 1 : 0)
  if (isOpen) {
    await expect(root(page, name)).toHaveAttribute("data-select-open", "")
  } else {
    await expect(root(page, name)).not.toHaveAttribute(
      "data-select-open",
      "",
    )
  }
  if (readoutName) {
    await expect(readout(page, readoutName)).toHaveText(
      isOpen ? "open" : "closed",
    )
  }
}

function activeTag(page: Page): Promise<string> {
  return page.evaluate(() => document.activeElement?.tagName ?? "none")
}

/** A fixed box is inside the viewport with the engine's padding (1px slack). */
function expectInsideViewport(
  box: { x: number; y: number; width: number; height: number } | null,
  viewport: { width: number; height: number },
  msg: string,
) {
  if (!box) throw new Error(`${msg}: no box`)
  expect(box.x, `${msg}: left edge`).toBeGreaterThanOrEqual(PAD - 1)
  expect(box.x + box.width, `${msg}: right edge`).toBeLessThanOrEqual(
    viewport.width - PAD + 1,
  )
  expect(box.y, `${msg}: top edge`).toBeGreaterThanOrEqual(PAD - 1)
  expect(box.y + box.height, `${msg}: bottom edge`).toBeLessThanOrEqual(
    viewport.height - PAD + 1,
  )
}

test.describe("Select under stress — mouse and keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await installListenerCounter(page)
    await page.goto("/lab/select")
    await awaitClientHandover(page)
    await trigger(page, "Fruit").waitFor()
  })

  test("ten rapid clicks on the trigger toggle it and land on one consistent state", async ({
    page,
  }) => {
    const t = trigger(page, "Fruit")
    await t.scrollIntoViewIfNeeded()
    //premise: a single click opens (the burst below is ten of these)
    await t.click()
    await expectConsistent(page, "Fruit", true, "fruit-open")
    await t.click()
    await expectConsistent(page, "Fruit", false, "fruit-open")

    //ten real clicks as fast as the driver delivers them: an even count lands closed
    for (let i = 0; i < 10; i++) await t.click()
    await expectConsistent(page, "Fruit", false, "fruit-open")

    //ten native clicks in ONE task. The trigger branches on the rendered `open`
    //(`if (open) closeList(false) else openList(false)`, select.tsx) and React
    //flushes a discrete event's update in a microtask, so every click of a
    //same-task burst reads the same value and the burst collapses to ONE
    //toggle. No input device delivers two clicks in one task, so this is a
    //consistency check, not a count: the DOM is stale inside the task, then
    //lands on one state with exactly one listbox.
    const toggled = await t.evaluate((el) => {
      const before = el.getAttribute("aria-expanded")
      for (let i = 0; i < 10; i++) (el as HTMLButtonElement).click()
      return { before, after: el.getAttribute("aria-expanded") }
    })
    expect(toggled, "the DOM is untouched inside the task").toEqual({
      before: "false",
      after: "false",
    })
    await expectConsistent(page, "Fruit", true, "fruit-open")

    //and the same from open: one toggle, closed
    await t.evaluate((el) => {
      for (let i = 0; i < 11; i++) (el as HTMLButtonElement).click()
    })
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await expect(readout(page, "fruit")).toHaveText("none")
    await expect(readout(page, "fruit-changes")).toHaveText("0")
  })

  test("opening a second Select closes the first: exactly one listbox at any time", async ({
    page,
  }) => {
    //the first to open is the LOWER card: its list opens below it, so the
    //second trigger, above, stays uncovered on the iPhone viewport (opened the
    //other way round, the Fruit list lay over the Controlled trigger and a real
    //press there would pick an option, not open the second Select)
    await open(page, "Controlled")
    await expect(listbox(page)).toHaveAttribute(
      "aria-label",
      "Controlled options",
    )

    const second = trigger(page, "Fruit")
    await second.scrollIntoViewIfNeeded()
    const box = await second.boundingBox()
    if (!box) throw new Error("the Fruit trigger has no box")
    expect(
      await page.evaluate(
        ([x, y]) =>
          document
            .elementFromPoint(x, y)
            ?.closest("[data-adaptv='select-trigger']")
            ?.getAttribute("aria-label") ?? null,
        [box.x + box.width / 2, box.y + box.height / 2],
      ),
      "premise: the second trigger is what a press at its centre hits",
    ).toBe("Fruit")
    await second.click()

    await expect(listbox(page)).toHaveCount(1)
    await expect(listbox(page)).toHaveAttribute(
      "aria-label",
      "Fruit options",
    )
    //the first reads closed everywhere while the survivor's list is the only one
    await expect(trigger(page, "Controlled")).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    await expect(root(page, "Controlled")).not.toHaveAttribute(
      "data-select-open",
    )
    await expectConsistent(page, "Fruit", true, "fruit-open")

    //Escape closes the survivor and refocuses ITS trigger, not the first one's
    await page.keyboard.press("Escape")
    await expect(listbox(page)).toHaveCount(0)
    await expect(second).toBeFocused()
    await expectConsistent(page, "Fruit", false, "fruit-open")
  })

  test("an outside press delivered right behind the opening click closes it", async ({
    page,
  }) => {
    const t = trigger(page, "Fruit")
    await t.scrollIntoViewIfNeeded()
    //an outside target above the trigger, so the list (which opens below) never
    //covers it and it is on screen whenever the trigger is
    const outside = await page
      .getByText("No value to start", { exact: false })
      .boundingBox()
    if (!outside) throw new Error("the outside target has no box")

    await t.click()
    //no wait between the two: the second press lands as soon as the driver can
    await page.mouse.click(
      outside.x + outside.width / 2,
      outside.y + outside.height / 2,
    )
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await expect(readout(page, "fruit")).toHaveText("none")
    await expect(readout(page, "fruit-changes")).toHaveText("0")

    //and the trigger still works afterwards
    await t.click()
    await expectConsistent(page, "Fruit", true, "fruit-open")
  })

  test("Escape right behind the opening click closes it, refocuses the trigger, and never leaves focus on body", async ({
    page,
  }) => {
    const t = trigger(page, "Fruit")
    await t.scrollIntoViewIfNeeded()
    await t.click()
    await page.keyboard.press("Escape")
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await expect(t).toBeFocused()
    expect(await activeTag(page)).not.toBe("BODY")

    //ArrowDown then Enter with nothing highlighted yet: Enter on an open list with
    //no highlight closes it (source: `else closeList(true)`) and refocuses
    await page.keyboard.press("Enter")
    await listbox(page).waitFor()
    await expect(t).toHaveAttribute("aria-expanded", "true")
    await page.keyboard.press("Enter")
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await expect(readout(page, "fruit-changes"), "no pick").toHaveText("0")
    await expect(t).toBeFocused()

    //Tab out of an open list: closes, focus comes home, and the browser's own Tab
    //moves on from the trigger — to wherever a Tab from the closed trigger goes
    //(the next control on Chromium; WebKit's Tab skips buttons, so body there)
    const landing = () =>
      page.evaluate(() => {
        const a = document.activeElement
        return `${a?.tagName}:${a?.getAttribute("aria-label") ?? ""}`
      })
    await page.keyboard.press("Tab")
    const fromClosed = await landing()
    await t.focus()
    await page.keyboard.press("ArrowDown")
    await listbox(page).waitFor()
    await page.keyboard.press("Tab")
    await expect(listbox(page)).toHaveCount(0)
    expect(
      await landing(),
      "Tab from the open list lands where Tab from the closed trigger lands",
    ).toBe(fromClosed)
  })

  test("the aria wiring holds after a pick, a reopen and a keyboard walk", async ({
    page,
  }) => {
    await open(page, "Fruit")
    const lb = listbox(page)
    const controls = await trigger(page, "Fruit").getAttribute(
      "aria-controls",
    )
    expect(controls).toBeTruthy()
    await expect(lb).toHaveId(controls ?? "")
    //nothing highlighted on a click-open with no value: no activedescendant
    await expect(lb).not.toHaveAttribute("aria-activedescendant", /.+/)

    await page.keyboard.press("End")
    const plum = option(page, "Plum")
    await expect(plum).toHaveAttribute("data-highlighted", "")
    await expect(lb).toHaveAttribute(
      "aria-activedescendant",
      (await plum.getAttribute("id")) ?? "",
    )
    await page.keyboard.press("Enter")
    await expect(readout(page, "fruit")).toHaveText("plum")

    //reopen: the selected row is selected AND highlighted, and named as active
    await open(page, "Fruit")
    await expect(option(page, "Plum")).toHaveAttribute(
      "aria-selected",
      "true",
    )
    await expect(option(page, "Plum")).toHaveAttribute("data-selected", "")
    await expect(option(page, "Plum")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    await expect(
      page.locator("[role='option'][aria-selected='true']"),
    ).toHaveCount(1)
    await expect(lb).toHaveAttribute(
      "aria-activedescendant",
      (await option(page, "Plum").getAttribute("id")) ?? "",
    )
    await page.keyboard.press("Home")
    await expect(option(page, "Apple")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    await expect(
      page.locator("[role='option'][data-highlighted]"),
      "exactly one highlight",
    ).toHaveCount(1)
    await page.keyboard.press("Escape")
    await expect(trigger(page, "Fruit")).toBeFocused()
  })

  test("a client-side route change while open unmounts the list and every window listener it added", async ({
    page,
  }) => {
    const before = await listenerSeq(page)
    await open(page, "Fruit")
    const after = await listenerSeq(page)
    const added = await liveListeners(page, before, after)
    //premise: the open registered what the source says it registers
    expect(added["window:keydown:capture"], "Escape capture").toBe(1)
    expect(added["window:pointerdown:capture"], "outside press").toBe(1)
    expect(added["window:touchstart"], "outside touch").toBe(1)
    expect(added["window:scroll:capture"], "re-anchor on scroll").toBe(1)
    expect(added["window:resize"], "re-anchor on resize").toBe(1)

    //navigate away with the list open: not a press, not a key — the router
    await page.evaluate(async () => {
      const router = (
        window as unknown as {
          __TSR_ROUTER__?: {
            navigate: (o: { to: string }) => Promise<void>
          }
        }
      ).__TSR_ROUTER__
      if (!router) throw new Error("the app's router is not on window")
      await router.navigate({ to: "/lab" })
    })
    await expect(page).toHaveURL(/\/lab$/)
    await expect(listbox(page)).toHaveCount(0)
    expect(
      await liveListeners(page, before, after),
      "everything the open added is gone with the page",
    ).toEqual({})

    //and coming back gives a fresh, closed Select
    await page.goBack()
    await expect(page).toHaveURL(/\/lab\/select$/)
    await awaitClientHandover(page)
    await expectConsistent(page, "Fruit", false, "fruit-open")
  })

  test("the back chain closes an open list and consumes the press; closed, it defers", async ({
    page,
  }) => {
    const pressBack = () =>
      page.evaluate(() => {
        const back = (
          window as unknown as { __adaptvBack?: () => boolean }
        ).__adaptvBack
        if (!back)
          throw new Error("no window.__adaptvBack — is this a LabPage?")
        return back()
      })
    await open(page, "Fruit")
    await page.keyboard.press("ArrowDown")
    expect(await pressBack(), "the open list consumed the press").toBe(
      true,
    )
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await expect(page).toHaveURL(/\/lab\/select$/)
    await expect(readout(page, "fruit")).toHaveText("none")

    //closed: the Select defers, and with no history behind a direct `goto` the
    //floor handler defers too on the web (it never closes a tab) — the URL holds
    expect(await pressBack(), "nothing consumed it").toBe(false)
    await expect(page).toHaveURL(/\/lab\/select$/)
    await expectConsistent(page, "Fruit", false, "fruit-open")
  })

  test("500 options: opens fast, one node per row, capped inside the viewport, Home/End/typeahead correct", async ({
    page,
  }, testInfo) => {
    const t = trigger(page, "Huge")
    await t.scrollIntoViewIfNeeded()
    const nodesClosed = await domCount(page)

    //time the open from the click to the panel being PLACED (visibility flips from
    //the pre-measure `hidden` to `visible`), measured in the page's own clock
    const timing = await t.evaluate(
      (el) =>
        new Promise<{ syncMs: number; placedMs: number }>(
          (resolve, reject) => {
            const t0 = performance.now()
            ;(el as HTMLButtonElement).click()
            const syncMs = performance.now() - t0
            const id = el.getAttribute("aria-controls") ?? ""
            const check = () => {
              const list = document.getElementById(id)
              if (
                list &&
                getComputedStyle(list).visibility === "visible"
              ) {
                resolve({ syncMs, placedMs: performance.now() - t0 })
              } else if (performance.now() - t0 > 10_000) {
                reject(
                  new Error("the 500-option list never placed itself"),
                )
              } else requestAnimationFrame(check)
            }
            check()
          },
        ),
    )
    testInfo.annotations.push({
      type: "open-500",
      description: `sync ${timing.syncMs.toFixed(1)} ms, placed ${timing.placedMs.toFixed(1)} ms`,
    })
    console.log(
      `[stress-select] 500 options open: sync ${timing.syncMs.toFixed(1)} ms, placed ${timing.placedMs.toFixed(1)} ms (${testInfo.project.name})`,
    )
    await expect(listbox(page).getByRole("option")).toHaveCount(500)
    const nodesOpen = await domCount(page)
    console.log(
      `[stress-select] DOM elements closed ${nodesClosed}, open ${nodesOpen} (${testInfo.project.name})`,
    )
    expect(
      nodesOpen - nodesClosed,
      "one element per option plus the listbox",
    ).toBe(501)
    //a stall here is a bug on a phone; the bound is loose on purpose (a loaded CI
    //machine) and the measured figure is in the annotation above
    expect(timing.placedMs, "no stall on open").toBeLessThan(3_000)

    const viewport = page.viewportSize()
    if (!viewport) throw new Error("no viewport")
    const lb = listbox(page)
    expectInsideViewport(
      await lb.boundingBox(),
      viewport,
      "500-option list",
    )
    expect(
      await lb.evaluate((el) => el.scrollHeight > el.clientHeight + 2),
      "capped: the rows scroll inside the panel",
    ).toBe(true)

    await page.keyboard.press("End")
    await expect(option(page, "N500")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    await page.keyboard.press("Home")
    await expect(option(page, "N001")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    await page.keyboard.type("n25")
    await expect(option(page, "N250")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    await expect(
      page.locator("[role='option'][data-highlighted]"),
      "exactly one highlight",
    ).toHaveCount(1)
    await expect(lb).toHaveAttribute(
      "aria-activedescendant",
      (await option(page, "N250").getAttribute("id")) ?? "",
    )
    await page.keyboard.press("Enter")
    await expect(readout(page, "huge")).toHaveText("n250")
    await expect(readout(page, "huge-changes")).toHaveText("1")
    await expect(listbox(page)).toHaveCount(0)
    await expect(t).toBeFocused()
    await expect(t).toHaveText("N250")
  })

  test("the keyboard highlight stays scrolled into view inside a capped list", async ({
    page,
  }) => {
    await open(page, "Huge")
    const lb = listbox(page)
    //premise: the list is capped, so a highlight can be out of view at all
    expect(
      await lb.evaluate((el) => el.scrollHeight > el.clientHeight + 2),
    ).toBe(true)
    const inView = async (label: string) => {
      const o = await option(page, label).boundingBox()
      const l = await lb.boundingBox()
      if (!o || !l) throw new Error(`${label}: no box`)
      return o.y >= l.y - 1 && o.y + o.height <= l.y + l.height + 1
    }
    await page.keyboard.press("End")
    await expect(option(page, "N500")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    expect(
      await inView("N500"),
      "End: the highlighted row is visible",
    ).toBe(true)
    await page.keyboard.press("Home")
    await expect(option(page, "N001")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    expect(
      await inView("N001"),
      "Home: the highlighted row is visible",
    ).toBe(true)
    //arrowing past the bottom of the visible rows must follow too
    for (let i = 0; i < 40; i++) await page.keyboard.press("ArrowDown")
    await expect(option(page, "N041")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    expect(
      await inView("N041"),
      "ArrowDown past the fold: the highlighted row is visible",
    ).toBe(true)
  })

  test("the controlled Select whose owner refuses keeps the owner's value everywhere", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "freeze", exact: true }).click()
    await expect(readout(page, "controlled-frozen")).toHaveText("frozen")

    await open(page, "Controlled")
    await option(page, "Mango").click()
    await expect(readout(page, "controlled-changes")).toHaveText("1")
    await expect(readout(page, "controlled")).toHaveText("none")
    await expect(listbox(page)).toHaveCount(0)
    const t = trigger(page, "Controlled")
    await expect(t, "still the placeholder").toHaveAttribute(
      "data-placeholder",
      "",
    )
    await expect(t).toHaveText("Nothing yet")
    expect(
      await root(page, "Controlled")
        .locator("select")
        .evaluate((el) => (el as HTMLSelectElement).value),
      "the native select agrees with the owner",
    ).toBe("")

    //reopen: nothing is selected, so nothing carries aria-selected
    await open(page, "Controlled")
    await expect(
      page.locator("[role='option'][aria-selected='true']"),
    ).toHaveCount(0)
    await page.keyboard.press("Escape")

    //the owner lets go: the next pick lands
    await page
      .getByRole("button", { name: "unfreeze", exact: true })
      .click()
    await open(page, "Controlled")
    await option(page, "Mango").click()
    await expect(readout(page, "controlled")).toHaveText("mango")
    await expect(readout(page, "controlled-changes")).toHaveText("2")
    await expect(t).toHaveText("Mango")
  })

  test("a Select disabled underneath its open list closes it", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "disable in 1 s", exact: true })
      .click()
    await open(page, "Flip")
    await expect(readout(page, "flip-disabled"), "premise").toHaveText(
      "no",
    )
    //the flip lands under the open list
    await expect(readout(page, "flip-disabled")).toHaveText("yes", {
      timeout: 5_000,
    })
    await expect(root(page, "Flip")).toHaveAttribute("data-disabled", "")
    await expect(trigger(page, "Flip")).toBeDisabled()
    await expectConsistent(page, "Flip", false)
  })

  test("a Select disabled underneath its open list refuses a pick", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "disable in 1 s", exact: true })
      .click()
    await open(page, "Flip")
    await expect(readout(page, "flip-disabled")).toHaveText("yes", {
      timeout: 5_000,
    })
    //whether or not the list is still up, a pick must not land on a disabled Select
    if ((await listbox(page).count()) === 1) {
      await option(page, "Beta").click()
    }
    await expect(listbox(page)).toHaveCount(0)
    await expect(readout(page, "flip-changes")).toHaveText("0")
    await expect(readout(page, "flip")).toHaveText("none")
    await expect(trigger(page, "Flip")).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    await expect(trigger(page, "Flip")).toHaveText("Open me, then wait")
  })

  test("reduced motion: open and close still work on every path", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      "premise: the emulation took",
    ).toBe(true)
    await open(page, "Fruit")
    await page.keyboard.press("Escape")
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await open(page, "Fruit")
    await option(page, "Cherry").click()
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await expect(readout(page, "fruit")).toHaveText("cherry")
    await open(page, "Fruit")
    await page
      .getByRole("heading", { name: "Select", exact: true })
      .click()
    await expectConsistent(page, "Fruit", false, "fruit-open")
  })
})

test.describe("Select under stress — viewport and keyboard geometry", () => {
  //a phone-sized page on both projects, so the swap below is a real rotation
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/select")
    await awaitClientHandover(page)
    await trigger(page, "Fruit").waitFor()
  })

  test("a viewport swap to landscape and back while open re-anchors the list inside the new viewport", async ({
    page,
  }) => {
    await open(page, "Fruit")
    const lb = listbox(page)
    expectInsideViewport(
      await lb.boundingBox(),
      { width: 390, height: 844 },
      "portrait",
    )

    //landscape: `resize` fires, the list re-positions — it does not close (the
    //source promises re-anchoring; nothing closes on resize). On the webkit
    //project the rotate guard now covers the page; the list stays mounted under it
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(lb).toHaveCount(1)
    await expect(trigger(page, "Fruit")).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    await expect
      .poll(async () => {
        const box = await lb.boundingBox()
        return box ? box.y + box.height : Number.NaN
      }, "re-anchored under the new bottom edge")
      .toBeLessThanOrEqual(390 - PAD + 1)
    expectInsideViewport(
      await lb.boundingBox(),
      { width: 844, height: 390 },
      "landscape",
    )
    expect(
      await lb.evaluate((el) => el.scrollHeight > el.clientHeight + 2),
      "twelve rows do not fit 390px tall: capped and scrolling",
    ).toBe(true)

    //and back
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(lb).toHaveCount(1)
    await expect
      .poll(async () => (await lb.boundingBox())?.height ?? Number.NaN)
      .toBeGreaterThan(200)
    expectInsideViewport(
      await lb.boundingBox(),
      { width: 390, height: 844 },
      "portrait again",
    )
    await page.keyboard.press("Escape")
    await expect(lb).toHaveCount(0)
    await expect(trigger(page, "Fruit")).toBeFocused()
  })

  test("the layout viewport shrinking to keyboard height while open keeps the list on screen", async ({
    page,
  }) => {
    //Select subscribes to nothing but `resize` + `window.innerHeight`, and the
    //select lab mounts no keyboard observer, so `__adaptvKeyboardMock` is inert on
    //this route. What an on-screen keyboard does to a fixed panel is shrink the
    //layout viewport — driven here directly, which is the only honest stand-in
    await open(page, "Fruit")
    const lb = listbox(page)
    await page.setViewportSize({ width: 390, height: 500 })
    await expect(lb).toHaveCount(1)
    await expect
      .poll(async () => {
        const box = await lb.boundingBox()
        return box ? box.y + box.height : Number.NaN
      }, "re-anchored above the raised bottom edge")
      .toBeLessThanOrEqual(500 - PAD + 1)
    expectInsideViewport(
      await lb.boundingBox(),
      { width: 390, height: 500 },
      "keyboard-height viewport",
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(lb).toHaveCount(1)
    await page.keyboard.press("ArrowDown")
    await expect(option(page, "Apple")).toHaveAttribute(
      "data-highlighted",
      "",
    )
    await page.keyboard.press("Enter")
    await expect(readout(page, "fruit")).toHaveText("apple")
    await expect(trigger(page, "Fruit")).toBeFocused()
  })
})

test.describe("Select under stress — touch (chromium, CDP)", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "the touch driver is CDP Input.dispatchTouchEvent (page.touchscreen on chromium); webkit runs the mouse/keyboard describes",
  )
  //portrait, or the rotate guard covers the page (touch-emulation-desktop-is-landscape)
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/select")
    await awaitClientHandover(page)
    await trigger(page, "Fruit").waitFor()
  })

  async function centre(locator: Locator) {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (!box) throw new Error("no box to tap")
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  /** The element the tap would hit is (inside) the target — the guard is not over it. */
  async function expectHits(
    page: Page,
    at: { x: number; y: number },
    selector: string,
  ) {
    const hit = await page.evaluate(
      ({ x, y, sel }) =>
        document.elementFromPoint(x, y)?.closest(sel) !== null,
      { ...at, sel: selector },
    )
    expect(hit, `elementFromPoint hits ${selector}`).toBe(true)
  }

  test("a double tap opens and closes; ten taps land closed; the eleventh opens exactly one list", async ({
    page,
  }) => {
    const t = trigger(page, "Fruit")
    const at = await centre(t)
    await expectHits(page, at, "[role='combobox']")

    //premise: one tap opens
    await page.touchscreen.tap(at.x, at.y)
    await expectConsistent(page, "Fruit", true, "fruit-open")
    //a second tap inside Chromium's double-tap window is swallowed by its
    //gesture detector (touchstart/touchend reach the button, no click —
    //measured on a plain <button> too), so the list stays open, consistently
    await page.touchscreen.tap(at.x, at.y)
    await expectConsistent(page, "Fruit", true, "fruit-open")

    //taps past that window each click
    const tap = async () => {
      await page.waitForTimeout(400)
      await page.touchscreen.tap(at.x, at.y)
    }
    await tap()
    await expectConsistent(page, "Fruit", false, "fruit-open")
    for (let i = 0; i < 10; i++) await tap()
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await tap()
    await expectConsistent(page, "Fruit", true, "fruit-open")
    await expect(readout(page, "fruit-changes")).toHaveText("0")
  })

  test("a touch outside closes at touchstart; a touch on an option picks once", async ({
    page,
  }) => {
    const t = trigger(page, "Fruit")
    const at = await centre(t)
    await page.touchscreen.tap(at.x, at.y)
    await listbox(page).waitFor()

    const outside = await centre(
      page.getByText("No value to start", { exact: false }),
    )
    await page.touchscreen.tap(outside.x, outside.y)
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await expect(readout(page, "fruit")).toHaveText("none")

    await page.waitForTimeout(400)
    await page.touchscreen.tap(at.x, at.y)
    await listbox(page).waitFor()
    const blueberry = await centre(option(page, "Blueberry"))
    await expectHits(page, blueberry, "[role='option']")
    await page.touchscreen.tap(blueberry.x, blueberry.y)
    await expect(readout(page, "fruit")).toHaveText("blueberry")
    await expect(readout(page, "fruit-changes")).toHaveText("1")
    await expectConsistent(page, "Fruit", false, "fruit-open")
    await expect(t).toHaveText("Blueberry")
  })
})

test.describe("Select long session", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "the heap read is a CDP HeapProfiler call",
  )

  test.beforeEach(async ({ page }) => {
    await installListenerCounter(page)
    await page.goto("/lab/select")
    await awaitClientHandover(page)
    await trigger(page, "Fruit").waitFor()
  })

  test("100 open/close cycles: window listeners, DOM size and heap plateau", async ({
    page,
  }, testInfo) => {
    const t = trigger(page, "Fruit")
    await t.scrollIntoViewIfNeeded()
    const seq0 = await listenerSeq(page)
    const snapshot = async (label: string) => {
      const s = {
        label,
        listeners: await liveListeners(page, seq0),
        dom: await domCount(page),
        heap: await heapUsed(page),
      }
      console.log(
        `[stress-select] ${label}: live listeners since start ${JSON.stringify(s.listeners)}, DOM ${s.dom}, heap ${mb(s.heap)}`,
      )
      testInfo.annotations.push({
        type: `session-${label}`,
        description: `listeners ${JSON.stringify(s.listeners)} dom ${s.dom} heap ${mb(s.heap)}`,
      })
      return s
    }
    const cycle = async () => {
      await t.click()
      await listbox(page).waitFor()
      await page.keyboard.press("Escape")
      await expect(listbox(page)).toHaveCount(0)
    }

    const start = await snapshot("start")
    for (let i = 0; i < 50; i++) await cycle()
    const at50 = await snapshot("after-50")
    for (let i = 0; i < 50; i++) await cycle()
    const at100 = await snapshot("after-100")

    //premise: the cycles happened — the trigger is closed, focused, nothing picked
    await expect(t).toBeFocused()
    await expect(readout(page, "fruit-changes")).toHaveText("0")
    await expect(readout(page, "fruit-open")).toHaveText("closed")

    expect(
      at100.listeners,
      "every listener an open adds, a close removes",
    ).toEqual(at50.listeners)
    expect(
      at100.listeners,
      "and none survived the very first cycle",
    ).toEqual(start.listeners)
    expect(
      at100.dom,
      "the DOM is the same size after 100 as after 50",
    ).toBe(at50.dom)
    expect(at50.dom).toBe(start.dom)
    //heap: reported above; the bound is on the second half only, where a leak
    //would keep climbing while a warmed-up page holds still
    expect(
      at100.heap - at50.heap,
      "heap growth between cycle 50 and 100 stays under 2 MB",
    ).toBeLessThan(2 * 1_048_576)
  })
})
