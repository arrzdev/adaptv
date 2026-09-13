import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * Spinner — the engine facts behind its three quirks, measured in the two engines
 * adaptv ships on (chromium = Android WebView, webkit = iOS). The unit suite pins the
 * stylesheet text and the React contract; this spec asks the ENGINE what it did with
 * them:
 *
 *   - Q1: the 100 spinners below the spacer report `paused` from getAnimations() on
 *     both engines, resume when scrolled in, pause again when scrolled out; a spinner
 *     under a display:none ancestor has no animation at all; and on chromium the page
 *     measurably idles — RecalcStyleCount over 2 s with the field paused is the same
 *     as with no field, and far below the always-on control (the pause overridden);
 *   - Q2: the running animation is a CSS animation on the HTML <span>, keyframing
 *     `transform` — never on the <svg> — on both engines; and on chromium the
 *     engine's own trace says it started on the compositor (compositeFailed 0);
 *   - reduced motion swaps the turn for an opacity pulse on the svg child — so a
 *     consumer's opacity on the box still applies — and an off-screen spinner stays
 *     paused under it;
 *   - a labelled spinner is a progressbar with its name, three of them mounting
 *     together are announced once, and the one inside a busy button is hidden;
 *   - under forced colors (chromium) the arc paints in the forced text colour.
 *
 * No retries, no warm-ups, no async waitForFunction predicates
 * (playground-touch-e2e-patterns, playwright-waitforfunction-not-awaited). Every
 * idle phase asserts its PREMISE — how many spinner animations are running — so a
 * probe that measured the wrong page state says so (prove-the-page-idles).
 */

const FIELD = '[data-testid="spinner-field"] [data-adaptv="spinner"]'

/** Uncaught errors and console errors — a hydration mismatch fails the spec here. */
function collectErrors(page: Page): string[] {
  const errors: string[] = []
  page.on("pageerror", (error) =>
    errors.push(`uncaught: ${String(error)}`),
  )
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text())
  })
  return errors
}

async function openSpinner(page: Page) {
  await page.goto("/lab/spinner")
  await awaitClientHandover(page)
}

type States = { running: number; paused: number; none: number }

/**
 * Play states of every spinner matching `selector`, as the engine reports them: the
 * turn on the box, or under reduced motion the pulse on its svg (hence `subtree`).
 */
function playStates(page: Page, selector: string): Promise<States> {
  return page.evaluate((sel) => {
    const states = { running: 0, paused: 0, none: 0 }
    for (const el of document.querySelectorAll(sel)) {
      const animation = el.getAnimations({ subtree: true })[0]
      if (!animation) states.none += 1
      else if (animation.playState === "paused") states.paused += 1
      else if (animation.playState === "running") states.running += 1
    }
    return states
  }, selector)
}

/** Every running animation in the document, spinner or not — the idle premise. */
function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
  )
}

