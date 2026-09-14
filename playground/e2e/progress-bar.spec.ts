import type { Browser, CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * ProgressBar — the engine facts behind what it owns, asked of the two engines adaptv
 * ships on (chromium = Android WebView, webkit = iOS). The unit suite pins the
 * stylesheet text and the React contract; this spec asks the ENGINE what it did:
 *
 *   - the fill eases by `transform`: across the transition the indicator's layout
 *     width never changes while its painted width grows from the left edge (both
 *     engines), and on chromium the transition and the sweep start on the compositor
 *     and the fill lays out no frame;
 *   - an off-screen indeterminate field reports `paused`, resumes on screen, pauses
 *     again (both engines), and on chromium the page idles against the always-on
 *     control (prove-the-page-idles);
 *   - RTL: the fill is anchored to the right edge, and the sweep travels leftwards;
 *   - reduced motion: a full-width opacity pulse, never a stop, no fill transition,
 *     and the field still pauses;
 *   - forced colors (chromium): the fill keeps the forced text colour, where a plain
 *     background would have been repainted away;
 *   - chromium's own accessibility tree: a named progressbar with its value.
 *
 * No retries, no warm-ups, no async waitForFunction predicates
 * (playground-touch-e2e-patterns, playwright-waitforfunction-not-awaited). Every
 * measurement asserts its PREMISE first, so a probe that measured the wrong page state
 * says so.
 */

const FIELD = '[data-testid="progress-field"] [data-adaptv="progress-bar"]'
const INDICATOR = '> [data-part="indicator"]'

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

async function openProgressBar(page: Page) {
  await page.goto("/lab/progress-bar")
  await awaitClientHandover(page)
}

type States = { running: number; paused: number; none: number }

/** Play states of every bar matching `selector` (its indicator, hence `subtree`). */
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

/** Every running animation in the document — the idle premise. */
function runningAnimations(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document
        .getAnimations()
        .filter((animation) => animation.playState === "running").length,
  )
}

/** The value buttons are plain lab buttons; click one by its exact text, from the DOM. */
function clickValue(page: Page, text: string) {
  return page.evaluate((label) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === label,
    )
    if (!button) throw new Error(`no button "${label}"`)
    button.click()
  }, text)
}

/**
 * Click `text` and sample the determinate indicator on every frame for `ms`: its
 * layout width (offsetWidth), its painted box, the track's box, and the animations on
 * it. The click happens inside the same evaluate, so frame 0 is the click's frame.
 */
function sampleFill(page: Page, text: string, ms: number) {
  return page.evaluate(
    ({ label, duration }) =>
      new Promise<{
        layoutWidths: number[]
        paintedWidths: number[]
        leftOffsets: number[]
        rightOffsets: number[]
        trackWidth: number
        transitions: string[]
      }>((resolve) => {
        const bar = document.querySelector(
          '[data-testid="progress-determinate"]',
        ) as HTMLElement
        const indicator = bar.querySelector(
          '[data-part="indicator"]',
        ) as HTMLElement
        const button = [...document.querySelectorAll("button")].find(
          (b) => b.textContent === label,
        ) as HTMLButtonElement
        const out = {
          layoutWidths: [] as number[],
          paintedWidths: [] as number[],
          leftOffsets: [] as number[],
          rightOffsets: [] as number[],
          trackWidth: bar.getBoundingClientRect().width,
          transitions: [] as string[],
        }
        button.click()
        const start = performance.now()
        const frame = () => {
          //React commits the click after the event, so the transition (if any) is
          //read per frame, not synchronously after click()
          for (const a of indicator.getAnimations()) {
            const name = `${a.constructor.name}:${(a as CSSTransition).transitionProperty ?? (a as CSSAnimation).animationName}`
            if (!out.transitions.includes(name)) out.transitions.push(name)
          }
          const box = bar.getBoundingClientRect()
          const painted = indicator.getBoundingClientRect()
          out.layoutWidths.push(indicator.offsetWidth)
          out.paintedWidths.push(+painted.width.toFixed(2))
          out.leftOffsets.push(+(painted.left - box.left).toFixed(2))
          out.rightOffsets.push(+(box.right - painted.right).toFixed(2))
          if (performance.now() - start < duration)
            requestAnimationFrame(frame)
          else resolve(out)
        }
        requestAnimationFrame(frame)
      }),
    { label: text, duration: ms },
  )
}

