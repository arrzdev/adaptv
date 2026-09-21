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
 * Dropdown under stress. dropdown.spec.ts proves the positioning engine wired to
 * real layout; this file hits the menu's LIFECYCLE with inputs out of order, too
 * fast and too many, and asserts the observables agree afterwards: the trigger's
 * `aria-expanded`, the count of `[data-adaptv="dropdown"]` panels in the DOM,
 * `document.activeElement`, the lab log, and the window listeners.
 *
 * What the source promises (src/components/dropdown/dropdown.tsx):
 *
 *   - No transition: `Dropdown.Content` returns null while closed and mounts the
 *     panel hidden for one pre-measure frame, so a burst of toggles is a
 *     mount/unmount race and must land on a consistent state.
 *   - Outside press dismisses (mouse decided on `pointerdown` capture, touch on
 *     `touchstart` bubble — outside-press.ts), so opening a second menu closes
 *     the first: one panel at a time.
 *   - Escape closes and refocuses the trigger; an item's click fires `onSelect`
 *     once and closes; the back chain closes at the Transient band ("menus
 *     dismiss rather than navigate") and defers while closed. The headless back
 *     seam is `window.__adaptvBack` (every LabPage installs it).
 *   - `resize` and capture-phase `scroll` re-anchor through dropdown-position.ts:
 *     8px from every viewport edge, capped and scrolling inside — at 500 items
 *     as at 30.
 *   - Unmount removes every window listener the open panel added; a long
 *     session of opens and closes plateaus.
 *
 * Not on this lab page, so not driven here: a controlled `open` whose owner
 * lags (the lab mounts uncontrolled menus only) and a disabled root (Dropdown
 * has none; `Dropdown.Trigger` takes `disabled` as a plain button prop).
 *
 * Doctrine as in stress-select.spec.ts: `awaitClientHandover` in every
 * beforeEach, no retries, no warm-ups, no sleeps where a condition can be
 * awaited, and the premise of each stress scenario asserted first. The touch
 * describe is chromium-only (CDP touch on a portrait viewport, or the rotate
 * guard covers the page); the long session is chromium-only (CDP heap read).
 */

const PAD = 8 // DROPDOWN_VIEWPORT_PADDING
const CONTENT = '[data-adaptv="dropdown"]'

const triggerFor = (page: Page, label: string): Locator =>
  page.getByRole("button", { name: label, exact: true })
const content = (page: Page): Locator => page.locator(CONTENT)
const logLines = (page: Page): Locator => page.locator("[data-lab-log] li")

async function openMenu(page: Page, label: string) {
  const t = triggerFor(page, label)
  await t.scrollIntoViewIfNeeded()
  await t.click()
  await content(page).waitFor()
}

async function expectConsistent(
  page: Page,
  label: string,
  isOpen: boolean,
) {
  await expect(triggerFor(page, label)).toHaveAttribute(
    "aria-expanded",
    String(isOpen),
  )
  await expect(content(page)).toHaveCount(isOpen ? 1 : 0)
}

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

function pressBack(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const back = (window as unknown as { __adaptvBack?: () => boolean })
      .__adaptvBack
    if (!back)
      throw new Error("no window.__adaptvBack — is this a LabPage?")
    return back()
  })
}

