import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Scroll anchoring against adaptv's OWN keyboard scrolls.
 *
 * Chromium has anchored for years; Safari 27 turns it on (WebKit 171840378), and the
 * spec picks the focused editable as a priority anchor, which is exactly the element
 * adaptv scrolls into view when the keyboard moves (`scrollDrawerInputIntoView` in
 * the drawer, `scrollFocusedInputIntoView` in AvoidKeyboard). The fear is a double
 * adjustment: content changes above the focused row, the browser compensates, adaptv
 * compensates too, and the row jumps by the delta twice. Playwright's WebKit (625.1.21,
 * the Safari 27.0 line) already anchors, so this runs on both engines.
 *
 * Measured on both engines, with anchoring left alone and with `overflow-anchor: none`
 * forced on the scroller as the control:
 *
 *   - An insertion above the field while adaptv's smooth scroll is travelling IS
 *     anchored on both engines (read synchronously: scrollTop +100, field unmoved), and
 *     the smooth scroll's next frame goes back to adaptv's ABSOLUTE target and
 *     overwrites the adjustment (chromium drawer: scrollTop 5 -> 10 and the field +95 on
 *     that frame). So the landing is the same with and without anchoring: the drawer at
 *     scrollTop 971 with its field 12px clear, AvoidKeyboard at 628 with 24px. Nothing
 *     adds a second adjustment, because nothing in adaptv writes a relative one.
 *   - At rest, the same insertion is anchored and stays anchored: scrollTop +100 and
 *     the field does not move, where the control moves it 100px.
 *
 * Each test pins both halves, and asserts that the control really did turn anchoring
 * off (its at-rest scrollTop must not move), so a control that silently fails to apply
 * cannot make the comparison vacuous. The row keeps its place at rest: forcing
 * `overflow-anchor: none` on the scroller for good fails all four runs with "at rest
 * the field moved 382.3 -> 482.3". Setting it only while adaptv scrolls and clearing it
 * after is NOT caught (0 of 4), because the at-rest insertion then runs with anchoring
 * back on. The landing must not depend on anchoring and must clear the keyboard;
 * doubling the drawer's delta in `scrollDrawerInputIntoView` failed webkit on the
 * clearance in every run (-141px) but chromium only in one of two, because chromium's
 * slower smooth scroll lets the drawer's re-aim land a doubled delta near the target.
 *
 * Both surfaces aim again after the change, which is why they land clear: the drawer
 * re-aims 420ms after the raise, and AvoidKeyboard re-aims when the keyboard raise
 * lands 250ms after the focus. AvoidKeyboard also takes one more look when each of
 * its smooth scrolls ends; the drawer does not re-aim after its 420ms, so a change
 * above its field later on is not corrected — see docs/design/behaviors.md for the
 * numbers; that is the drawer aiming once, not anchoring, and not asserted here.
 *
 * Rows are added below the field too, so the aimed landing is not the end of the
 * scroller: there the browser's clamp absorbed a doubled scroll and the check passed.
 * The content change is foreign rows inserted into the real scroller, standing in for a
 * list that grows above the field. A desktop engine has no on-screen keyboard, so the
 * raise goes through the keyboard seam (`window.__adaptvKeyboardMock` + the
 * `adaptv:keyboard-mock` event), installed before the hooks mount; it does not move
 * `visualViewport`. What this cannot see: iOS momentum scrolling and a real keyboard,
 * which stay on an iOS 27 device.
 */

test.use({ viewport: { width: 390, height: 844 } })
test.setTimeout(60_000)

const INSERT_PX = 100

type Anchor = "shipped" | "none"
type Surface = {
  route: string
  field: string
  fillerRows: number
  fillerHeight: number
  /** "raise": the field is already focused and the keyboard raise starts adaptv's
   *  scroll (the drawer). "focus": the focus starts it and the keyboard lands 250ms
   *  later, as a real one does after a tap (AvoidKeyboard). */
  trigger: "raise" | "focus"
}

const KEYBOARD_PX = Math.round(844 * 0.4)
const RAISE_AFTER_FOCUS_MS = 250

const DRAWER: Surface = {
  route: "/lab/drawer",
  field: "Drawer field",
  fillerRows: 20,
  fillerHeight: 56,
  trigger: "raise",
}
const AVOID: Surface = {
  route: "/lab/avoid-keyboard",
  field: "Field six",
  fillerRows: 8,
  fillerHeight: 60,
  trigger: "focus",
}

type Run = {
  moved: boolean
  scrollAtInsert: number
  landing: { scrollTop: number; fieldTop: number; clearance: number }
  steps: number[]
  rest: { fieldBefore: number; fieldAfter: number; scrollDelta: number }
}