/** Keyframed properties of an animation, minus the timing keys. */
const KEYFRAME_META = ["offset", "computedOffset", "easing", "composite"]

test.describe("ProgressBar", () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page)
    await openProgressBar(page)
  })

  test.afterEach(() => {
    expect(errors).toEqual([])
  })

  test("determinate: a named progressbar exposing a clamped percentage; no value is indeterminate", async ({
    page,
  }) => {
    const bar = page.getByRole("progressbar", { name: "Uploading photo" })
    await expect(bar).toHaveAttribute("aria-valuenow", "25")
    await expect(bar).toHaveAttribute("aria-valuemax", "100")
    for (const [text, now] of [
      ["1.5", "100"],
      ["−0.5", "0"],
      ["60 %", "60"],
    ]) {
      await clickValue(page, text)
      await expect(bar).toHaveAttribute("aria-valuenow", now)
    }
    for (const text of ["NaN", "No value"]) {
      await clickValue(page, "60 %")
      await expect(bar).toHaveAttribute("aria-valuenow", "60")
      await clickValue(page, text)
      await expect(bar).toHaveAttribute(
        "data-progress-bar-indeterminate",
        "",
      )
      await expect(bar).not.toHaveAttribute("aria-valuenow", /.*/)
    }
  })

  test("the fill eases by transform: its layout width never changes, and it grows from the left edge", async ({
    page,
  }) => {
    const bar = page.getByTestId("progress-determinate")
    await bar.scrollIntoViewIfNeeded()
    await clickValue(page, "0")
    //premise: at rest, nothing runs on the indicator
    await expect
      .poll(() =>
        page
          .locator(`[data-testid="progress-determinate"] ${INDICATOR}`)
          .evaluate((el) => el.getAnimations().length),
      )
      .toBe(0)

    const fill = await sampleFill(page, "100 %", 600)
    const distinct = [...new Set(fill.paintedWidths)]
    console.log(
      `[progress-fill ${test.info().project.name}] frames ${fill.paintedWidths.length} transitions ${JSON.stringify(fill.transitions)} layoutWidths ${JSON.stringify([...new Set(fill.layoutWidths)])} painted ${JSON.stringify(distinct)} left ${JSON.stringify([...new Set(fill.leftOffsets)])}`,
    )
    //premise: the click started a transition, and the frames saw it move
    expect(fill.transitions).toEqual(["CSSTransition:transform"])
    expect(distinct.length).toBeGreaterThanOrEqual(3)
    expect(fill.paintedWidths.at(-1)).toBeCloseTo(fill.trackWidth, 0)
    //the fill never lays out: its layout box is the full track on every frame…
    expect([...new Set(fill.layoutWidths)]).toEqual([
      Math.round(fill.trackWidth),
    ])
    //…and it grows monotonically, anchored to the left edge
    for (let i = 1; i < fill.paintedWidths.length; i++)
      expect(fill.paintedWidths[i]).toBeGreaterThanOrEqual(
        fill.paintedWidths[i - 1],
      )
    for (const left of fill.leftOffsets)
      expect(Math.abs(left)).toBeLessThan(1)
  })

  test("chromium: the fill transition and the sweep start on the compositor, and the fill lays out no frame", async ({
    page,
    browser,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "compositeFailed and Performance.getMetrics are Chromium's; WebKit's fill is asserted by layout width above",
    )
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")
    await page.getByTestId("progress-determinate").scrollIntoViewIfNeeded()
    await clickValue(page, "0")
    await expect
      .poll(() =>
        page
          .locator(`[data-testid="progress-determinate"] ${INDICATOR}`)
          .evaluate((el) => el.getAnimations().length),
      )
      .toBe(0)
    const layouts = async () => {
      const { metrics } = await cdp.send("Performance.getMetrics")
      return (
        metrics.find((m) => m.name === "LayoutCount")?.value ?? Number.NaN
      )
    }

    await browser.startTracing(page, {
      categories: ["devtools.timeline", "blink.animations"],
    })
    //the click commits a React render; the layout count starts one frame AFTER it,
    //so what is counted is the transition's own frames
    await clickValue(page, "100 %")
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve)),
    )
    const layoutBefore = await layouts()
    await page.waitForTimeout(400)
    const layoutAfter = await layouts()
    //and start the sweep inside the same trace
    await clickValue(page, "Start loading")
    await expect(page.getByTestId("progress-indeterminate")).toBeAttached()
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
    const begun = events.filter((e) => e.ph === "b")
    const verdictsFor = (ids: Set<string | undefined>) =>
      events
        .filter(
          (e) =>
            ids.has(e.id2?.local) &&
            typeof e.args?.data?.compositeFailed === "number",
        )
        .map((e) => e.args?.data?.compositeFailed)
    const ofName = (match: (name: string) => boolean) =>
      new Set(
        begun
          .filter((e) => match(e.args?.data?.displayName ?? ""))
          .map((e) => e.id2?.local),
      )
    const fillIds = ofName((name) => name === "transform")
    const sweepIds = ofName((name) =>
      name.startsWith("adaptv-progress-bar-sweep"),
    )
    const fill = verdictsFor(fillIds)
    const sweep = verdictsFor(sweepIds)
    console.log(
      `[progress-trace chromium] begun ${JSON.stringify(begun.map((e) => [e.args?.data?.displayName, e.args?.data?.nodeName]))} fill ${JSON.stringify(fill)} sweep ${JSON.stringify(sweep)} layouts during the fill ${layoutAfter - layoutBefore}`,
    )
    //premise: the trace saw both start, and judged them
    expect(fillIds.size).toBeGreaterThan(0)
    expect(sweepIds.size).toBeGreaterThan(0)
    expect(fill.length).toBeGreaterThan(0)
    expect(sweep.length).toBeGreaterThan(0)
    //0 = no failure reason: both run on the compositor
    expect(fill.every((v) => v === 0)).toBe(true)
    expect(sweep.every((v) => v === 0)).toBe(true)
    //a `width` fill lays out every frame of its 200 ms
    expect(layoutAfter - layoutBefore).toBe(0)
  })

  test("the sweep is a transform keyframe on the indicator — never the box", async ({
    page,
  }) => {
    //on screen, or the observer (rightly) pauses it
    await page
      .getByRole("button", { name: "Start loading" })
      .scrollIntoViewIfNeeded()
    await clickValue(page, "Start loading")
    const bar = page.getByTestId("progress-indeterminate")
    await expect
      .poll(() =>
        playStates(page, '[data-testid="progress-indeterminate"]'),
      )
      .toEqual({ running: 1, paused: 0, none: 0 })
    const shape = await bar.evaluate((el, meta) => {
      const indicator = el.querySelector('[data-part="indicator"]')
      const animation = el.getAnimations({ subtree: true })[0] as
        | CSSAnimation
        | undefined
      const effect = animation?.effect as KeyframeEffect | undefined
      return {
        boxAnimations: el.getAnimations().length,
        kind: animation?.constructor.name ?? null,
        name: animation?.animationName ?? null,
        onIndicator: effect?.target === indicator,
        properties: [
          ...new Set(
            (effect?.getKeyframes() ?? []).flatMap((frame) =>
              Object.keys(frame).filter((key) => !meta.includes(key)),
            ),
          ),
        ],
      }
    }, KEYFRAME_META)
    console.log(
      `[progress-sweep ${test.info().project.name}] ${JSON.stringify(shape)}`,
    )
    expect(shape).toEqual({
      boxAnimations: 0,
      kind: "CSSAnimation",
      name: "adaptv-progress-bar-sweep",
      onIndicator: true,
      properties: ["transform"],
    })
  })

  test("Q1: the off-screen field is paused, resumes when scrolled in, and pauses again", async ({
    page,
  }) => {
    const field = page.getByTestId("progress-field")
    const box = await field.boundingBox()
    const viewport = page.viewportSize()
    expect(box).not.toBeNull()
    expect(box?.y ?? 0).toBeGreaterThan(viewport?.height ?? 0)

    await expect
      .poll(() => playStates(page, FIELD))
      .toEqual({ running: 0, paused: 100, none: 0 })
    await expect(
      page.locator(`${FIELD}[data-progress-bar-offscreen]`),
    ).toHaveCount(100)

    await field.evaluate((el) => el.scrollIntoView({ block: "center" }))
    await expect
      .poll(() => playStates(page, FIELD))
      .toEqual({ running: 100, paused: 0, none: 0 })

    await page
      .getByRole("heading", { name: "ProgressBar", level: 1 })
      .scrollIntoViewIfNeeded()
    await expect
      .poll(() => playStates(page, FIELD))
      .toEqual({ running: 0, paused: 100, none: 0 })
  })

  test("RTL: the fill is anchored to the right edge, and the sweep travels leftwards", async ({
    page,
  }) => {
    await clickValue(page, "Show the RTL sweep")
    await clickValue(page, "Start loading")
    await expect(
      page.getByTestId("progress-rtl-indeterminate"),
    ).toBeAttached()
    await expect(page.getByTestId("progress-indeterminate")).toBeAttached()

    const edges = (testId: string) =>
      page.getByTestId(testId).evaluate((el) => {
        const box = el.getBoundingClientRect()
        const fill = (
          el.querySelector('[data-part="indicator"]') as HTMLElement
        ).getBoundingClientRect()
        return {
          dir: getComputedStyle(el).direction,
          share: +(fill.width / box.width).toFixed(3),
          left: +(fill.left - box.left).toFixed(1),
          right: +(box.right - fill.right).toFixed(1),
        }
      })
    const rtl = await edges("progress-rtl-determinate")

    /** Where the sweep's indicator sits at 25% and at 50% of one cycle. */
    const travel = (testId: string) =>
      page.getByTestId(testId).evaluate((el) => {
        const indicator = el.querySelector(
          '[data-part="indicator"]',
        ) as HTMLElement
        const animation = indicator.getAnimations()[0] as CSSAnimation
        const duration = Number(
          animation.effect?.getComputedTiming().duration,
        )
        animation.pause()
        const at = (fraction: number) => {
          animation.currentTime = duration * fraction
          return +indicator.getBoundingClientRect().left.toFixed(1)
        }
        const positions = [at(0.25), at(0.5), at(0.75)]
        animation.play()
        return { name: animation.animationName, positions }
      })
    const ltrSweep = await travel("progress-indeterminate")
    const rtlSweep = await travel("progress-rtl-indeterminate")
    console.log(
      `[progress-rtl ${test.info().project.name}] fill ${JSON.stringify(rtl)} ltr sweep ${JSON.stringify(ltrSweep)} rtl sweep ${JSON.stringify(rtlSweep)}`,
    )
    expect(rtl.dir).toBe("rtl")
    expect(rtl.share).toBeCloseTo(0.25, 2)
    expect(Math.abs(rtl.right)).toBeLessThan(1)
    expect(rtl.left).toBeGreaterThan(1)

    const [l1, l2, l3] = ltrSweep.positions
    expect(ltrSweep.name).toBe("adaptv-progress-bar-sweep")
    expect(l2).toBeGreaterThan(l1)
    expect(l3).toBeGreaterThan(l2)
    const [r1, r2, r3] = rtlSweep.positions
    expect(rtlSweep.name).toBe("adaptv-progress-bar-sweep-rtl")
    expect(r2).toBeLessThan(r1)
    expect(r3).toBeLessThan(r2)
  })

  test("chromium's own accessibility tree agrees", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "CDP Accessibility is Chromium-only; WebKit's tree is read on the simulator",
    )
    await clickValue(page, "Start loading")
    await expect(page.getByTestId("progress-indeterminate")).toBeAttached()
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
      const node = nodes[0]
      return {
        ignored: node?.ignored ?? null,
        role: node?.role?.value ?? null,
        name: node?.name?.value ?? null,
        value: node?.value?.value ?? null,
      }
    }
    const determinate = await axOf("progress-determinate")
    const indeterminate = await axOf("progress-indeterminate")
    const decorative = await axOf("progress-rtl-determinate")
    console.log(
      `[progress-ax chromium] ${JSON.stringify({ determinate, indeterminate, decorative })}`,
    )
    expect(determinate).toEqual({
      ignored: false,
      role: "progressbar",
      name: "Uploading photo",
      value: 25,
    })
    expect(indeterminate).toMatchObject({
      ignored: false,
      role: "progressbar",
      name: "Loading tasks",
    })
    expect(decorative.ignored).toBe(true)
  })

  test("forced colors: the fill keeps the forced text colour instead of being repainted away", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "Playwright's forcedColors emulation is Chromium-only",
    )
    const read = () =>
      page.getByTestId("progress-determinate").evaluate((el) => {
        const indicator = el.querySelector(
          '[data-part="indicator"]',
        ) as HTMLElement
        const probe = document.createElement("span")
        probe.style.color = "CanvasText"
        document.body.appendChild(probe)
        const canvasText = getComputedStyle(probe).color
        probe.style.color = "Canvas"
        const canvas = getComputedStyle(probe).color
        probe.remove()
        return {
          color: getComputedStyle(el).color,
          fill: getComputedStyle(indicator).backgroundColor,
          outline: getComputedStyle(el).outlineStyle,
          canvasText,
          canvas,
        }
      })
    const normal = await read()
    await page.emulateMedia({ forcedColors: "active" })
    const forced = await read()
    console.log(
      `[progress-forced chromium] ${JSON.stringify({ normal, forced })}`,
    )
    expect(normal.fill).toBe(normal.color)
    //premise: forcing colours changed this page's text colour at all
    expect(forced.canvasText).not.toBe(normal.color)
    expect(forced.canvas).not.toBe(forced.canvasText)
    //the fill is the forced text colour — a repainted background would read Canvas
    expect(forced.fill).toBe(forced.canvasText)
    expect(forced.outline).toBe("solid")
  })
})

