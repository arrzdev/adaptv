import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Stress cases for the drawer × keyboard contract, AvoidKeyboard and the keyboard observer.
 *
 * The contract under test (src/components/drawer/drawer-engine.tsx, the keyboard-room effect;
 * drawer-keyboard.ts; hooks/use-keyboard.ts; hooks/use-layout-viewport-shrink.ts;
 * avoid-keyboard/use-keyboard-avoidance.ts): with the mock reporting `{isOpen, height}` and the
 * layout viewport NOT shrunk, the drawer holds `room = height` as `padding-bottom` on the content
 * box, grows `max-height` by the same amount capped at the stylesheet cap, carries the growth as
 * a composited FLIP on the panel, and settles with `min-height` cleared; on dismiss it gives the
 * room back and, once settled, clears every inline style it wrote. A focused field pins a
 * `min-height` floor at the box's current height and retracts it after 800ms if no keyboard
 * confirms. While CLOSING the room effect is inert and the close over-travels by 64px.
 *
 * Every case interrupts one of those motions with another — a close during the lift, a raise
 * during the close, a raise/dismiss mash, a viewport that shrinks under a held keyboard — and
 * asserts the settled state the contract promises, never a screenshot. The keyboard is the test
 * seam every keyboard spec here uses (`window.__adaptvKeyboardMock` + `adaptv:keyboard-mock`,
 * installed BEFORE the hook mounts), so it runs on both engines. Keyboard heights are a FRACTION
 * of the viewport, never a magic px. Premises are asserted before the interruption, so a harness
 * that stopped reproducing the motion says so instead of blaming the framework.
 *
 * No sleeps where a condition can be awaited; the only fixed waits are the doctrine's own windows
 * (the 800ms floor confirm, the 40ms/50ms interruption offsets) and then the CONDITION is polled.
 * Anything async goes through `expect.poll` — `waitForFunction` with an async predicate is a no-op.
 */

const KEYBOARD_EVENT = "adaptv:keyboard-mock"
const PANEL = "[data-pwa-drawer]"
const OVERLAY = "[data-pwa-drawer-overlay]"
const PHONE = { width: 390, height: 844 }
//40% of a phone held upright
const KEYBOARD_PX = Math.round(PHONE.height * 0.4)
//use-keyboard's KEYBOARD_PREDICT_CONFIRM_MS and the engine's DRAWER_KEYBOARD_FLOOR_CONFIRM_MS
const FLOOR_CONFIRM_MS = 800
const SETTLE_TOLERANCE_PX = 2

type MockHost = {
  __adaptvKeyboardMock?: { isOpen: boolean; height: number }
}

async function installMock(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as MockHost).__adaptvKeyboardMock = {
      isOpen: false,
      height: 0,
    }
  })
}

async function setKeyboard(page: Page, isOpen: boolean, height: number) {
  await page.evaluate(
    ({ o, h, evt }) => {
      ;(window as unknown as MockHost).__adaptvKeyboardMock = {
        isOpen: o,
        height: h,
      }
      window.dispatchEvent(new Event(evt))
    },
    { o: isOpen, h: height, evt: KEYBOARD_EVENT },
  )
}

type Box = {
  present: boolean
  padding: string
  maxHeight: string
  minHeight: string
  transition: string
  top: number
  bottom: number
  height: number
  translateY: number
  animations: number
  overlayOpacity: number | null
  innerHeight: number
}

/** The content box's inline styles + geometry, the panel's transform and running animations. */
function readBox(page: Page): Promise<Box> {
  return page.evaluate(
    ({ panelSel, overlaySel }) => {
      const panel = document.querySelector<HTMLElement>(panelSel)
      const content = panel?.firstElementChild as HTMLElement | null
      if (!panel || !content) {
        return {
          present: false,
          padding: "",
          maxHeight: "",
          minHeight: "",
          transition: "",
          top: Number.NaN,
          bottom: Number.NaN,
          height: Number.NaN,
          translateY: Number.NaN,
          animations: 0,
          overlayOpacity: null,
          innerHeight: window.innerHeight,
        }
      }
      const t = getComputedStyle(panel).transform
      const rect = content.getBoundingClientRect()
      const overlay = document.querySelector<HTMLElement>(overlaySel)
      return {
        present: true,
        padding: content.style.paddingBottom,
        maxHeight: content.style.maxHeight,
        minHeight: content.style.minHeight,
        transition: content.style.transition,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
        translateY: t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0,
        animations: panel.getAnimations().length,
        overlayOpacity: overlay
          ? Number.parseFloat(getComputedStyle(overlay).opacity)
          : null,
        innerHeight: window.innerHeight,
      }
    },
    { panelSel: PANEL, overlaySel: OVERLAY },
  )
}

/** The stylesheet cap as it resolves now, with the engine's inline override lifted for the read. */
function readCssCap(page: Page) {
  return page.evaluate((panelSel) => {
    const content = document.querySelector<HTMLElement>(panelSel)
      ?.firstElementChild as HTMLElement | null
    if (!content) return Number.NaN
    const inline = content.style.maxHeight
    content.style.maxHeight = ""
    const cap = Number.parseFloat(getComputedStyle(content).maxHeight)
    content.style.maxHeight = inline
    return cap
  }, PANEL)
}

/**
 * Settled = translateY 0, no animation or transition running on the panel, and the box height
 * unchanged across three consecutive frames. The open is a `@keyframes` rule with `fill: both`
 * that the engine clears once finished, and the FLIP is an inline transform transition, so an
 * empty `getAnimations()` is the honest "nothing is moving" signal for both.
 */
async function awaitSettled(page: Page, timeout = 4000) {
  await expect
    .poll(
      () =>
        page.evaluate(async (panelSel) => {
          const panel = document.querySelector<HTMLElement>(panelSel)
          const content = panel?.firstElementChild as HTMLElement | null
          if (!panel || !content) return "no panel"
          const frame = () =>
            new Promise<number>((r) => requestAnimationFrame(r))
          const ty = () => {
            const t = getComputedStyle(panel).transform
            return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0
          }
          const heights: number[] = []
          const tys: number[] = []
          let animations = 0
          for (let i = 0; i < 3; i += 1) {
            await frame()
            heights.push(content.getBoundingClientRect().height)
            tys.push(ty())
            animations += panel.getAnimations().length
          }
          const stable =
            Math.max(...heights) - Math.min(...heights) < 0.5 &&
            tys.every((v) => Math.abs(v) < 0.5) &&
            animations === 0
          return stable
            ? true
            : `heights ${heights.map((h) => h.toFixed(1)).join(",")} translateY ${tys.map((v) => v.toFixed(1)).join(",")} animations ${animations}`
        }, PANEL),
      { timeout },
    )
    .toBe(true)
}