async function openSurface(page: Page, surface: Surface, anchor: Anchor) {
  await page.addInitScript(() => {
    ;(
      window as unknown as { __adaptvKeyboardMock?: unknown }
    ).__adaptvKeyboardMock = { isOpen: false, height: 0 }
  })
  await page.goto(surface.route)
  await awaitClientHandover(page)
  if (surface === DRAWER) {
    await page
      .getByRole("button", { name: "Open keyboard drawer" })
      .click()
    await page.locator("[data-pwa-drawer]").waitFor({ state: "attached" })
  } else {
    await page
      .locator("div.h-72")
      .filter({ has: page.getByLabel("Field one") })
      .scrollIntoViewIfNeeded()
  }
  await page.getByLabel(surface.field).waitFor()
  //foreign rows above the field, so the field starts out of view and the scroll is long,
  await page.evaluate(
    ({ label, rows, height, anchor }) => {
      const field = document.querySelector<HTMLElement>(
        `[aria-label="${label}"]`,
      )
      let scroller = field?.parentElement ?? null
      while (scroller && getComputedStyle(scroller).overflowY !== "auto") {
        scroller = scroller.parentElement
      }
      if (!field || !scroller)
        throw new Error("no scroller around the field")
      field.dataset.anchorField = ""
      scroller.dataset.anchorScroller = ""
      if (anchor === "none") scroller.style.overflowAnchor = "none"
      const host = document.createElement("div")
      host.dataset.anchorRows = ""
      host.style.flexShrink = "0"
      for (let i = 0; i < rows; i += 1) {
        const row = document.createElement("div")
        row.style.height = `${height}px`
        host.append(row)
      }
      scroller.prepend(host)
      //and rows below it, so the aimed landing is not also the end of the scroller, where
      //the browser's clamp would hide an overshoot
      const tail = host.cloneNode(true) as HTMLElement
      delete tail.dataset.anchorRows
      scroller.append(tail)
      scroller.scrollTop = 0
    },
    {
      label: surface.field,
      rows: surface.fillerRows,
      height: surface.fillerHeight,
      anchor,
    },
  )
}

/** Raise or focus, insert above the field while adaptv's scroll is moving, record every
 *  frame until everything has settled, then insert again at rest. All in one page task so
 *  the insertion lands on a known frame. */
function measure(page: Page, surface: Surface) {
  return page.evaluate(
    async ({
      trigger,
      insertPx,
      keyboardPx,
      raiseAfterMs,
    }): Promise<Run> => {
      const frame = () =>
        new Promise<number>((resolve) => requestAnimationFrame(resolve))
      const field = document.querySelector<HTMLElement>(
        "[data-anchor-field]",
      )
      const scroller = document.querySelector<HTMLElement>(
        "[data-anchor-scroller]",
      )
      const rows = document.querySelector<HTMLElement>(
        "[data-anchor-rows]",
      )
      if (!field || !scroller || !rows)
        throw new Error("probe not installed")
      const top = () => field.getBoundingClientRect().top
      const insert = () => {
        const block = document.createElement("div")
        block.style.height = `${insertPx}px`
        rows.prepend(block)
      }
      //settled = field and scrollTop unchanged for 12 consecutive frames
      const settle = async () => {
        let still = 0
        let last = [top(), scroller.scrollTop]
        for (let i = 0; i < 240 && still < 12; i += 1) {
          await frame()
          const now = [top(), scroller.scrollTop]
          still =
            Math.abs(now[0] - last[0]) < 0.5 &&
            Math.abs(now[1] - last[1]) < 0.5
              ? still + 1
              : 0
          last = now
        }
      }

      const mock = (height: number) => {
        ;(
          window as unknown as { __adaptvKeyboardMock?: unknown }
        ).__adaptvKeyboardMock = { isOpen: height > 0, height }
        window.dispatchEvent(new Event("adaptv:keyboard-mock"))
      }

      field.focus({ preventScroll: true })
      if (trigger === "raise") {
        await settle()
        mock(keyboardPx)
      }
      const focusedAt = performance.now()
      let raised = trigger === "raise"

      const start = scroller.scrollTop
      const steps: number[] = []
      //one frame in before the first reading: WebKit's iPhone context reports the field
      //at a stale -15px on the frame of the focus() call, then its real ~1029px
      await frame()
      let previous = top()
      let movingFrames = 0
      let scrollAtInsert = -1
      const began = performance.now()
      //the drawer re-aims 420ms after the raise; 1.5s covers it and the smooth scroll after
      while (performance.now() - began < 1500) {
        await frame()
        if (!raised && performance.now() - focusedAt >= raiseAfterMs) {
          raised = true
          mock(keyboardPx)
        }
        const now = top()
        steps.push(Math.round((now - previous) * 10) / 10)
        previous = now
        if (
          scrollAtInsert < 0 &&
          Math.abs(scroller.scrollTop - start) >= 1
        ) {
          movingFrames += 1
          if (movingFrames === 3) {
            scrollAtInsert = scroller.scrollTop
            insert()
          }
        }
      }
      await settle()
      const fieldRect = field.getBoundingClientRect()
      const scrollerRect = scroller.getBoundingClientRect()
      const landing = {
        scrollTop: Math.round(scroller.scrollTop),
        fieldTop: Math.round(fieldRect.top - scrollerRect.top),
        clearance: Math.round(scrollerRect.bottom - fieldRect.bottom),
      }

      //at rest: nothing of adaptv's is scrolling and nothing else changes
      const fieldBefore = top()
      const scrollBefore = scroller.scrollTop
      insert()
      await settle()
      return {
        moved: scrollAtInsert >= 0,
        scrollAtInsert: Math.round(scrollAtInsert),
        landing,
        steps,
        rest: {
          fieldBefore: Math.round(fieldBefore * 10) / 10,
          fieldAfter: Math.round(top() * 10) / 10,
          scrollDelta: Math.round(scroller.scrollTop - scrollBefore),
        },
      }
    },
    {
      trigger: surface.trigger,
      insertPx: INSERT_PX,
      keyboardPx: KEYBOARD_PX,
      raiseAfterMs: RAISE_AFTER_FOCUS_MS,
    },
  )
}