test.describe("Spinner", () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page)
    await openSpinner(page)
  })

  test.afterEach(() => {
    expect(errors).toEqual([])
  })

  test("Q1: the off-screen field is paused, resumes when scrolled in, and pauses again", async ({
    page,
  }) => {
    const field = page.getByTestId("spinner-field")
    //the premise: the spacer really pushes the field off this viewport
    const box = await field.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(box?.y ?? 0).toBeGreaterThan(viewport?.height ?? 0)

    await expect
      .poll(() => playStates(page, FIELD))
      .toEqual({ running: 0, paused: 100, none: 0 })
    //the pause is the observer's stamp, not some other rule
    await expect(
      page.locator(`${FIELD}[data-spinner-offscreen]`),
    ).toHaveCount(100)

    await field.scrollIntoViewIfNeeded()
    await expect
      .poll(() => playStates(page, FIELD))
      .toEqual({ running: 100, paused: 0, none: 0 })

    await page
      .getByRole("heading", { name: "Spinner", level: 1 })
      .scrollIntoViewIfNeeded()
    await expect
      .poll(() => playStates(page, FIELD))
      .toEqual({ running: 0, paused: 100, none: 0 })
    console.log(
      `[spinner-q1 ${test.info().project.name}] field paused → running → paused`,
    )
  })

  test("Q1: a spinner under a display:none ancestor is not animating", async ({
    page,
  }) => {
    const selector = '[data-testid="spinner-hidden"]'
    await page.getByTestId("spinner-hidden-host").scrollIntoViewIfNeeded()
    await expect
      .poll(() => playStates(page, selector))
      .toEqual({ running: 1, paused: 0, none: 0 })

    await page.getByRole("button", { name: "Hide", exact: true }).click()
    await expect
      .poll(() => playStates(page, selector))
      .toEqual({ running: 0, paused: 0, none: 1 })

    await page.getByRole("button", { name: "Show", exact: true }).click()
    await expect
      .poll(() => playStates(page, selector))
      .toEqual({ running: 1, paused: 0, none: 0 })
  })

  test("Q2: the animation keyframes transform on the HTML span, and nothing animates the svg", async ({
    page,
  }) => {
    const spinner = page.getByTestId("spinner-busy")
    //scroll the BUTTON beside it: Playwright waits for a stable box before it
    //scrolls, and a turning spinner never has one
    await page
      .getByRole("button", { name: "Busy main thread 1 s" })
      .scrollIntoViewIfNeeded()
    await expect
      .poll(() => playStates(page, '[data-testid="spinner-busy"]'))
      .toEqual({
        running: 1,
        paused: 0,
        none: 0,
      })
    const shape = await spinner.evaluate((el) => {
      const animations = el.getAnimations()
      const animation = animations[0] as CSSAnimation | undefined
      const effect = animation?.effect as KeyframeEffect | undefined
      const keyframes = effect?.getKeyframes() ?? []
      const svg = el.querySelector("svg")
      return {
        count: animations.length,
        kind: animation?.constructor.name ?? null,
        name: animation?.animationName ?? null,
        targetIsHtml: effect?.target instanceof HTMLElement,
        targetIsSelf: effect?.target === el,
        properties: [
          ...new Set(
            keyframes.flatMap((frame) =>
              Object.keys(frame).filter(
                (key) =>
                  ![
                    "offset",
                    "computedOffset",
                    "easing",
                    "composite",
                  ].includes(key),
              ),
            ),
          ),
        ],
        svgAnimations: svg?.getAnimations({ subtree: true }).length ?? -1,
      }
    })
    console.log(
      `[spinner-q2 ${test.info().project.name}] ${JSON.stringify(shape)}`,
    )
    expect(shape).toEqual({
      count: 1,
      kind: "CSSAnimation",
      name: "adaptv-spinner-spin",
      targetIsHtml: true,
      targetIsSelf: true,
      properties: ["transform"],
      svgAnimations: 0,
    })
  })

  test("Q2: chromium starts the spinner's animation on the compositor", async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "the compositeFailed trace event is Chromium's; WebKit has no equivalent",
    )
    const host = page.getByTestId("spinner-hidden-host")
    await host.scrollIntoViewIfNeeded()
    //start a FRESH animation inside the trace: the hide cancels it, the show restarts it
    await page.getByRole("button", { name: "Hide", exact: true }).click()
    await browser.startTracing(page, {
      categories: ["devtools.timeline", "blink.animations"],
    })
    await page.getByRole("button", { name: "Show", exact: true }).click()
    //wherever in the spinner the animation runs — this test is the one that says WHERE
    await expect
      .poll(() =>
        page
          .getByTestId("spinner-hidden")
          .evaluate(
            (el) =>
              el
                .getAnimations({ subtree: true })
                .filter((a) => a.playState === "running").length,
          ),
      )
      .toBe(1)
    //the verdict is an instant event on a later frame than the start; give the
    //trace a few frames to carry it before it closes
    await page.waitForTimeout(500)
    const trace = JSON.parse((await browser.stopTracing()).toString()) as {
      traceEvents: Array<{
        name: string
        ph: string
        id2?: { local?: string }
        args?: {
          data?: {
            displayName?: string
            nodeName?: string
            compositeFailed?: number
          }
        }
      }>
    }
    const events = trace.traceEvents.filter((e) => e.name === "Animation")
    //the spinner's animations, by the async id every later event carries
    const ids = new Set(
      events
        .filter((e) =>
          e.args?.data?.displayName?.startsWith("adaptv-spinner"),
        )
        .map((e) => e.id2?.local),
    )
    const begun = events.filter(
      (e) =>
        e.ph === "b" &&
        e.args?.data?.displayName?.startsWith("adaptv-spinner"),
    )
    const verdicts = events
      .filter(
        (e) =>
          ids.has(e.id2?.local) &&
          typeof e.args?.data?.compositeFailed === "number",
      )
      .map((e) => e.args?.data?.compositeFailed)
    console.log(
      `[spinner-q2-trace chromium] nodes=${JSON.stringify([...new Set(begun.map((e) => e.args?.data?.nodeName?.split(" ")[0]))])} compositeFailed=${JSON.stringify(verdicts)}`,
    )
    //premise: the trace saw the spinner's animation start, on a SPAN, and judged it
    expect(begun.length).toBeGreaterThan(0)
    for (const e of begun)
      expect(e.args?.data?.nodeName).toMatch(/^SPAN\b/)
    expect(verdicts.length).toBeGreaterThan(0)
    //0 = no failure reason: it runs on the compositor, so a busy main thread cannot
    //stall it (an <svg> rotated with `rotate:` reads 524288 here)
    expect(verdicts.every((v) => v === 0)).toBe(true)
  })

  test("a labelled spinner is a named progressbar, announced once for three", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Start loading" }).click()
    const host = page.getByTestId("spinner-label-host")
    await expect(
      host.getByRole("progressbar", { name: "Loading tasks" }),
    ).toHaveCount(3)
    await expect(page.getByTestId("spinner-in-button")).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    await expect(page.getByTestId("spinner-button")).toHaveAttribute(
      "aria-busy",
      "true",
    )

    const lines = () =>
      page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '[data-adaptv="spinner-announcer"] > *',
          ),
        ].map((line) => line.textContent),
      )
    await expect.poll(lines).toEqual(["Loading tasks"])
    const region = page.locator('[data-adaptv="spinner-announcer"]')
    await expect(region).toHaveCount(1)
    await expect(region).toHaveAttribute("role", "status")
    await expect(region).toHaveAttribute("aria-live", "polite")
    //still one, well past the delay — three instances were not three announcements
    await page.waitForTimeout(600)
    expect(await lines()).toEqual(["Loading tasks"])
    console.log(
      `[spinner-announce ${test.info().project.name}] ${JSON.stringify(await lines())}`,
    )
  })

  test("chromium's own accessibility tree agrees", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP Accessibility is Chromium-only; WebKit's tree is read on the simulator",
    )
    await page.getByRole("button", { name: "Start loading" }).click()
    await expect(page.getByTestId("spinner-labelled")).toBeAttached()
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("DOM.enable")
    await cdp.send("Accessibility.enable")
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 })
    const axOf = async (testId: string) => {
      const { nodeId } = await cdp.send("DOM.querySelector", {
        nodeId: root.nodeId,
        selector: `[data-testid="${testId}"]`,
      })
      expect(nodeId, `${testId} is in the DOM`).toBeGreaterThan(0)
      const { nodes } = await cdp.send("Accessibility.getPartialAXTree", {
        nodeId,
        fetchRelatives: false,
      })
      return {
        ignored: nodes[0]?.ignored ?? null,
        role: nodes[0]?.role?.value ?? null,
        name: nodes[0]?.name?.value ?? null,
      }
    }
    const labelled = await axOf("spinner-labelled")
    const inButton = await axOf("spinner-in-button")
    const decorative = await axOf("spinner-busy")
    console.log(
      `[spinner-ax chromium] ${JSON.stringify({ labelled, inButton, decorative })}`,
    )
    expect(labelled).toEqual({
      ignored: false,
      role: "progressbar",
      name: "Loading tasks",
    })
    expect(inButton.ignored).toBe(true)
    expect(decorative.ignored).toBe(true)
  })

  test("forced colors: the arc paints in the forced text colour", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Playwright's forcedColors emulation is Chromium-only",
    )
    const read = () =>
      page.getByTestId("spinner-busy").evaluate((el) => {
        const path = el.querySelector("path")
        //the system text colour, read off a plain element outside the spinner
        const probe = document.createElement("span")
        probe.style.color = "CanvasText"
        document.body.appendChild(probe)
        const canvasText = getComputedStyle(probe).color
        probe.remove()
        return {
          color: getComputedStyle(el).color,
          stroke: path ? getComputedStyle(path).stroke : null,
          canvasText,
        }
      })
    const normal = await read()
    await page.emulateMedia({ forcedColors: "active" })
    const forced = await read()
    console.log(
      `[spinner-forced chromium] ${JSON.stringify({ normal, forced })}`,
    )
    expect(normal.stroke).toBe(normal.color)
    //premise: forcing colours changed this page's text colour at all
    expect(forced.canvasText).not.toBe(normal.color)
    //the arc took the forced colour — not merely "stroke equals color", which also
    //holds when the spinner opts out with forced-color-adjust: none
    expect(forced.stroke).toBe(forced.canvasText)
    expect(forced.stroke).not.toBe(normal.stroke)
  })
})