/*
 * The idle measurement (memory prove-the-page-idles), Spinner's shape: three phases on
 * ONE page, each with its premise asserted and three 2-second windows, counting the
 * compositor frames Chromium begins (BeginFrame in a trace).
 *
 *   gated     — the field mounted and paused, nothing on screen running
 *   always-on — the SAME page with the pause overridden: the control
 *   no field  — the field unmounted
 *
 * The page is never scrolled and nothing is clicked through Playwright (which
 * scrolls); the unmount is a DOM click.
 */
test.describe("ProgressBar idle cost (chromium, CDP)", () => {
  let errors: string[] = []

  test.beforeEach(async ({ page, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "tracing and Performance.getMetrics are CDP; WebKit's pause is asserted by play state above",
    )
    errors = collectErrors(page)
    await openProgressBar(page)
  })

  test.afterEach(() => {
    expect(errors).toEqual([])
  })

  const WINDOW_MS = 2000
  const WINDOWS = 3

  async function layoutCount(cdp: CDPSession) {
    const { metrics } = await cdp.send("Performance.getMetrics")
    return (
      metrics.find((m) => m.name === "LayoutCount")?.value ?? Number.NaN
    )
  }

  async function measure(
    page: Page,
    browser: Browser,
    cdp: CDPSession,
    phase: string,
  ) {
    const frames: number[] = []
    const layout: number[] = []
    for (let i = 0; i < WINDOWS; i++) {
      await browser.startTracing(page, {
        categories: ["disabled-by-default-devtools.timeline.frame"],
      })
      const before = await layoutCount(cdp)
      await page.waitForTimeout(WINDOW_MS)
      const after = await layoutCount(cdp)
      const trace = JSON.parse(
        (await browser.stopTracing()).toString(),
      ) as { traceEvents: Array<{ name: string }> }
      frames.push(
        trace.traceEvents.filter((e) => e.name === "BeginFrame").length,
      )
      layout.push(after - before)
    }
    const sorted = [...frames].sort((a, b) => a - b)
    console.log(
      `[progress-idle chromium] ${phase}: frames ${JSON.stringify(frames)} layout ${JSON.stringify(layout)}`,
    )
    return {
      framesMin: sorted[0],
      framesMax: sorted[WINDOWS - 1],
      layout: [...layout].sort((a, b) => a - b)[1],
    }
  }

  /** Poll `read` until it equals `expected` or 10 s pass; return what it last read. */
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

  test("100 paused off-screen bars cost what no bars cost", async ({
    page,
    browser,
  }) => {
    test.setTimeout(90_000)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send("Performance.enable")

    const gatedField = await settle(() => playStates(page, FIELD), {
      running: 0,
      paused: 100,
      none: 0,
    })
    const gatedRunning = await settle(() => runningAnimations(page), 0)
    const gated = await measure(page, browser, cdp, "gated")

    const override = await page.addStyleTag({
      content:
        '[data-adaptv="progress-bar"][data-progress-bar-offscreen] > [data-part="indicator"] { animation-play-state: running !important; }',
    })
    const alwaysOnField = await settle(() => playStates(page, FIELD), {
      running: 100,
      paused: 0,
      none: 0,
    })
    const alwaysOn = await measure(page, browser, cdp, "always-on control")
    await override.evaluate((node) => node.remove())

    await clickValue(page, "Unmount the field")
    await expect(page.getByTestId("progress-field")).toHaveCount(0)
    const noFieldRunning = await settle(() => runningAnimations(page), 0)
    const noField = await measure(page, browser, cdp, "no field")
    console.log(
      `[progress-idle chromium] premises: gated field ${JSON.stringify(gatedField)} running ${gatedRunning} · always-on field ${JSON.stringify(alwaysOnField)} · no field running ${noFieldRunning}`,
    )

    expect(gatedField).toEqual({ running: 0, paused: 100, none: 0 })
    expect(gatedRunning).toBe(0)
    expect(alwaysOnField).toEqual({ running: 100, paused: 0, none: 0 })
    expect(noFieldRunning).toBe(0)
    //the control draws frames in every window, so the gated quiet is a comparison
    expect(alwaysOn.framesMin).toBeGreaterThanOrEqual(60)
    expect(gated.framesMax).toBeLessThanOrEqual(noField.framesMax + 5)
    expect(gated.framesMax * 10).toBeLessThan(alwaysOn.framesMin)
    expect(gated.layout).toBe(0)
  })
})