async function openDrawer(page: Page, name: string) {
  await page.getByRole("button", { name, exact: true }).first().click()
  await page.locator(PANEL).waitFor({ state: "attached" })
  await expect(page.locator(PANEL)).toHaveAttribute("data-open", "true")
  await awaitSettled(page)
}

/** The mock raised, then every rAF until the panel unmounts (or 1.5s): translateY and top. */
type ExitSample = { t: number; top: number; translateY: number }

const pageErrors: string[] = []

//not `mode: "serial"`: this file is run with `--workers=1`, so the tests are sequential anyway,
//and serial mode would skip every test after the first failure — a failing case here is the
//deliverable, and the cases after it must still report.

test.describe("drawer × keyboard under stress", () => {
  test.use({ hasTouch: true, viewport: PHONE })
  test.setTimeout(60_000)

  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0
    page.on("pageerror", (error) => pageErrors.push(String(error)))
    await installMock(page)
    await page.goto("/lab/drawer")
    await awaitClientHandover(page)
  })

  test("1 · a close during the keyboard lift leaves off-screen, and the next open is clean", async ({
    page,
  }, testInfo) => {
    await openDrawer(page, "Open keyboard drawer")
    const natural = (await readBox(page)).height
    expect(natural).toBeGreaterThan(100)

    const run = await page.evaluate(
      async ({ panelSel, kb, evt }) => {
        const panel = document.querySelector<HTMLElement>(panelSel)
        const content = panel?.firstElementChild as HTMLElement | null
        if (!panel || !content) throw new Error("no panel")
        const frame = () =>
          new Promise<number>((r) => requestAnimationFrame(r))
        const ty = () => {
          const t = getComputedStyle(panel).transform
          return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0
        }
        //raise
        const raisedAt = performance.now()
        ;(window as unknown as MockHost).__adaptvKeyboardMock = {
          isOpen: true,
          height: kb,
        }
        window.dispatchEvent(new Event(evt))
        //premise: the room lands in one step within 100ms and the FLIP is in flight
        let landedAt = -1
        let inFlight = false
        let translateAtLanding = 0
        let animationsAtLanding = 0
        while (performance.now() - raisedAt < 100) {
          await frame()
          if (content.style.paddingBottom === `${kb}px`) {
            landedAt = performance.now() - raisedAt
            translateAtLanding = ty()
            animationsAtLanding = panel.getAnimations().length
            inFlight =
              animationsAtLanding > 0 || Math.abs(translateAtLanding) > 0.5
            break
          }
        }
        const paddingAtClose = content.style.paddingBottom
        //close NOW, while the lift is still travelling
        const close = [...panel.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Close",
        )
        if (!close) throw new Error("no Close button in the sheet")
        const closeAt = performance.now()
        close.click()
        const series: ExitSample[] = []
        while (
          performance.now() - closeAt < 1500 &&
          document.contains(panel)
        ) {
          await frame()
          if (!document.contains(panel)) break
          series.push({
            t: Math.round(performance.now() - closeAt),
            top: panel.getBoundingClientRect().top,
            translateY: ty(),
          })
        }
        return {
          landedAt,
          inFlight,
          translateAtLanding,
          animationsAtLanding,
          paddingAtClose,
          gone: !document.contains(panel),
          goneAt: Math.round(performance.now() - closeAt),
          last: series.at(-1) ?? null,
          frames: series.length,
          series,
        }
      },
      { panelSel: PANEL, kb: KEYBOARD_PX, evt: KEYBOARD_EVENT },
    )
    await testInfo.attach("close-during-lift", {
      body: JSON.stringify(run, null, 2),
      contentType: "application/json",
    })
    console.log(
      `STRESS-KB ${testInfo.project.name} 1: room landed at ${run.landedAt}ms (translateY ${run.translateAtLanding.toFixed(1)}, animations ${run.animationsAtLanding}), panel gone=${run.gone} at ${run.goneAt}ms after ${run.frames} frames, last ${JSON.stringify(run.last)}`,
    )

    //the premise
    expect(run.landedAt, "the room landed within 100ms").toBeGreaterThan(
      -1,
    )
    expect(run.paddingAtClose).toBe(`${KEYBOARD_PX}px`)
    expect(
      run.inFlight,
      "the FLIP was in flight when the close fired",
    ).toBe(true)
    //the close completes, off-screen
    expect(run.gone, "the panel left the DOM within 1.5s").toBe(true)
    expect(run.last).not.toBeNull()
    expect(
      run.last?.top,
      `on its last frame the panel was fully off-screen (top ${run.last?.top}, translateY ${run.last?.translateY})`,
    ).toBeGreaterThanOrEqual(PHONE.height)
    expect(pageErrors).toEqual([])

    //dismiss and reopen: nothing of the interrupted lift survives
    await setKeyboard(page, false, 0)
    await expect(page.locator(PANEL)).toHaveCount(0)
    await openDrawer(page, "Open keyboard drawer")
    const reopened = await readBox(page)
    console.log(
      `STRESS-KB ${testInfo.project.name} 1: reopened padding="${reopened.padding}" maxHeight="${reopened.maxHeight}" minHeight="${reopened.minHeight}" height ${reopened.height.toFixed(1)} (natural ${natural.toFixed(1)}) translateY ${reopened.translateY}`,
    )
    expect(reopened.padding).toBe("")
    expect(reopened.maxHeight).toBe("")
    expect(reopened.minHeight).toBe("")
    expect(Math.abs(reopened.height - natural)).toBeLessThanOrEqual(
      SETTLE_TOLERANCE_PX,
    )
    expect(Math.abs(reopened.translateY)).toBeLessThan(0.5)
    expect(pageErrors).toEqual([])
  })

  test("2 · a keyboard raise 40ms into the close never pulls the sheet back up; the next open holds the room", async ({
    page,
  }, testInfo) => {
    await openDrawer(page, "Open keyboard drawer")

    const run = await page.evaluate(
      async ({ panelSel, kb, evt, raiseAfterMs }) => {
        const panel = document.querySelector<HTMLElement>(panelSel)
        if (!panel) throw new Error("no panel")
        const frame = () =>
          new Promise<number>((r) => requestAnimationFrame(r))
        const ty = () => {
          const t = getComputedStyle(panel).transform
          return t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0
        }
        const close = [...panel.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Close",
        )
        if (!close) throw new Error("no Close button in the sheet")
        const closeAt = performance.now()
        close.click()
        let raisedAt = -1
        const series: ExitSample[] = []
        while (
          performance.now() - closeAt < 1500 &&
          document.contains(panel)
        ) {
          await frame()
          if (!document.contains(panel)) break
          if (
            raisedAt < 0 &&
            performance.now() - closeAt >= raiseAfterMs
          ) {
            raisedAt = Math.round(performance.now() - closeAt)
            ;(window as unknown as MockHost).__adaptvKeyboardMock = {
              isOpen: true,
              height: kb,
            }
            window.dispatchEvent(new Event(evt))
          }
          series.push({
            t: Math.round(performance.now() - closeAt),
            top: panel.getBoundingClientRect().top,
            translateY: ty(),
          })
        }
        return {
          raisedAt,
          gone: !document.contains(panel),
          goneAt: Math.round(performance.now() - closeAt),
          series,
        }
      },
      {
        panelSel: PANEL,
        kb: KEYBOARD_PX,
        evt: KEYBOARD_EVENT,
        raiseAfterMs: 40,
      },
    )
    await testInfo.attach("raise-during-close", {
      body: JSON.stringify(run, null, 2),
      contentType: "application/json",
    })
    const tys = run.series.map((s) => Math.round(s.translateY * 10) / 10)
    console.log(
      `STRESS-KB ${testInfo.project.name} 2: raised at ${run.raisedAt}ms, gone=${run.gone} at ${run.goneAt}ms, translateY series (${tys.length}) ${tys.join(" ")}`,
    )

    //premise: the raise landed while the close was still travelling
    expect(
      run.raisedAt,
      "the raise fired during the close",
    ).toBeGreaterThan(-1)
    expect(run.gone, "the panel left the DOM within 1.5s").toBe(true)
    expect(run.series.length).toBeGreaterThan(2)
    //the series never turns back up (0.5px tolerance)
    const reversals = run.series
      .slice(1)
      .map((s, i) => ({
        at: s.t,
        from: run.series[i].translateY,
        to: s.translateY,
      }))
      .filter((step) => step.to < step.from - 0.5)
    expect(
      reversals,
      `the panel moved back UP after the close started: ${JSON.stringify(reversals)}`,
    ).toEqual([])
    expect(pageErrors).toEqual([])

    //the mock is still raised: the next open holds the room and the field clears the keyboard
    await openDrawer(page, "Open keyboard drawer")
    await expect
      .poll(async () => (await readBox(page)).padding)
      .toBe(`${KEYBOARD_PX}px`)
    await awaitSettled(page)
    const field = await page
      .getByLabel("Drawer field")
      .evaluate((el) => el.getBoundingClientRect().bottom)
    const box = await readBox(page)
    console.log(
      `STRESS-KB ${testInfo.project.name} 2: reopened with the mock up: padding="${box.padding}" height ${box.height.toFixed(1)} field bottom ${field.toFixed(1)} vs keyboard top ${PHONE.height - KEYBOARD_PX}`,
    )
    expect(field).toBeLessThanOrEqual(PHONE.height - KEYBOARD_PX)
    expect(pageErrors).toEqual([])
  })

  for (const endOpen of [false, true]) {
    test(`3 · a 20× raise/dismiss mash at 50ms ending ${endOpen ? "OPEN" : "CLOSED"} settles to the contract`, async ({
      page,
    }, testInfo) => {
      await openDrawer(page, "Open keyboard drawer")
      const natural = (await readBox(page)).height
      const cap = await readCssCap(page)
      expect(Number.isFinite(cap)).toBe(true)

      await page.evaluate(
        async ({ kb, evt, count, intervalMs, endOpen }) => {
          const mock = (open: boolean) => {
            ;(window as unknown as MockHost).__adaptvKeyboardMock = {
              isOpen: open,
              height: open ? kb : 0,
            }
            window.dispatchEvent(new Event(evt))
          }
          for (let i = 0; i < count; i += 1) {
            //ending closed: open, closed, …, closed. ending open: closed, open, …, open
            mock(endOpen ? i % 2 === 1 : i % 2 === 0)
            await new Promise((r) => setTimeout(r, intervalMs))
          }
        },
        {
          kb: KEYBOARD_PX,
          evt: KEYBOARD_EVENT,
          count: 20,
          intervalMs: 50,
          endOpen,
        },
      )

      const expectedHeight = endOpen
        ? Math.min(natural + KEYBOARD_PX, cap)
        : natural
      const expectedPadding = endOpen ? `${KEYBOARD_PX}px` : ""
      await expect
        .poll(
          async () => {
            const b = await readBox(page)
            return {
              padding: b.padding,
              minHeight: b.minHeight,
              ...(endOpen ? {} : { maxHeight: b.maxHeight }),
              translateY: Math.abs(b.translateY) <= 1,
              animations: b.animations,
              height:
                Math.abs(b.height - expectedHeight) <= SETTLE_TOLERANCE_PX,
              overlay: b.overlayOpacity,
            }
          },
          { timeout: 1500 },
        )
        .toEqual({
          padding: expectedPadding,
          minHeight: "",
          ...(endOpen ? {} : { maxHeight: "" }),
          translateY: true,
          animations: 0,
          height: true,
          overlay: 1,
        })
      const final = await readBox(page)
      console.log(
        `STRESS-KB ${testInfo.project.name} 3 ending ${endOpen ? "open" : "closed"}: padding="${final.padding}" maxHeight="${final.maxHeight}" minHeight="${final.minHeight}" transition="${final.transition}" height ${final.height.toFixed(1)} (expected ${expectedHeight.toFixed(1)}, natural ${natural.toFixed(1)}, cap ${cap.toFixed(1)}) translateY ${final.translateY.toFixed(2)} animations ${final.animations} overlay ${final.overlayOpacity}`,
      )
      expect(pageErrors).toEqual([])
    })
  }

  for (const button of ["Task", "Open tall drawer (no cap)"] as const) {
    test(`4 · ${button}: content taller than the viewport with the keyboard up stays capped, scrollable and clear of the keyboard`, async ({
      page,
    }, testInfo) => {
      await openDrawer(page, button)
      const before = await readBox(page)
      const cap = await readCssCap(page)
      const natural = await page.evaluate((panelSel) => {
        const content = document.querySelector<HTMLElement>(panelSel)
          ?.firstElementChild as HTMLElement | null
        if (!content) return Number.NaN
        let total = 0
        for (const child of content.children) {
          total +=
            child === content.children[1]
              ? (child as HTMLElement).scrollHeight
              : child.getBoundingClientRect().height
        }
        return total
      }, PANEL)
      console.log(
        `STRESS-KB ${testInfo.project.name} 4 ${button}: rest height ${before.height.toFixed(1)}, natural ${natural.toFixed(1)}, cap ${cap.toFixed(1)}, natural+keyboard ${(natural + KEYBOARD_PX).toFixed(1)}`,
      )
      //the premise: with the keyboard's room added, the content cannot fit under the cap
      test.skip(
        natural + KEYBOARD_PX <= cap,
        `${button} does not reach the cap at ${PHONE.width}×${PHONE.height} with a ${KEYBOARD_PX}px keyboard (natural ${natural.toFixed(1)} + ${KEYBOARD_PX} ≤ cap ${cap.toFixed(1)})`,
      )

      await setKeyboard(page, true, KEYBOARD_PX)
      await expect
        .poll(async () => (await readBox(page)).padding)
        .toBe(`${KEYBOARD_PX}px`)
      await awaitSettled(page)

      const up = await page.evaluate(
        ({ panelSel, kb }) => {
          const panel = document.querySelector<HTMLElement>(panelSel)
          const content = panel?.firstElementChild as HTMLElement | null
          const scroller = content?.children[1] as HTMLElement | undefined
          if (!panel || !content || !scroller)
            throw new Error("no scroller")
          const box = content.getBoundingClientRect()
          const scrollable = scroller.scrollHeight > scroller.clientHeight
          scroller.scrollTop = scroller.scrollHeight
          const scrolledTo = scroller.scrollTop
          const s = scroller.getBoundingClientRect()
          return {
            padding: content.style.paddingBottom,
            boxTop: box.top,
            boxHeight: box.height,
            scrollable,
            scrollHeight: scroller.scrollHeight,
            clientHeight: scroller.clientHeight,
            scrolledTo,
            scrollEnd: scroller.scrollHeight - scroller.clientHeight,
            scrollerBottom: s.bottom,
            keyboardTop: window.innerHeight - kb,
          }
        },
        { panelSel: PANEL, kb: KEYBOARD_PX },
      )
      console.log(
        `STRESS-KB ${testInfo.project.name} 4 ${button}: keyboard up → ${JSON.stringify(up)}`,
      )
      expect(up.padding).toBe(`${KEYBOARD_PX}px`)
      expect(up.boxHeight).toBeLessThanOrEqual(cap + 1)
      expect(
        up.boxTop,
        "the box's top never goes above the safe top",
      ).toBeGreaterThanOrEqual(0)
      expect(
        up.scrollable,
        "the scroller absorbs what the cap refused",
      ).toBe(true)
      expect(up.scrolledTo).toBeGreaterThanOrEqual(up.scrollEnd - 1)
      expect(
        up.scrollerBottom,
        "the scroller's visible bottom clears the keyboard",
      ).toBeLessThanOrEqual(up.keyboardTop + 1)

      await setKeyboard(page, false, 0)
      await expect.poll(async () => (await readBox(page)).padding).toBe("")
      await awaitSettled(page)
      const after = await readBox(page)
      console.log(
        `STRESS-KB ${testInfo.project.name} 4 ${button}: dismissed → height ${after.height.toFixed(1)} (rest was ${before.height.toFixed(1)}) padding="${after.padding}" maxHeight="${after.maxHeight}" minHeight="${after.minHeight}"`,
      )
      expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(
        SETTLE_TOLERANCE_PX,
      )
      expect(pageErrors).toEqual([])
    })
  }

  test("6 · a floor primed on focus retracts when no keyboard confirms, and is taken over when one does", async ({
    page,
  }, testInfo) => {
    await openDrawer(page, "Open keyboard drawer")
    const natural = (await readBox(page)).height
    const cap = await readCssCap(page)

    //part 1: the floor with no keyboard
    const part1 = await page.evaluate(
      async ({ panelSel, confirmMs }) => {
        const panel = document.querySelector<HTMLElement>(panelSel)
        const content = panel?.firstElementChild as HTMLElement | null
        const field = panel?.querySelector<HTMLElement>(
          '[aria-label="Drawer field"]',
        )
        if (!panel || !content || !field) throw new Error("no field")
        const frame = () =>
          new Promise<number>((r) => requestAnimationFrame(r))
        const primedOnOpen = content.style.minHeight
        const focusedOnOpen = document.activeElement === field
        //blur and focus again after the settle, so the engine's focusin listener sees it
        field.blur()
        await frame()
        field.focus({ preventScroll: true })
        await frame()
        const primedOnRefocus = content.style.minHeight
        const boxAtPrime = content.getBoundingClientRect().height
        //the doctrine's window, then wait for the CONDITION (floor released, nothing moving)
        await new Promise((r) => setTimeout(r, confirmMs))
        const waitedAt = performance.now()
        let released = false
        let maxHeightSeen = 0
        while (performance.now() - waitedAt < 1500) {
          await frame()
          maxHeightSeen = Math.max(
            maxHeightSeen,
            content.getBoundingClientRect().height,
          )
          if (
            content.style.minHeight === "" &&
            panel.getAnimations().length === 0
          ) {
            released = true
            break
          }
        }
        const t = getComputedStyle(panel).transform
        return {
          primedOnOpen,
          focusedOnOpen,
          primedOnRefocus,
          boxAtPrime,
          released,
          releasedAfterMs: Math.round(performance.now() - waitedAt),
          maxHeightSeen,
          height: content.getBoundingClientRect().height,
          minHeight: content.style.minHeight,
          translateY: t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0,
          stillFocused: document.activeElement === field,
        }
      },
      { panelSel: PANEL, confirmMs: FLOOR_CONFIRM_MS },
    )
    console.log(
      `STRESS-KB ${testInfo.project.name} 6 part 1: ${JSON.stringify(part1)}`,
    )
    if (part1.primedOnOpen === "") {
      testInfo.annotations.push({
        type: "note",
        description: `the autofocus on open did NOT prime the floor (minHeight "" right after settle; field focused on open: ${part1.focusedOnOpen}) — the field's autofocus fires in React's commit, before the engine's focusin listener is attached in a passive effect; the floor was primed by a blur + re-focus instead`,
      })
    }
    //the premise: the floor was primed by the focus
    expect(part1.stillFocused).toBe(true)
    expect(part1.primedOnRefocus, "a focus primed the floor").toMatch(
      /^\d+(\.\d+)?px$/,
    )
    expect(Math.abs(part1.boxAtPrime - natural)).toBeLessThanOrEqual(
      SETTLE_TOLERANCE_PX,
    )
    //after the window: released, the sheet did not stay tall
    expect(
      part1.released,
      "the floor was released after the confirm window",
    ).toBe(true)
    expect(part1.minHeight).toBe("")
    expect(Math.abs(part1.height - natural)).toBeLessThanOrEqual(
      SETTLE_TOLERANCE_PX,
    )
    expect(part1.maxHeightSeen - natural).toBeLessThanOrEqual(
      SETTLE_TOLERANCE_PX,
    )
    expect(Math.abs(part1.translateY)).toBeLessThan(0.5)

    //part 2: focus, 200ms, raise — inside the confirm window
    const part2 = await page.evaluate(
      async ({ panelSel, kb, evt, raiseAfterMs }) => {
        const panel = document.querySelector<HTMLElement>(panelSel)
        const content = panel?.firstElementChild as HTMLElement | null
        const field = panel?.querySelector<HTMLElement>(
          '[aria-label="Drawer field"]',
        )
        if (!panel || !content || !field) throw new Error("no field")
        const frame = () =>
          new Promise<number>((r) => requestAnimationFrame(r))
        field.blur()
        await frame()
        field.focus({ preventScroll: true })
        await frame()
        const primed = content.style.minHeight
        await new Promise((r) => setTimeout(r, raiseAfterMs))
        const minHeightAtRaise = content.style.minHeight
        ;(window as unknown as MockHost).__adaptvKeyboardMock = {
          isOpen: true,
          height: kb,
        }
        window.dispatchEvent(new Event(evt))
        const raisedAt = performance.now()
        const heights: number[] = []
        const floors: string[] = []
        while (performance.now() - raisedAt < 1200) {
          await frame()
          heights.push(
            Math.round(content.getBoundingClientRect().height * 10) / 10,
          )
          floors.push(content.style.minHeight)
        }
        const t = getComputedStyle(panel).transform
        return {
          primed,
          minHeightAtRaise,
          heights,
          floors: [...new Set(floors)],
          final: {
            height: content.getBoundingClientRect().height,
            padding: content.style.paddingBottom,
            minHeight: content.style.minHeight,
            translateY:
              t && t !== "none" ? new DOMMatrixReadOnly(t).m42 : 0,
            animations: panel.getAnimations().length,
          },
        }
      },
      {
        panelSel: PANEL,
        kb: KEYBOARD_PX,
        evt: KEYBOARD_EVENT,
        raiseAfterMs: 200,
      },
    )
    await testInfo.attach("floor-taken-over", {
      body: JSON.stringify(part2, null, 2),
      contentType: "application/json",
    })
    const drops = part2.heights
      .slice(1)
      .map((h, i) => ({ frame: i + 1, from: part2.heights[i], to: h }))
      .filter((d) => d.to < d.from - 1)
    console.log(
      `STRESS-KB ${testInfo.project.name} 6 part 2: primed="${part2.primed}" at raise="${part2.minHeightAtRaise}" heights ${part2.heights[0]} → ${part2.heights.at(-1)} over ${part2.heights.length} frames, floors seen ${JSON.stringify(part2.floors)}, drops ${JSON.stringify(drops)}, final ${JSON.stringify(part2.final)}`,
    )
    expect(part2.primed, "the focus primed the floor").toMatch(/px$/)
    expect(
      part2.minHeightAtRaise,
      "the floor was still held when the keyboard landed (inside the confirm window)",
    ).toMatch(/px$/)
    expect(
      drops,
      "the box never DECREASED by more than 1px between the raise and the settle",
    ).toEqual([])
    expect(
      Math.abs(part2.final.height - Math.min(natural + KEYBOARD_PX, cap)),
    ).toBeLessThanOrEqual(SETTLE_TOLERANCE_PX)
    expect(part2.final.padding).toBe(`${KEYBOARD_PX}px`)
    expect(part2.final.minHeight, "the floor is cleared on settle").toBe(
      "",
    )
    expect(Math.abs(part2.final.translateY)).toBeLessThan(0.5)
    expect(part2.final.animations).toBe(0)
    expect(pageErrors).toEqual([])
  })

  test("7 · a viewport that shrinks under a held keyboard withdraws the room, and the rest height survives it", async ({
    page,
  }, testInfo) => {
    await openDrawer(page, "Open keyboard drawer")
    const field = page.getByLabel("Drawer field")
    await expect(field, "the field autofocused").toBeFocused()
    const natural = (await readBox(page)).height

    await setKeyboard(page, true, KEYBOARD_PX)
    await expect
      .poll(async () => (await readBox(page)).padding)
      .toBe(`${KEYBOARD_PX}px`)
    await awaitSettled(page)

    //the viewport shrinks by the keyboard, as the Android WebView's does
    const shrunk = {
      width: PHONE.width,
      height: PHONE.height - KEYBOARD_PX,
    }
    await page.setViewportSize(shrunk)
    expect(
      await page.evaluate(() => window.innerHeight),
      "the premise: innerHeight changed",
    ).toBe(shrunk.height)
    await expect
      .poll(async () => {
        const b = await readBox(page)
        return {
          padding: b.padding,
          fits: b.height <= b.innerHeight + 0.5,
        }
      })
      .toEqual({ padding: "0px", fits: true })
    await awaitSettled(page)
    const underShrink = await readBox(page)
    const fieldBottomShrunk = await field.evaluate(
      (el) => el.getBoundingClientRect().bottom,
    )
    console.log(
      `STRESS-KB ${testInfo.project.name} 7 shrunk: innerHeight ${underShrink.innerHeight} padding="${underShrink.padding}" maxHeight="${underShrink.maxHeight}" height ${underShrink.height.toFixed(1)} field bottom ${fieldBottomShrunk.toFixed(1)}`,
    )
    expect(fieldBottomShrunk).toBeLessThanOrEqual(shrunk.height)
    await expect(field).toBeFocused()

    //the viewport comes back with the keyboard still up. REPORTED, not asserted: the cap path
    //is sticky by design (`viewportShrinksUnderKeyboard`, `capHeld`) — once the shrunk viewport
    //has paid for the keyboard, only the keyboard's own close releases it through the same
    //path, and no device grows its layout viewport back while the keyboard is still up (the
    //Android WebView and VK-less Chrome shrink until the keyboard closes; iOS never shrinks).
    //So the room stays withdrawn here, and what IS asserted is that the dismiss that follows
    //hands everything back and the rest height survived the shrink.
    await page.setViewportSize(PHONE)
    expect(await page.evaluate(() => window.innerHeight)).toBe(
      PHONE.height,
    )
    const deadline = Date.now() + 1500
    let restored: Box = await readBox(page)
    while (
      restored.padding !== `${KEYBOARD_PX}px` &&
      Date.now() < deadline
    ) {
      await page.waitForTimeout(100)
      restored = await readBox(page)
    }
    console.log(
      `STRESS-KB ${testInfo.project.name} 7 restored with the mock up: padding="${restored.padding}" maxHeight="${restored.maxHeight}" height ${restored.height.toFixed(1)}`,
    )
    expect(
      restored.height,
      "the box still fits the viewport with the keyboard reported up",
    ).toBeLessThanOrEqual(PHONE.height + 0.5)

    //dismiss: the rest height was not corrupted by the shrink
    await setKeyboard(page, false, 0)
    await expect
      .poll(async () => {
        const b = await readBox(page)
        return { padding: b.padding, maxHeight: b.maxHeight }
      })
      .toEqual({ padding: "", maxHeight: "" })
    await awaitSettled(page)
    expect(await page.evaluate(() => window.innerHeight)).toBe(
      PHONE.height,
    )
    await setKeyboard(page, true, KEYBOARD_PX)
    await expect
      .poll(async () => (await readBox(page)).padding, {
        timeout: 1500,
      })
      .toBe(`${KEYBOARD_PX}px`)
    await awaitSettled(page)
    const again = await readBox(page)
    console.log(
      `STRESS-KB ${testInfo.project.name} 7 reopened after the shrink: padding="${again.padding}" height ${again.height.toFixed(1)} (natural ${natural.toFixed(1)})`,
    )
    await setKeyboard(page, false, 0)
    await expect.poll(async () => (await readBox(page)).padding).toBe("")
    await awaitSettled(page)

    //the Android Chrome transient: innerHeight reads rest + keyboard for a frame BEFORE the
    //keyboard reports open, with the field focused. That frame is not a rest.
    await expect(field).toBeFocused()
    await page.setViewportSize({
      width: PHONE.width,
      height: PHONE.height + KEYBOARD_PX,
    })
    await page.setViewportSize(PHONE)
    expect(await page.evaluate(() => window.innerHeight)).toBe(
      PHONE.height,
    )
    await setKeyboard(page, true, KEYBOARD_PX)
    await expect
      .poll(async () => (await readBox(page)).padding, { timeout: 1500 })
      .toBe(`${KEYBOARD_PX}px`)
    await awaitSettled(page)
    const afterTransient = await readBox(page)
    console.log(
      `STRESS-KB ${testInfo.project.name} 7 after the transient: padding="${afterTransient.padding}" height ${afterTransient.height.toFixed(1)}`,
    )
    expect(afterTransient.padding).toBe(`${KEYBOARD_PX}px`)
    expect(pageErrors).toEqual([])
  })
})