test.describe("Dropdown under stress — mouse and keyboard", () => {
  test.beforeEach(async ({ page }) => {
    await installListenerCounter(page)
    await page.goto("/lab/dropdown")
    await awaitClientHandover(page)
    await triggerFor(page, "Actions").waitFor()
  })

  test("ten rapid clicks on the trigger toggle it and land on one consistent state", async ({
    page,
  }) => {
    const t = triggerFor(page, "Actions")
    await t.scrollIntoViewIfNeeded()
    //premise: one click opens, the next closes
    await t.click()
    await expectConsistent(page, "Actions", true)
    await t.click()
    await expectConsistent(page, "Actions", false)

    for (let i = 0; i < 10; i++) await t.click()
    await expectConsistent(page, "Actions", false)

    //ten native clicks in ONE task. The trigger toggles from the rendered
    //`open` (`setOpen(!open)`, dropdown.tsx) and React flushes a discrete
    //event's update in a microtask, so every click of a same-task burst reads
    //the same value and the burst collapses to ONE toggle. No input device
    //delivers two clicks in one task, so this is a consistency check, not a
    //count: the DOM is stale until the flush, then lands on one state.
    const burst = await t.evaluate((el) => {
      const before = el.getAttribute("aria-expanded")
      for (let i = 0; i < 10; i++) (el as HTMLButtonElement).click()
      return { before, after: el.getAttribute("aria-expanded") }
    })
    expect(burst, "the DOM is untouched inside the task").toEqual({
      before: "false",
      after: "false",
    })
    await expectConsistent(page, "Actions", true)
    await t.evaluate((el) => {
      for (let i = 0; i < 11; i++) (el as HTMLButtonElement).click()
    })
    await expectConsistent(page, "Actions", false)
    await expect(logLines(page), "no item was ever activated").toHaveCount(
      0,
    )
  })

  test("opening a second menu closes the first: exactly one panel at any time", async ({
    page,
  }) => {
    await openMenu(page, "Actions")
    await expect(content(page)).toHaveAttribute(
      "aria-label",
      "Actions menu",
    )

    const second = triggerFor(page, "Long menu")
    await second.scrollIntoViewIfNeeded()
    await second.click()
    await expect(content(page)).toHaveCount(1)
    await expect(content(page)).toHaveAttribute(
      "aria-label",
      "Long menu menu",
    )
    //the first trigger reads closed while the survivor's panel is the only one
    await expect(triggerFor(page, "Actions")).toHaveAttribute(
      "aria-expanded",
      "false",
    )
    await expectConsistent(page, "Long menu", true)

    await page.keyboard.press("Escape")
    await expect(content(page)).toHaveCount(0)
    await expect(
      second,
      "Escape refocuses the survivor's trigger",
    ).toBeFocused()
    await expectConsistent(page, "Long menu", false)
  })

  test("an outside press delivered right behind the opening click closes it", async ({
    page,
  }) => {
    const t = triggerFor(page, "Actions")
    await t.scrollIntoViewIfNeeded()
    const outside = await page
      .getByText("With room, the menu sits directly under", {
        exact: false,
      })
      .boundingBox()
    if (!outside) throw new Error("the outside target has no box")
    await t.click()
    await page.mouse.click(
      outside.x + outside.width / 2,
      outside.y + outside.height / 2,
    )
    await expectConsistent(page, "Actions", false)
    await expect(logLines(page)).toHaveCount(0)
    await t.click()
    await expectConsistent(page, "Actions", true)
  })

  test("Escape right behind the opening click closes it and refocuses the trigger, never body", async ({
    page,
  }) => {
    const t = triggerFor(page, "Actions")
    await t.scrollIntoViewIfNeeded()
    await t.click()
    await page.keyboard.press("Escape")
    await expectConsistent(page, "Actions", false)
    await expect(t).toBeFocused()
    expect(
      await page.evaluate(() => document.activeElement?.tagName ?? "none"),
    ).toBe("BUTTON")
  })

  test("an item activated during a burst fires onSelect exactly once and closes", async ({
    page,
  }) => {
    await openMenu(page, "Actions")
    const item = page.getByRole("menuitem", {
      name: "Archive",
      exact: true,
    })
    //a double click: the first activates and closes, the second lands on
    //whatever is under the point once the menu is gone (two native clicks in
    //ONE task would both hit the item — React unmounts it in a microtask —
    //and no device delivers that)
    await item.dblclick()
    await expectConsistent(page, "Actions", false)
    await expect(logLines(page)).toHaveCount(1)
    await expect(logLines(page).first()).toContainText("Actions → Archive")
  })

  test("a client-side route change while open unmounts the menu and every window listener it added", async ({
    page,
  }) => {
    const before = await listenerSeq(page)
    await openMenu(page, "Actions")
    const after = await listenerSeq(page)
    const added = await liveListeners(page, before, after)
    expect(added["window:keydown:capture"], "Escape capture").toBe(1)
    expect(added["window:pointerdown:capture"], "outside press").toBe(1)
    expect(added["window:touchstart"], "outside touch").toBe(1)
    expect(added["window:scroll:capture"], "re-anchor on scroll").toBe(1)
    expect(added["window:resize"], "re-anchor on resize").toBe(1)

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
    await expect(content(page)).toHaveCount(0)
    expect(await liveListeners(page, before, after)).toEqual({})

    await page.goBack()
    await expect(page).toHaveURL(/\/lab\/dropdown$/)
    await awaitClientHandover(page)
    await expectConsistent(page, "Actions", false)
  })

  test("the back chain closes an open menu and consumes the press; closed, it defers", async ({
    page,
  }) => {
    await openMenu(page, "Actions")
    expect(await pressBack(page), "the open menu consumed the press").toBe(
      true,
    )
    await expectConsistent(page, "Actions", false)
    await expect(page).toHaveURL(/\/lab\/dropdown$/)
    expect(await pressBack(page), "closed: nothing consumed it").toBe(
      false,
    )
    await expect(page).toHaveURL(/\/lab\/dropdown$/)
  })

  test("500 items: opens fast, one node per row, capped inside the viewport, still dismisses", async ({
    page,
  }, testInfo) => {
    const t = triggerFor(page, "Huge menu")
    await t.scrollIntoViewIfNeeded()
    const nodesClosed = await domCount(page)
    const timing = await t.evaluate(
      (el) =>
        new Promise<{ syncMs: number; placedMs: number }>(
          (resolve, reject) => {
            const t0 = performance.now()
            ;(el as HTMLButtonElement).click()
            const syncMs = performance.now() - t0
            const check = () => {
              const panel = document.querySelector(
                '[data-adaptv="dropdown"]',
              )
              if (
                panel &&
                getComputedStyle(panel).visibility === "visible"
              ) {
                resolve({ syncMs, placedMs: performance.now() - t0 })
              } else if (performance.now() - t0 > 10_000) {
                reject(new Error("the 500-item menu never placed itself"))
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
      `[stress-dropdown] 500 items open: sync ${timing.syncMs.toFixed(1)} ms, placed ${timing.placedMs.toFixed(1)} ms (${testInfo.project.name})`,
    )
    await expect(content(page).getByRole("menuitem")).toHaveCount(500)
    const nodesOpen = await domCount(page)
    console.log(
      `[stress-dropdown] DOM elements closed ${nodesClosed}, open ${nodesOpen} (${testInfo.project.name})`,
    )
    expect(
      nodesOpen - nodesClosed,
      "one button per item plus the panel",
    ).toBe(501)
    expect(timing.placedMs, "no stall on open").toBeLessThan(3_000)

    const viewport = page.viewportSize()
    if (!viewport) throw new Error("no viewport")
    expectInsideViewport(
      await content(page).boundingBox(),
      viewport,
      "500-item menu",
    )
    expect(
      await content(page).evaluate(
        (el) => el.scrollHeight > el.clientHeight + 2,
      ),
      "capped: the rows scroll inside the panel",
    ).toBe(true)

    //the last row is reachable by scrolling the panel, and activates
    const last = page.getByRole("menuitem", {
      name: "Row 500",
      exact: true,
    })
    await last.scrollIntoViewIfNeeded()
    await last.click()
    await expectConsistent(page, "Huge menu", false)
    await expect(logLines(page).first()).toContainText(
      "Huge menu → Row 500",
    )
    await expect(logLines(page)).toHaveCount(1)
  })

  test("reduced motion: open and close still work on every path", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" })
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true)
    await openMenu(page, "Actions")
    await page.keyboard.press("Escape")
    await expectConsistent(page, "Actions", false)
    await openMenu(page, "Actions")
    await page
      .getByRole("menuitem", { name: "Rename", exact: true })
      .click()
    await expectConsistent(page, "Actions", false)
    await expect(logLines(page).first()).toContainText("Actions → Rename")
    await openMenu(page, "Actions")
    await page
      .getByRole("heading", { name: "Dropdown", exact: true })
      .click()
    await expectConsistent(page, "Actions", false)
  })
})

test.describe("Dropdown under stress — viewport geometry", () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/dropdown")
    await awaitClientHandover(page)
    await triggerFor(page, "Actions").waitFor()
  })

  test("a viewport swap to landscape and back while open re-anchors the menu inside the new viewport", async ({
    page,
  }) => {
    await openMenu(page, "Long menu")
    const panel = content(page)
    expectInsideViewport(
      await panel.boundingBox(),
      { width: 390, height: 844 },
      "portrait",
    )
    await page.setViewportSize({ width: 844, height: 390 })
    await expect(panel).toHaveCount(1)
    await expect(triggerFor(page, "Long menu")).toHaveAttribute(
      "aria-expanded",
      "true",
    )
    //the engine anchors to the trigger: WebKit does not scroll-anchor a
    //reflow, so the trigger can leave a 390px-tall viewport on the swap and
    //the menu follows it out. Bring the anchor back (the scroll capture
    //re-anchors) — the promise is a menu inside the viewport of an on-screen
    //trigger.
    await triggerFor(page, "Long menu").scrollIntoViewIfNeeded()
    await expect
      .poll(async () => {
        const box = await panel.boundingBox()
        return box ? box.y + box.height : Number.NaN
      }, "re-anchored under the new bottom edge")
      .toBeLessThanOrEqual(390 - PAD + 1)
    expectInsideViewport(
      await panel.boundingBox(),
      { width: 844, height: 390 },
      "landscape",
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(panel).toHaveCount(1)
    await expect
      .poll(async () => (await panel.boundingBox())?.height ?? Number.NaN)
      .toBeGreaterThan(150)
    expectInsideViewport(
      await panel.boundingBox(),
      { width: 390, height: 844 },
      "portrait again",
    )
    await page.keyboard.press("Escape")
    await expect(panel).toHaveCount(0)
    await expect(triggerFor(page, "Long menu")).toBeFocused()
  })

  test("the layout viewport shrinking to keyboard height while open keeps the menu on screen", async ({
    page,
  }) => {
    //Dropdown subscribes to `resize` + `window.innerHeight` only and this lab
    //mounts no keyboard observer, so `__adaptvKeyboardMock` is inert here; the
    //layout-viewport shrink is what a keyboard does to a fixed panel
    await openMenu(page, "Long menu")
    const panel = content(page)
    await page.setViewportSize({ width: 390, height: 500 })
    await expect(panel).toHaveCount(1)
    await expect
      .poll(async () => {
        const box = await panel.boundingBox()
        return box ? box.y + box.height : Number.NaN
      })
      .toBeLessThanOrEqual(500 - PAD + 1)
    expectInsideViewport(
      await panel.boundingBox(),
      { width: 390, height: 500 },
      "keyboard-height viewport",
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(panel).toHaveCount(1)
    await page
      .getByRole("menuitem", { name: "Option 1", exact: true })
      .click()
    await expectConsistent(page, "Long menu", false)
    await expect(logLines(page).first()).toContainText(
      "Long menu → Option 1",
    )
  })
})

test.describe("Dropdown under stress — touch (chromium, CDP)", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "the touch driver is CDP Input.dispatchTouchEvent (page.touchscreen on chromium); webkit runs the mouse/keyboard describes",
  )
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  })

  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/dropdown")
    await awaitClientHandover(page)
    await triggerFor(page, "Actions").waitFor()
  })

  async function centre(locator: Locator) {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    if (!box) throw new Error("no box to tap")
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  test("a double tap opens and closes; ten taps land closed; an outside touch closes at touchstart; a tap on an item fires once", async ({
    page,
  }) => {
    const t = triggerFor(page, "Actions")
    const at = await centre(t)
    expect(
      await page.evaluate(
        ({ x, y }) =>
          document
            .elementFromPoint(x, y)
            ?.closest("[data-adaptv='dropdown-trigger']") !== null,
        at,
      ),
      "the tap lands on the trigger, not the rotate guard",
    ).toBe(true)

    await page.touchscreen.tap(at.x, at.y)
    await expectConsistent(page, "Actions", true)
    //a second tap inside Chromium's double-tap window is swallowed by its
    //gesture detector (touchstart/touchend reach the button, no click —
    //measured on a plain <button> too), so the menu stays open, consistently
    await page.touchscreen.tap(at.x, at.y)
    await expectConsistent(page, "Actions", true)
    await expect(logLines(page)).toHaveCount(0)

    //taps past that window each click: ten of them land where they started
    const tap = async () => {
      await page.waitForTimeout(400)
      await page.touchscreen.tap(at.x, at.y)
    }
    await tap()
    await expectConsistent(page, "Actions", false)
    for (let i = 0; i < 10; i++) await tap()
    await expectConsistent(page, "Actions", false)

    await tap()
    await content(page).waitFor()
    const outside = await centre(
      page.getByText("With room, the menu sits directly under", {
        exact: false,
      }),
    )
    await page.touchscreen.tap(outside.x, outside.y)
    await expectConsistent(page, "Actions", false)
    await expect(logLines(page)).toHaveCount(0)

    await page.touchscreen.tap(at.x, at.y)
    await content(page).waitFor()
    const item = await centre(
      page.getByRole("menuitem", { name: "Duplicate", exact: true }),
    )
    await page.touchscreen.tap(item.x, item.y)
    await expectConsistent(page, "Actions", false)
    await expect(logLines(page)).toHaveCount(1)
    await expect(logLines(page).first()).toContainText(
      "Actions → Duplicate",
    )
  })
})