/*
 * The idle measurement (memory prove-the-page-idles): three phases on ONE page, each
 * with its premise asserted and three 2-second windows. RecalcStyleCount rather than
 * a duration, because a count does not move with machine load.
 *
 *   gated     — the field mounted and paused, nothing on screen running
 *   always-on — the SAME page with the pause overridden: the control that proves the
 *               field costs something when it is not paused
 *   no field  — the field unmounted: what an idle page reads
 *
 * Measured while writing this (chromium, 3 windows each): gated 1-2, always-on 13-17,
 * the SVG `rotate:` shape with no pause 241. The page is never scrolled and nothing is
 * clicked through Playwright (which scrolls); the unmount is a DOM click.
 */
test.describe("Spinner idle cost (chromium, CDP)", () => {
  let errors: string[] = []

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "Performance.getMetrics is CDP; WebKit's pause is asserted by play state above",
    )
    errors = collectErrors(page)
    await openSpinner(page)
  })

  test.afterEach(() => {
    expect(errors).toEqual([])
  })

  const WINDOW_MS = 2000
  const WINDOWS = 3

  async function recalcs(cdp: CDPSession) {
    const { metrics } = await cdp.send("Performance.getMetrics")
    const value = (name: string) =>
      metrics.find((m) => m.name === name)?.value ?? Number.NaN
    return {
      style: value("RecalcStyleCount"),
      layout: value("LayoutCount"),
      styleMs: value("RecalcStyleDuration") * 1000,
    }
  }

  /** Median RecalcStyleCount / LayoutCount delta over {@link WINDOWS} windows. */
  async function measure(page: Page, cdp: CDPSession, phase: string) {
    const style: number[] = []
    const layout: number[] = []
    const styleMs: number[] = []
    for (let i = 0; i < WINDOWS; i++) {
      const before = await recalcs(cdp)
      await page.waitForTimeout(WINDOW_MS)
      const after = await recalcs(cdp)
      style.push(after.style - before.style)
      layout.push(after.layout - before.layout)
      styleMs.push(+(after.styleMs - before.styleMs).toFixed(2))
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[1]
    console.log(
      `[spinner-idle chromium] ${phase}: style ${JSON.stringify(style)} layout ${JSON.stringify(layout)} styleMs ${JSON.stringify(styleMs)}`,
    )
    return { style: median(style), layout: median(layout) }
  }

  /**
   * Poll `read` until it equals `expected` or 10 s pass, and return what it last read.
   * Not an assertion: the phases below MEASURE whatever state they got and assert the
   * premises at the end, so a broken pause still prints its numbers before it fails.
   */
  async function settle<T>(
    read: () => Promise<T>,
    expected: T,
  ): Promise<T> {
    const deadline = Date.now() + 10_000
    let value = await read()
    while (
      JSON.stringify(value) !== JSON.stringify(expected) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      value = await read()
    }
    return value
  }

  test("100 paused off-screen spinners cost what no spinners cost", async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")

    //gated
    const gatedField = await settle(() => playStates(page, FIELD), {
      running: 0,
      paused: 100,
      none: 0,
    })
    const gatedRunning = await settle(() => runningAnimations(page), 0)
    const gated = await measure(page, cdp, "gated")

    //always-on control: the pause overridden, nothing else changed
    const override = await page.addStyleTag({
      content:
        '[data-adaptv="spinner"][data-spinner-offscreen] { animation-play-state: running !important; }',
    })
    const alwaysOnField = await settle(() => playStates(page, FIELD), {
      running: 100,
      paused: 0,
      none: 0,
    })
    const alwaysOn = await measure(page, cdp, "always-on control")
    await override.evaluate((node) => node.remove())

    //no field
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (b) => b.textContent === "Unmount the field",
      )
      button?.click()
    })
    await expect(page.getByTestId("spinner-field")).toHaveCount(0)
    const noFieldRunning = await settle(() => runningAnimations(page), 0)
    const noField = await measure(page, cdp, "no field")
    console.log(
      `[spinner-idle chromium] premises: gated field ${JSON.stringify(gatedField)} running ${gatedRunning} · always-on field ${JSON.stringify(alwaysOnField)} · no field running ${noFieldRunning}`,
    )

    //the premises: each phase measured the state it names
    expect(gatedField).toEqual({ running: 0, paused: 100, none: 0 })
    expect(gatedRunning).toBe(0)
    expect(alwaysOnField).toEqual({ running: 100, paused: 0, none: 0 })
    expect(noFieldRunning).toBe(0)
    //the control costs something, so the gated phase's quiet is a comparison
    expect(alwaysOn.style).toBeGreaterThanOrEqual(8)
    //paused reads like no field at all (measured 1 against 13-17)
    expect(gated.style).toBeLessThanOrEqual(noField.style + 3)
    expect(gated.style * 4).toBeLessThan(alwaysOn.style)
    expect(gated.layout).toBe(0)
  })
})