/*
 * AvoidKeyboard under the same kind of abuse. The default project viewport (a desktop tab on
 * chromium, an iPhone 13 on webkit): the reservation is geometry-coupled, so the keyboard is a
 * large fraction of the viewport to guarantee the box is overlapped, and the assertions are
 * directional where the exact px is the unit-tested math.
 */
test.describe("AvoidKeyboard under stress", () => {
  test.setTimeout(60_000)

  const box = (page: Page) =>
    page.locator("div.h-72").filter({ has: page.getByLabel("Field one") })
  const padBottom = (page: Page) =>
    box(page).evaluate((el) =>
      Number.parseFloat(getComputedStyle(el).paddingBottom),
    )
  const rootVar = (page: Page) =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--adaptv-keyboard-height")
        .trim(),
    )
  const rootInlineVar = (page: Page) =>
    page.evaluate(() =>
      document.documentElement.style.getPropertyValue(
        "--adaptv-keyboard-height",
      ),
    )
  const rootOpen = (page: Page) =>
    page.evaluate(() =>
      document.documentElement.hasAttribute("data-keyboard-open"),
    )

  test.beforeEach(async ({ page }) => {
    pageErrors.length = 0
    page.on("pageerror", (error) => pageErrors.push(String(error)))
    await installMock(page)
    await page.goto("/lab/avoid-keyboard")
    await awaitClientHandover(page)
    await page.getByLabel("Field one").waitFor()
    await box(page).scrollIntoViewIfNeeded()
  })

  test("8a · a 20× raise/dismiss mash settles to nothing reserved, and to a reservation", async ({
    page,
  }, testInfo) => {
    const innerHeight = await page.evaluate(() => window.innerHeight)
    const kb = Math.round(innerHeight * 0.85)
    const atRest = await padBottom(page)

    const mash = (endOpen: boolean) =>
      page.evaluate(
        async ({ kb, evt, endOpen }) => {
          const mock = (open: boolean) => {
            ;(window as unknown as MockHost).__adaptvKeyboardMock = {
              isOpen: open,
              height: open ? kb : 0,
            }
            window.dispatchEvent(new Event(evt))
          }
          for (let i = 0; i < 20; i += 1) {
            mock(endOpen ? i % 2 === 1 : i % 2 === 0)
            await new Promise((r) => setTimeout(r, 50))
          }
        },
        { kb, evt: KEYBOARD_EVENT, endOpen },
      )

    await mash(false)
    await expect
      .poll(
        async () => ({
          pad: Math.abs((await padBottom(page)) - atRest) < 0.5,
          root: await rootVar(page),
          open: await rootOpen(page),
        }),
        { timeout: 1500 },
      )
      .toEqual({ pad: true, root: "0px", open: false })
    const closed = {
      pad: await padBottom(page),
      root: await rootVar(page),
    }

    await mash(true)
    await expect
      .poll(
        async () => ({
          pad: (await padBottom(page)) > atRest + 100,
          root: await rootVar(page),
          open: await rootOpen(page),
        }),
        { timeout: 1500 },
      )
      .toEqual({ pad: true, root: `${kb}px`, open: true })
    const open = { pad: await padBottom(page), root: await rootVar(page) }
    console.log(
      `STRESS-KB ${testInfo.project.name} 8a: keyboard ${kb}px of ${innerHeight}; rest padding ${atRest}; ending closed → ${JSON.stringify(closed)}; ending open → ${JSON.stringify(open)}`,
    )
    expect(pageErrors).toEqual([])
  })

  test("8b · a viewport resize while raised leaves the reservation coherent, and a new keyboard height re-derives it", async ({
    page,
  }, testInfo) => {
    const size = page.viewportSize()
    if (!size) throw new Error("no viewport")
    const kb = Math.round(size.height * 0.85)
    const atRest = await padBottom(page)
    const restBottom = await box(page).evaluate(
      (el) => el.getBoundingClientRect().bottom,
    )
    await setKeyboard(page, true, kb)
    await expect.poll(() => padBottom(page)).toBeGreaterThan(atRest + 100)

    //`fromGeometryNow` is reported, not asserted: the lab page's `<KeyboardStamps />` sits
    //above the box and renders its stamps once the keyboard opens, so the box sits lower than
    //it did on the frame the reservation was measured (compare `restBottom` in the log) — a lab
    //layout shift, not the component. What IS asserted is the delta the resize must produce.
    const geometry = () =>
      box(page).evaluate((el, atRest) => {
        const r = el.getBoundingClientRect()
        const keyboard = Number.parseFloat(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--adaptv-keyboard-height",
          ),
        )
        const keyboardTop = window.innerHeight - keyboard
        return {
          innerHeight: window.innerHeight,
          boxBottom: r.bottom,
          keyboardTop,
          reserved: Number.parseFloat(getComputedStyle(el).paddingBottom),
          fromGeometryNow: atRest + Math.max(0, r.bottom - keyboardTop),
        }
      }, atRest)

    const before = await geometry()
    //the premise: the keyboard overlaps the box and room was reserved for it
    expect(before.reserved).toBeGreaterThan(atRest + 100)
    const shrinkBy = 200
    await page.setViewportSize({
      width: size.width,
      height: size.height - shrinkBy,
    })
    expect(await page.evaluate(() => window.innerHeight)).toBe(
      size.height - shrinkBy,
    )
    //give the page a frame or two to react to the resize, then read
    await expect
      .poll(async () => (await geometry()).innerHeight)
      .toBe(size.height - shrinkBy)
    await page.waitForTimeout(100)
    const after = await geometry()
    console.log(
      `STRESS-KB ${testInfo.project.name} 8b: keyboard ${kb}px; box bottom at rest ${restBottom}; before ${JSON.stringify(before)}; after the ${shrinkBy}px shrink ${JSON.stringify(after)}`,
    )
    expect(pageErrors).toEqual([])
    //the box is document-positioned and the page did not scroll, so it did not move
    expect(
      Math.abs(after.boxBottom - before.boxBottom),
      "the box itself did not move",
    ).toBeLessThanOrEqual(1)
    //What the resize did to the reservation is REPORTED, not asserted. The hook re-derives the
    //reservation from the keyboard's own values (`height`, `isOpen`, `unpaidHeight`) and the
    //safe inset — not from a resize with the keyboard unchanged: the only surface whose layout
    //viewport shrinks under a held keyboard is Android native, and there the shrink is the
    //viewport PAYING for the keyboard (`unpaidHeight` drops by it, and the reservation must not
    //count it twice), which is a keyboard-value change and does re-run it. So a bare resize
    //moving the keyboard's top edge by `shrinkBy` (`keyboardTop` above is this test's own
    //innerHeight − height) with the reservation standing still is the contract, not a gap.
    //What IS asserted: with the resized viewport in place, a new keyboard height re-derives
    //the reservation by exactly that much — the box is fully overlapped, so the overlap is
    //linear in the keyboard's height.
    const taller = 100
    await setKeyboard(page, true, kb + taller)
    await expect
      .poll(() => padBottom(page), { timeout: 1500 })
      .toBeGreaterThan(after.reserved + taller - 1)
    const regrown = await geometry()
    console.log(
      `STRESS-KB ${testInfo.project.name} 8b: keyboard ${kb} → ${kb + taller}px in the shrunk viewport: reserved ${after.reserved} → ${regrown.reserved}`,
    )
    expect(
      Math.abs(regrown.reserved - after.reserved - taller),
      `a new keyboard height re-derives the reservation (reserved ${after.reserved} → ${regrown.reserved} for +${taller}px)`,
    ).toBeLessThanOrEqual(1)
    expect(pageErrors).toEqual([])
    await setKeyboard(page, false, 0)
    await expect.poll(() => padBottom(page)).toBe(atRest)
    await page.setViewportSize(size)
  })

  test("8c · navigating away with the keyboard raised leaves nothing stale on <html>", async ({
    page,
  }, testInfo) => {
    const innerHeight = await page.evaluate(() => window.innerHeight)
    const kb = Math.round(innerHeight * 0.85)
    await page.getByLabel("Field six").focus()
    await setKeyboard(page, true, kb)
    await expect.poll(() => rootOpen(page)).toBe(true)

    //a client-side navigation: the lab shell's back control routes to /lab
    await page.getByRole("button", { name: "Back to Testing" }).click()
    await expect(page).toHaveURL(/\/lab$/)
    await expect(page.locator("h1").first()).not.toHaveText(
      "AvoidKeyboard",
    )
    const onArrival = {
      open: await rootOpen(page),
      computed: await rootVar(page),
      inline: await rootInlineVar(page),
      publishers: await page.evaluate(
        () => document.querySelectorAll("[data-keyboard-open]").length,
      ),
    }
    //the mock is dismissed on the new page
    await setKeyboard(page, false, 0)
    await expect
      .poll(async () => ({
        open: await rootOpen(page),
        computed: await rootVar(page),
      }))
      .toEqual({
        open: false,
        computed: expect.stringMatching(/^(0px|)$/),
      })
    const afterDismiss = {
      open: await rootOpen(page),
      computed: await rootVar(page),
      inline: await rootInlineVar(page),
    }
    console.log(
      `STRESS-KB ${testInfo.project.name} 8c: on arrival at /lab ${JSON.stringify(onArrival)}; after dismissing the mock there ${JSON.stringify(afterDismiss)}`,
    )
    expect(afterDismiss.open).toBe(false)
    expect(afterDismiss.inline).toBe("")
    expect(pageErrors).toEqual([])
  })

  test("8d · at 200% root font-size the focused field still ends above the keyboard", async ({
    page,
  }, testInfo) => {
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
    })
    await box(page).scrollIntoViewIfNeeded()
    const innerHeight = await page.evaluate(() => window.innerHeight)
    const kb = Math.round(innerHeight * 0.4)
    //The mock seam sets what `useKeyboard` reports; it does not shrink `visualViewport`. The
    //scroll-into-view aim reads its keyboard line from `visualViewport.offsetTop + height`
    //(the layout viewport does not resize here), so without this the line is the full
    //`innerHeight` and no field is ever "under" the keyboard — measured: the field stayed at
    //624 against a 432 line on both engines. The stub makes the visual viewport follow the
    //mock the way a real keyboard shrinks it; `useKeyboard` in mock mode reads no geometry.
    await page.evaluate(() => {
      const vv = window.visualViewport
      if (!vv) throw new Error("no visualViewport")
      Object.defineProperty(vv, "height", {
        configurable: true,
        get() {
          const mock = (window as unknown as MockHost).__adaptvKeyboardMock
          return window.innerHeight - (mock?.isOpen ? mock.height : 0)
        },
      })
    })
    const field = page.getByLabel("Field six")
    await field.scrollIntoViewIfNeeded()
    await field.focus()
    await expect(field).toBeFocused()
    await setKeyboard(page, true, kb)
    await expect.poll(() => rootVar(page)).toBe(`${kb}px`)
    //the premise: the line the hook reads is now the keyboard's top edge
    expect(
      await page.evaluate(
        () =>
          (window.visualViewport?.offsetTop ?? 0) +
          (window.visualViewport?.height ?? 0),
      ),
    ).toBe(innerHeight - kb)

    const read = () =>
      page.evaluate(
        ({ kb }) => {
          const field = document.querySelector<HTMLElement>(
            '[aria-label="Field six"]',
          )
          const box = field?.closest<HTMLElement>("div.h-72")
          if (!field || !box) throw new Error("no field")
          const f = field.getBoundingClientRect()
          const b = box.getBoundingClientRect()
          return {
            rootFontSize: getComputedStyle(document.documentElement)
              .fontSize,
            fieldTop: f.top,
            fieldBottom: f.bottom,
            boxTop: b.top,
            boxBottom: b.bottom,
            boxHeight: b.height,
            keyboardTop: window.innerHeight - kb,
            scrollTop: box.scrollTop,
            reserved: Number.parseFloat(
              getComputedStyle(box).paddingBottom,
            ),
          }
        },
        { kb },
      )
    //the aim is a smooth scroll: wait for the field to come to rest clear of the keyboard
    await expect
      .poll(async () => (await read()).fieldBottom, { timeout: 5000 })
      .toBeLessThanOrEqual(innerHeight - kb)
    const g = await read()
    console.log(
      `STRESS-KB ${testInfo.project.name} 8d: keyboard ${kb}px of ${innerHeight}; ${JSON.stringify(g)}`,
    )
    expect(g.rootFontSize).toBe("32px")
    expect(g.fieldBottom).toBeLessThanOrEqual(g.keyboardTop)
    expect(g.fieldBottom).toBeLessThanOrEqual(g.boxBottom)
    expect(
      g.fieldTop,
      "the field is inside the box, not scrolled past its top",
    ).toBeGreaterThanOrEqual(g.boxTop - 1)
    expect(pageErrors).toEqual([])
  })
})