function distribution(steps: number[]) {
  const sorted = [...steps].sort((a, b) => a - b)
  const at = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  return `frames ${steps.length} · field px/frame min ${sorted[0]} p10 ${at(0.1)} median ${at(0.5)} p90 ${at(0.9)} max ${sorted.at(-1)}`
}

for (const [name, surface] of [
  ["drawer", DRAWER],
  ["AvoidKeyboard", AVOID],
] as const) {
  test(`${name}: anchoring adds no second adjustment to adaptv's scroll, and keeps the row at rest`, async ({
    browser,
  }, testInfo) => {
    const runs: Record<Anchor, Run> = {} as Record<Anchor, Run>
    for (const anchor of ["none", "shipped"] as const) {
      //a fresh context per run, carrying the project's device (iPhone 13 on webkit)
      const { baseURL, userAgent, deviceScaleFactor, isMobile, hasTouch } =
        testInfo.project.use
      const context = await browser.newContext({
        baseURL,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        viewport: { width: 390, height: 844 },
      })
      try {
        const page = await context.newPage()
        await openSurface(page, surface, anchor)
        runs[anchor] = await measure(page, surface)
      } finally {
        await context.close()
      }
    }
    const { shipped, none } = runs
    await testInfo.attach("runs", {
      body: JSON.stringify(
        {
          shipped: { ...shipped, steps: distribution(shipped.steps) },
          none: { ...none, steps: distribution(none.steps) },
        },
        null,
        2,
      ),
      contentType: "application/json",
    })

    //the premise: the insertion landed while adaptv's scroll was still travelling
    for (const run of [shipped, none]) {
      expect(run.moved, "adaptv's scroll never started").toBe(true)
      expect(
        run.landing.scrollTop - run.scrollAtInsert,
        "the insertion landed after the scroll had finished",
      ).toBeGreaterThan(INSERT_PX)
    }

    //the control is real: with overflow-anchor forced off, the at-rest insertion is not
    //anchored. Without this, a control that never applied would equal the shipped run and
    //make the landing comparison below vacuous.
    expect(
      none.rest.scrollDelta,
      "the control did not turn anchoring off",
    ).toBe(0)
    expect(Math.round(none.rest.fieldAfter - none.rest.fieldBefore)).toBe(
      INSERT_PX,
    )

    //no second adjustment: the landing does not depend on the browser anchoring
    expect(
      Math.abs(shipped.landing.scrollTop - none.landing.scrollTop),
      `landing with anchoring ${JSON.stringify(shipped.landing)} vs without ${JSON.stringify(none.landing)}`,
    ).toBeLessThanOrEqual(2)
    expect(
      Math.abs(shipped.landing.fieldTop - none.landing.fieldTop),
    ).toBeLessThanOrEqual(2)

    //both surfaces aim again after the insertion (the drawer's re-aim, AvoidKeyboard's
    //keyboard raise and its look when the scroll ends), so the field ends clear: the drawer's 12px margin, AvoidKeyboard's
    //buffer
    expect(
      shipped.landing.clearance,
      `field clearance ${shipped.landing.clearance}px`,
    ).toBeGreaterThanOrEqual(0)
    expect(shipped.landing.clearance).toBeLessThanOrEqual(40)

    //at rest the row keeps its place — anchoring on the scroller adaptv drives is intact
    expect(
      Math.abs(shipped.rest.fieldAfter - shipped.rest.fieldBefore),
      `at rest the field moved ${shipped.rest.fieldBefore} -> ${shipped.rest.fieldAfter}`,
    ).toBeLessThanOrEqual(1)
    expect(shipped.rest.scrollDelta).toBe(INSERT_PX)
  })
}