/*
 * Reduced motion, emulated BEFORE the navigation (a describe-level `reducedMotion`
 * did not reach the page on either engine — memory reduced-motion-on-the-sim-and-emulator).
 */
test.describe("Spinner under prefers-reduced-motion", () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openSpinner(page)
  })

  test.afterEach(() => {
    expect(errors).toEqual([])
  })

  test("pulses its drawing instead of turning — never stops — and still pauses off screen", async ({
    page,
  }) => {
    const spinner = page.getByTestId("spinner-busy")
    //scroll the BUTTON beside it: Playwright waits for a stable box before it
    //scrolls, and a turning spinner never has one
    await page
      .getByRole("button", { name: "Busy main thread 1 s" })
      .scrollIntoViewIfNeeded()
    await expect
      .poll(() => playStates(page, '[data-testid="spinner-busy"]'))
      .toEqual({ running: 1, paused: 0, none: 0 })
    const shape = await spinner.evaluate((el) => {
      const animations = el.getAnimations({ subtree: true })
      const animation = animations[0] as CSSAnimation | undefined
      const effect = animation?.effect as KeyframeEffect | undefined
      const keyframes = effect?.getKeyframes() ?? []
      //a consumer's opacity on the box, set while the pulse runs: an animation on the
      //box itself would override it, one on the child multiplies with it
      el.style.opacity = "0.5"
      const boxOpacity = getComputedStyle(el).opacity
      el.style.opacity = ""
      return {
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        count: animations.length,
        boxAnimations: el.getAnimations().length,
        targetIsSvgChild:
          effect?.target instanceof SVGSVGElement &&
          effect.target.parentElement === el,
        boxOpacity,
        name: animation?.animationName ?? null,
        properties: [
          ...new Set(
            keyframes.flatMap((frame) =>
              Object.keys(frame).filter(
                (key) =>
                  ![
                    "offset",
                    "computedOffset",
                    "easing",
                    "composite",
                  ].includes(key),
              ),
            ),
          ),
        ],
      }
    })
    console.log(
      `[spinner-reduced ${test.info().project.name}] ${JSON.stringify(shape)}`,
    )
    expect(shape).toEqual({
      reduced: true,
      count: 1,
      boxAnimations: 0,
      targetIsSvgChild: true,
      boxOpacity: "0.5",
      name: "adaptv-spinner-pulse",
      properties: ["opacity"],
    })

    //the shorthand in the media block resets play state; the pause must still win
    await expect
      .poll(() => playStates(page, FIELD))
      .toEqual({ running: 0, paused: 100, none: 0 })
  })
})