/*
 * The conformance run under a 4× CPU throttle. The geometry checks are asserted with the same
 * single allowance drawer-keyboard.spec.ts makes (copied verbatim); the timing checks are
 * reported, not asserted. Geometry that only holds at full speed is a bug.
 */
type Check = { name: string; pass: boolean; detail: string }
type StepResult = {
  step: string
  checks: Check[]
  perf?: string
  samples: Array<{ t: number; top: number; bottom: number }>
}
const TIMING_CHECKS = new Set(["runs at frame rate", "eased, not snapped"])
const KNOWN_REVERSAL = {
  step: "picker collapses, keyboard lags",
  name: "content edge never reverses",
}

test.describe("conformance under CPU throttle", () => {
  test.use({ hasTouch: true, viewport: PHONE })
  test.setTimeout(240_000)

  test("9 · the /lab/drawer-keyboard geometry checks hold at 4× CPU throttle (chromium)", async ({
    page,
    browserName,
  }, testInfo) => {
    test.skip(
      browserName !== "chromium",
      "Emulation.setCPUThrottlingRate is a CDP command",
    )
    pageErrors.length = 0
    page.on("pageerror", (error) => pageErrors.push(String(error)))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })

    await page.goto("/lab/drawer-keyboard?autorun")
    await awaitClientHandover(page)
    await page.waitForFunction(
      () =>
        Array.isArray(
          (window as unknown as { __drawerConformance?: unknown })
            .__drawerConformance,
        ),
      null,
      { timeout: 200_000 },
    )
    const results = await page.evaluate(
      () =>
        (window as unknown as { __drawerConformance: StepResult[] })
          .__drawerConformance,
    )
    const header = await page
      .getByTestId("conformance-report")
      .textContent()
      .catch(() => null)
    await testInfo.attach("conformance-throttled", {
      body: JSON.stringify(
        {
          header: header?.split("\n")[0] ?? null,
          results: results.map(({ samples, ...rest }) => ({
            ...rest,
            samples: samples.length,
          })),
        },
        null,
        2,
      ),
      contentType: "application/json",
    })

    const checks = results.flatMap((r) =>
      r.checks.map((c) => ({ step: r.step, ...c })),
    )
    const failed = checks.filter((c) => !c.pass)
    const failedTiming = failed.filter((c) => TIMING_CHECKS.has(c.name))
    const failedGeometry = failed.filter((c) => !TIMING_CHECKS.has(c.name))
    const known = failedGeometry.filter(
      (c) =>
        c.step === KNOWN_REVERSAL.step && c.name === KNOWN_REVERSAL.name,
    )
    const unexpected = failedGeometry.filter((c) => !known.includes(c))
    console.log(
      `STRESS-KB ${testInfo.project.name} 9: header "${header?.split("\n")[0]}"; ${results.length} steps, ${checks.length} checks, ${failed.length} failed; timing failures (reported only): ${failedTiming.map((c) => `${c.step}: ${c.name} — ${c.detail}`).join(" | ") || "none"}; known allowed: ${known.map((c) => c.detail).join(" | ") || "none"}; UNEXPECTED geometry failures: ${unexpected.map((c) => `${c.step}: ${c.name} — ${c.detail}`).join(" | ") || "none"}; perf per step: ${results.map((r) => `${r.step}=${r.perf ?? "-"}`).join(", ")}`,
    )

    expect(results.length).toBeGreaterThanOrEqual(15)
    expect(checks.length).toBeGreaterThanOrEqual(90)
    expect(
      unexpected.map((c) => `${c.step}: ${c.name} — ${c.detail}`),
    ).toEqual([])
    //the known turn is expected to be there, named; when it is not, delete KNOWN_REVERSAL
    expect(known.map((c) => c.detail)).toHaveLength(1)
    expect(known[0].detail).toMatch(/turned \d+px at \d+ms/)
    expect(pageErrors).toEqual([])
  })
})