/*
 * Reduced motion, emulated BEFORE the navigation (a describe-level `reducedMotion`
 * did not reach the page on either engine — spinner.spec.ts says the same).
 */
test.describe("ProgressBar under prefers-reduced-motion", () => {
  let errors: string[] = []

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page)
    await page.emulateMedia({ reducedMotion: "reduce" })
    await openProgressBar(page)
  })

  test.afterEach(() => {
    expect(errors).toEqual([])
  })

  test("the sweep becomes a full-width pulse, values jump, and the field still pauses", async ({
    page,
  }) => {
    await page
      .getByRole("button", { name: "Start loading" })
      .scrollIntoViewIfNeeded()
    await clickValue(page, "Start loading")
    const bar = page.getByTestId("progress-indeterminate")
    await expect
      .poll(() =>
        playStates(page, '[data-testid="progress-indeterminate"]'),
      )
      .toEqual({ running: 1, paused: 0, none: 0 })
    const shape = await bar.evaluate((el, meta) => {
      const indicator = el.querySelector(
        '[data-part="indicator"]',
      ) as HTMLElement
      const animations = el.getAnimations({ subtree: true })
      const animation = animations[0] as CSSAnimation | undefined
      const effect = animation?.effect as KeyframeEffect | undefined
      el.style.opacity = "0.5"
      const boxOpacity = getComputedStyle(el).opacity
      el.style.opacity = ""
      return {
        reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
        count: animations.length,
        boxAnimations: el.getAnimations().length,
        onIndicator: effect?.target === indicator,
        boxOpacity,
        name: animation?.animationName ?? null,
        properties: [
          ...new Set(
            (effect?.getKeyframes() ?? []).flatMap((frame) =>
              Object.keys(frame).filter((key) => !meta.includes(key)),
            ),
          ),
        ],
        fullWidth:
          Math.abs(
            indicator.getBoundingClientRect().width -
              el.getBoundingClientRect().width,
          ) < 1,
      }
    }, KEYFRAME_META)
    console.log(
      `[progress-reduced ${test.info().project.name}] ${JSON.stringify(shape)}`,
    )
    expect(shape).toEqual({
      reduced: true,
      count: 1,
      boxAnimations: 0,
      onIndicator: true,
      boxOpacity: "0.5",
      name: "adaptv-spinner-pulse",
      properties: ["opacity"],
      fullWidth: true,
    })

    //a value change starts no transition: the fill is at its value on the next frame
    await page.getByTestId("progress-determinate").scrollIntoViewIfNeeded()
    const fill = await sampleFill(page, "100 %", 100)
    expect(fill.transitions).toEqual([])
    expect(fill.paintedWidths[0]).toBeCloseTo(fill.trackWidth, 0)

    await page
      .getByRole("heading", { name: "ProgressBar", level: 1 })
      .scrollIntoViewIfNeeded()
    await expect
      .poll(() => playStates(page, FIELD))
      .toEqual({ running: 0, paused: 100, none: 0 })
  })
})