test.describe("Dropdown long session", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "the heap read is a CDP HeapProfiler call",
  )

  test.beforeEach(async ({ page }) => {
    await installListenerCounter(page)
    await page.goto("/lab/dropdown")
    await awaitClientHandover(page)
    await triggerFor(page, "Actions").waitFor()
  })

  test("100 open/close cycles: window listeners, DOM size and heap plateau", async ({
    page,
  }, testInfo) => {
    const t = triggerFor(page, "Actions")
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
        `[stress-dropdown] ${label}: live listeners since start ${JSON.stringify(s.listeners)}, DOM ${s.dom}, heap ${mb(s.heap)}`,
      )
      testInfo.annotations.push({
        type: `session-${label}`,
        description: `listeners ${JSON.stringify(s.listeners)} dom ${s.dom} heap ${mb(s.heap)}`,
      })
      return s
    }
    const cycle = async () => {
      await t.click()
      await content(page).waitFor()
      await page.keyboard.press("Escape")
      await expect(content(page)).toHaveCount(0)
    }
    const start = await snapshot("start")
    for (let i = 0; i < 50; i++) await cycle()
    const at50 = await snapshot("after-50")
    for (let i = 0; i < 50; i++) await cycle()
    const at100 = await snapshot("after-100")

    await expect(t).toBeFocused()
    await expect(logLines(page)).toHaveCount(0)
    expect(at100.listeners).toEqual(at50.listeners)
    expect(at100.listeners).toEqual(start.listeners)
    expect(at100.dom).toBe(at50.dom)
    expect(at50.dom).toBe(start.dom)
    expect(
      at100.heap - at50.heap,
      "heap growth between cycle 50 and 100 stays under 2 MB",
    ).toBeLessThan(2 * 1_048_576)
  })
})
