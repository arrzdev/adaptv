import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import type { ProbeSample } from "./support/stress-probes"
import {
  describeListenerDelta,
  fmtMB,
  installProbes,
  MB,
  rafOverQuiet,
  sampleProbes,
} from "./support/stress-probes"

/*
 * Swipeable rows under STRESS: the gestures a user produces by accident and the
 * engine must survive — a grab while the spring is still moving, a second
 * finger, a prop flip and a viewport swap mid-swipe, hundreds of cycles, and a
 * starved CPU. `swipeable.spec.ts` pins the promise; this pins its edges.
 *
 * Driver: CDP `Input.dispatchTouchEvent` (real touch — synthetic TouchEvents
 * never reach the browser's slop arbitration and never fire pointer events),
 * with `hasTouch` on the context and a PORTRAIT viewport (a landscape touch
 * context trips the rotate guard). Multi-touch passes two `touchPoints` with
 * ids; CDP emits one event per point that changed since the previous call, and a
 * `touchEnd` RELEASES the points it lists: `touchEnd([f2])` lifts finger 2 and
 * leaves finger 1 down (measured on a plain page; a `touchEnd([f1])` lifts
 * finger 1, and the next `touchMove([f1])` presses it again as a new touch).
 *
 * ⚠︎ chromium-only: CDP touch, `performance.memory`, `HeapProfiler`, CPU
 * throttling. That is the Android WebView engine; WebKit stays a sim walk.
 *
 * Doctrine: hydration gate in every test, no retries, no warm-ups (setup's
 * input probe is a premise check, not a warm-up: it fails loudly if touch is not
 * landing), and EVERY case asserts its premise (the spring really was moving,
 * the row really followed, at least one open really opened, the sample was taken
 * after a GC) so a harness that stops reproducing fails instead of passing
 * vacuously. Not `mode: "serial"`: serial skips every test after the first
 * failure, and several of these are expected to fail on purpose; `--workers=1`
 * already runs them one at a time.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

const ROOT = "[data-swipeable-root]"
const CONTENT = "[data-swipeable-content]"
const LOG = "[data-lab-log] li"
const TOLERANCE_PX = 8
/** The engine's own direction-lock slop (swipeable.tsx `dragMove`). */
const ENGINE_SLOP_PX = 8
/** Per-step drift tolerated once the row is following the finger. */
const STEP_SLACK_PX = 6

type TouchPoint = { x: number; y: number; id?: number }

async function touch(
  cdp: CDPSession,
  type: "touchStart" | "touchMove" | "touchEnd",
  points?: TouchPoint | TouchPoint[],
) {
  const touchPoints =
    points === undefined ? [] : Array.isArray(points) ? points : [points]
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints })
}

/** Content translateX in px, from the COMPUTED matrix — the engine clears the
 *  inline transform to "" on settle, so a closed row reads a clean 0 here. */
function contentX(page: Page, index: number) {
  return page.evaluate(
    ([sel, i]) => {
      const el = document.querySelectorAll(sel as string)[i as number]
      if (!el) return Number.NaN
      const t = getComputedStyle(el).transform
      if (t === "none") return 0
      return new DOMMatrixReadOnly(t).m41
    },
    [CONTENT, index] as const,
  )
}

/** The inline will-change the engine sets for a spring or a drag and clears
 *  when the spring lands. */
function willChange(page: Page, index: number) {
  return page.evaluate(
    ([sel, i]) =>
      document.querySelectorAll<HTMLElement>(sel as string)[i as number]
        ?.style.willChange ?? "?",
    [CONTENT, index] as const,
  )
}

/** Natural width of a row's right tray — the open rest position is minus this. */
function trayWidth(page: Page, index: number) {
  return page.evaluate(
    ([sel, i]) =>
      document
        .querySelectorAll(sel as string)
        [i as number]?.querySelector<HTMLElement>(
          '[data-swipeable-actions="right"]',
        )?.offsetWidth ?? 0,
    [ROOT, index] as const,
  )
}

const logTexts = (page: Page) => page.locator(LOG).allInnerTexts()
const logCount = async (page: Page, re: RegExp) =>
  (await logTexts(page)).filter((t) => re.test(t)).length

/** The content's translateX sampled once per rAF for `frames` frames. */
function sampleFrames(page: Page, index: number, frames: number) {
  return page.evaluate(
    ([sel, i, n]) =>
      new Promise<number[]>((resolve) => {
        const el = document.querySelectorAll(sel as string)[i as number]
        const read = () => {
          if (!el) return Number.NaN
          const t = getComputedStyle(el).transform
          return t === "none" ? 0 : new DOMMatrixReadOnly(t).m41
        }
        const out: number[] = []
        const tick = () => {
          out.push(read())
          if (out.length >= (n as number)) resolve(out)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    [CONTENT, index, frames] as const,
  )
}

type SamplerWindow = Window & { __stressSampler?: Promise<number[]> }

/**
 * Start sampling the content's translateX once per rAF, in the page, without
 * blocking the test: the sampler stops after `stable` consecutive identical
 * samples (only counted once a change has been seen when `requireChange`), or
 * at `maxMs`. `collectSampler` awaits it. Started BEFORE a release so the whole
 * spring is on the record, not the tail of it.
 */
async function startSampler(
  page: Page,
  index: number,
  {
    stable = 20,
    maxMs = 3000,
    requireChange = false,
  }: { stable?: number; maxMs?: number; requireChange?: boolean } = {},
) {
  await page.evaluate(
    ([sel, i, stableN, limitMs, needChange]) => {
      const el = document.querySelectorAll(sel as string)[i as number]
      const read = () => {
        if (!el) return Number.NaN
        const t = getComputedStyle(el).transform
        return t === "none" ? 0 : new DOMMatrixReadOnly(t).m41
      }
      ;(window as unknown as SamplerWindow).__stressSampler = new Promise(
        (resolve) => {
          const samples: number[] = [read()]
          let same = 0
          let changed = false
          const t0 = performance.now()
          const tick = () => {
            const v = read()
            const last = samples[samples.length - 1]
            samples.push(v)
            if (v === last) same += 1
            else {
              same = 0
              changed = true
            }
            const done =
              (changed || !needChange) && same >= (stableN as number)
            if (done || performance.now() - t0 > (limitMs as number)) {
              resolve(samples)
              return
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        },
      )
    },
    [CONTENT, index, stable, maxMs, requireChange] as const,
  )
}

function collectSampler(page: Page) {
  return page.evaluate(async () => {
    const w = window as unknown as SamplerWindow
    const out = await w.__stressSampler
    w.__stressSampler = undefined
    return out ?? []
  })
}

/** Sample until the content transform is stable for `stable` frames (or maxMs). */
async function settle(
  page: Page,
  index: number,
  opts: { stable?: number; maxMs?: number; requireChange?: boolean } = {},
) {
  await startSampler(page, index, opts)
  return collectSampler(page)
}

type EventLogWindow = Window & { __touchLog?: string[] }

/** Record every touch/pointer lifecycle event that reaches a row's content (and
 *  every pointerup the window sees) so a failure can name the event that ended
 *  a drag instead of guessing at it. `touches` is the count of fingers still
 *  down when the event fired; moves are not logged. */
async function watchEvents(page: Page, index: number) {
  await page.evaluate(
    ([sel, i]) => {
      const w = window as unknown as EventLogWindow
      w.__touchLog = []
      const node = document.querySelectorAll(sel as string)[i as number]
      if (!node) return
      for (const type of [
        "touchstart",
        "touchend",
        "touchcancel",
        "pointerdown",
        "pointerup",
        "pointercancel",
        "lostpointercapture",
      ]) {
        node.addEventListener(
          type,
          (e) => {
            const detail =
              "touches" in e
                ? `touches=${(e as TouchEvent).touches.length}`
                : `id=${(e as PointerEvent).pointerId}`
            w.__touchLog?.push(`${type}(${detail})`)
          },
          true,
        )
      }
      window.addEventListener(
        "pointerup",
        (e) => {
          const t = e.target as Element | null
          const inRow = !!t?.closest?.("[data-swipeable-root]")
          const where = inRow
            ? "in a row"
            : `outside on <${t?.tagName?.toLowerCase() ?? "?"}>`
          w.__touchLog?.push(
            `window:pointerup(id=${e.pointerId},${where})`,
          )
        },
        true,
      )
    },
    [CONTENT, index] as const,
  )
}

const eventLog = (page: Page) =>
  page.evaluate(
    () =>
      (window as unknown as EventLogWindow).__touchLog?.join(" ") ?? "",
  )

const lastN = (samples: number[], n: number) =>
  samples.slice(Math.max(0, samples.length - n))
const allEqual = (xs: number[]) => xs.every((x) => x === xs[0])
const distinct = (xs: number[]) => new Set(xs).size

/*
 * Aim at a row's content centre, re-measured every time. `boundingBox()` is
 * viewport-relative and this page scrolls inside a ScrollView whose layout shifts
 * as the log mounts, so a cached point drifts off the row and CDP input — which
 * has no actionability check — lands on empty space, failing exactly like a dead
 * engine. `elementFromPoint` is the only thing that can tell a stale measurement
 * from a real regression.
 */
async function aim(page: Page, index: number) {
  const content = page.locator(CONTENT).nth(index)
  await content.scrollIntoViewIfNeeded()

  let previous = -1
  let box = await content.boundingBox()
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (box && Math.round(box.y) === previous) break
    previous = box ? Math.round(box.y) : -1
    await page.waitForTimeout(50)
    box = await content.boundingBox()
  }
  if (!box) throw new Error(`row ${index} has no layout box`)

  const point = {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height / 2),
  }
  const onTarget = await page.evaluate(
    ([x, y, sel]) =>
      !!document
        .elementFromPoint(x as number, y as number)
        ?.closest(sel as string),
    [point.x, point.y, ROOT] as const,
  )
  if (!onTarget) {
    throw new Error(
      `touch point ${point.x},${point.y} misses row ${index} — stale measurement, not a broken row`,
    )
  }
  return { box, point }
}

/** A point on the page that is on NO row and NO control — where a stray second
 *  finger lands. Returns what is under it, for the failure message. */
async function neutralPoint(page: Page) {
  const candidates = [
    { x: 200, y: 700 },
    { x: 200, y: 760 },
    { x: 200, y: 640 },
    { x: 40, y: 130 },
    { x: 200, y: 60 },
  ]
  for (const p of candidates) {
    const under = await page.evaluate(
      ([x, y, sel]) => {
        const el = document.elementFromPoint(x as number, y as number)
        if (!el) return null
        if (el.closest(sel as string)) return null
        if (el.closest("button, a, input, [role=button]")) return null
        return `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ").slice(0, 2).join(".")}` : ""}`
      },
      [p.x, p.y, ROOT] as const,
    )
    if (under) return { ...p, under }
  }
  throw new Error("no neutral point found for the second finger")
}

/** Drive a horizontal drag from a row's centre by `dx` (negative = leftward =
 *  reveal RIGHT actions). `steps` sub-moves; `settleMs` before release lets the
 *  velocity window read ~0 so position, not a stray flick, decides the outcome. */
async function dragH(
  page: Page,
  cdp: CDPSession,
  index: number,
  dx: number,
  { holdMs = 140 }: { holdMs?: number } = {},
) {
  const { point } = await aim(page, index)
  await touch(cdp, "touchStart", point)
  const steps = 12
  for (let s = 1; s <= steps; s += 1) {
    await touch(cdp, "touchMove", {
      x: Math.round(point.x + (dx * s) / steps),
      y: point.y,
    })
  }
  //the hold is part of the gesture, not a wait: a finger still for longer
  //than the row's 60ms velocity window lifts with no flick, so the verdict
  //is the position's alone
  await page.waitForTimeout(holdMs)
  await touch(cdp, "touchEnd")
  await settle(page, index)
}

/** Release any open row the way a user does — a tap in neutral header space, which
 *  fires the component's outside-pointerup dismiss. */
async function closeAll(page: Page, cdp: CDPSession) {
  await touch(cdp, "touchStart", { x: 40, y: 130 })
  await touch(cdp, "touchEnd")
  await expect
    .poll(
      () =>
        page.$$eval(CONTENT, (els) =>
          els.every((el) => {
            const t = getComputedStyle(el).transform
            const x = t === "none" ? 0 : new DOMMatrixReadOnly(t).m41
            return Math.abs(x) < 0.5
          }),
        ),
      {
        message: "every row must be closed after the outside tap",
        timeout: 3000,
      },
    )
    .toBe(true)
}

test.describe("Swipeable rows under stress", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection, performance.memory and CPU throttling — Chromium only",
  )

  async function setup(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/swipeable")
    await awaitClientHandover(page)
    await page.locator(ROOT).first().waitFor()
    await page.locator(CONTENT).nth(3).waitFor()

    //a sub-threshold nudge that demonstrably moves the row: the premise that
    //touch is landing at all. Fails loudly instead of leaving a green suite
    //that measured nothing (same probe as swipeable.spec.ts)
    let live = false
    for (let attempt = 0; attempt < 6 && !live; attempt += 1) {
      const { point } = await aim(page, 0)
      await touch(cdp, "touchStart", point)
      for (let s = 1; s <= 6; s += 1) {
        await touch(cdp, "touchMove", { x: point.x - s * 3, y: point.y })
      }
      await page.waitForTimeout(120)
      live = Math.abs(await contentX(page, 0)) > 4
      await touch(cdp, "touchEnd")
      await page.waitForTimeout(300)
    }
    if (!live) {
      throw new Error(
        "no row responded to touch — input is not reaching the page",
      )
    }
    await closeAll(page, cdp)
    await expect.poll(() => contentX(page, 0), { timeout: 1500 }).toBe(0)
    return { cdp }
  }

  test("a row grabbed while its spring is still moving is picked up where it is, not thrown back to where the finger landed", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const tray = await trayWidth(page, 0)
    expect(tray, "the right tray must have a width").toBeGreaterThan(40)
    const { point } = await aim(page, 0)

    //flick: 12 moves to −60 with no pause and an immediate lift. −60 is past
    //the open line (0.3·tray) on position alone, so the release opens the row
    //whatever the velocity read, and the open spring starts toward −tray
    await touch(cdp, "touchStart", point)
    for (let s = 1; s <= 12; s += 1) {
      await touch(cdp, "touchMove", { x: point.x - s * 5, y: point.y })
    }
    await touch(cdp, "touchEnd")

    //no wait: grab the row while its spring is running, then creep the finger
    //the OTHER way one pixel a move, reading the transform between moves
    await touch(cdp, "touchStart", point)
    const atGrab = await contentX(page, 0)
    const trace: { step: number; x: number }[] = [{ step: 0, x: atGrab }]
    for (let s = 1; s <= 40; s += 1) {
      await touch(cdp, "touchMove", { x: point.x + s, y: point.y })
      trace.push({ step: s, x: await contentX(page, 0) })
    }
    const traceText = trace
      .map((t) => `${t.step}:${t.x.toFixed(1)}`)
      .join(" ")

    //the spring runs toward −tray (negative, critically damped, no overshoot);
    //the finger goes positive. The first positive step is the lock — the move
    //on which the row started following the finger
    const lockStep = trace.findIndex(
      (t, k) => k > 0 && t.x - trace[k - 1].x > 0.5,
    )
    expect(
      lockStep,
      `premise did not hold: the row never followed the finger (no positive step in 40 one-pixel moves) — trace ${traceText}`,
    ).toBeGreaterThan(0)
    expect(
      lockStep,
      `premise did not hold: the row followed before the engine's ${ENGINE_SLOP_PX}px slop — trace ${traceText}`,
    ).toBeGreaterThanOrEqual(ENGINE_SLOP_PX)

    const springTravel = trace[lockStep - 1].x - atGrab
    expect(
      Math.abs(springTravel),
      `premise did not hold: the spring was not moving under the finger — the transform moved ${springTravel.toFixed(1)}px between the grab (${atGrab.toFixed(1)}) and the lock at step ${lockStep} — trace ${traceText}`,
    ).toBeGreaterThan(2)

    //from the lock on, each move is 1px of finger: the row may drift by that
    //plus slack, never by tens of pixels
    const violations: string[] = []
    for (let k = lockStep; k < trace.length; k += 1) {
      const dx = trace[k].x - trace[k - 1].x
      if (Math.abs(dx) > 1 + STEP_SLACK_PX) {
        violations.push(
          `step ${trace[k].step}: ${trace[k - 1].x.toFixed(1)} → ${trace[k].x.toFixed(1)} (${dx > 0 ? "+" : ""}${dx.toFixed(1)}px for 1px of finger)`,
        )
      }
    }
    expect
      .soft(
        violations,
        `the row must be picked up where the spring left it, not rebased to the offset at touchstart — grab at ${atGrab.toFixed(1)}, spring at ${trace[lockStep - 1].x.toFixed(1)} on the lock (step ${lockStep}); jumps: ${violations.join("; ")} — trace ${traceText}`,
      )
      .toEqual([])

    //lift: the row must come to rest and release its layer
    await touch(cdp, "touchEnd")
    const samples = await settle(page, 0, { stable: 20, maxMs: 3000 })
    expect(
      allEqual(lastN(samples, 20)) && samples.length >= 20,
      `the row must settle after the lift — last samples ${lastN(samples, 24).join(",")}`,
    ).toBe(true)
    expect(
      await willChange(page, 0),
      "will-change must be cleared once the spring lands",
    ).toBe("")
    await expect
      .poll(() => logCount(page, /first opened \(right\)/), {
        message: "premise: the flick must have opened the row",
        timeout: 1500,
      })
      .toBeGreaterThanOrEqual(1)
  })

  test("a second finger landing and lifting during a swipe does not end the swipe", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const tray = await trayWidth(page, 0)
    const { point } = await aim(page, 0)
    const f1 = (dx: number) => ({ x: point.x + dx, y: point.y, id: 1 })
    await watchEvents(page, 0)

    await touch(cdp, "touchStart", f1(0))
    for (let s = 1; s <= 12; s += 1) {
      await touch(cdp, "touchMove", f1(-5 * s))
      await page.waitForTimeout(8)
    }
    //premise: the row follows finger 1 to −60. Polled, not read once: the
    //CDP call returns before the renderer has run the touchmove handler (a
    //move is dispatched with the next frame), so a single read after a fixed
    //wait can see the row still on an earlier move under load
    //measured flaky at 2000ms under ordinary host load twice in one session
    //(a busy shared machine, not a slow one): the renderer's touch-handler
    //backlog needs more than a fixed 2000ms to drain sometimes, and 12
    //dispatched moves are cheap to wait out fully rather than call flaky
    await expect
      .poll(async () => Math.abs((await contentX(page, 0)) - -60), {
        message: `premise: the row must follow finger 1 to −60 — sat at ${await contentX(page, 0)}`,
        timeout: 5000,
      })
      .toBeLessThanOrEqual(TOLERANCE_PX)
    //let the velocity window empty so position, not a flick, decides everything
    //that follows
    await page.waitForTimeout(100)
    const held = await contentX(page, 0)

    //finger 2 lands away from every row and every control, then lifts
    const f2 = await neutralPoint(page)
    await touch(cdp, "touchStart", [f1(-60), { x: f2.x, y: f2.y, id: 2 }])
    //finger 2 lifts: a touchEnd releases the points it lists
    await touch(cdp, "touchEnd", [{ x: f2.x, y: f2.y, id: 2 }])

    //finger 1 has not moved: a swipe still alive leaves the row exactly where
    //it is; a swipe the lift ended springs it to a verdict (open or shut)
    const still = await sampleFrames(page, 0, 15)
    const stillMin = Math.min(...still)
    const stillMax = Math.max(...still)
    const eventsAtLift = await eventLog(page)
    expect
      .soft(
        stillMax - stillMin <= 1 && Math.abs(stillMin - held) <= 2,
        `after finger 2 (id 2, at ${f2.x},${f2.y} on <${f2.under}>) lifted, finger 1 held still at −60 and the row must not move by itself — it went ${still.map((v) => v.toFixed(1)).join(",")} (was ${held.toFixed(1)}); events the row saw: ${eventsAtLift}`,
      )
      .toBe(true)

    //finger 1 retreats to −40, a frame a move: a row still following reads
    //−40; a row whose swipe ended reads its verdict (−tray open, or 0 shut) —
    //40px apart either way
    const follow: number[] = []
    for (let s = 1; s <= 8; s += 1) {
      await touch(cdp, "touchMove", f1(-60 + 2.5 * s))
      await page.waitForTimeout(16)
      follow.push(await contentX(page, 0))
    }
    const followed = follow[follow.length - 1]
    expect
      .soft(
        Math.abs(followed - -40),
        `finger 1 must still own the row after finger 2 lifted — expected ≈ −40, read ${followed.toFixed(1)} (per-move ${follow.map((v) => v.toFixed(1)).join(",")}); events the row saw: ${await eventLog(page)}`,
      )
      .toBeLessThanOrEqual(TOLERANCE_PX)

    //lift finger 1 once the velocity window has emptied: −40 is inside the
    //tray, past the open line from closed and short of the close line from
    //open, so on position the row rests open either way
    await page.waitForTimeout(100)
    await touch(cdp, "touchEnd")
    await expect
      .poll(
        async () =>
          `${await contentX(page, 0)}|${await willChange(page, 0)}`,
        {
          message: `the row must rest open at −${tray} with will-change cleared`,
          timeout: 2000,
        },
      )
      .toBe(`${-tray}|`)
  })

  test("enabled flipped off mid-swipe releases the arbiter and springs the row back; the next row still swipes", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    const { cdp } = await setup(page)
    const { point } = await aim(page, 0)

    await touch(cdp, "touchStart", point)
    for (let s = 1; s <= 12; s += 1) {
      await touch(cdp, "touchMove", {
        x: point.x - Math.round((50 * s) / 12),
        y: point.y,
      })
      await page.waitForTimeout(8)
    }
    //premise: the row follows the finger to −50. Polled, not read once: the
    //CDP call returns before the renderer has run the touchmove handler (a
    //move is dispatched with the next frame), so a single read after a
    //fixed wait can see the row still on an earlier move under load.
    //Measured flaky at 2000ms under ordinary host load in this same
    //session, same as the other two premises above and below: give it the
    //same 5000ms room rather than call it flaky
    await expect
      .poll(async () => Math.abs((await contentX(page, 0)) - -50), {
        message: `premise: the row must follow the finger to −50 — sat at ${await contentX(page, 0)}`,
        timeout: 5000,
      })
      .toBeLessThanOrEqual(TOLERANCE_PX)

    //flip the prop from script: a DOM click() dispatches only the click, so no
    //pointerup lands outside the row (that would be the dismiss path, not the
    //prop path)
    await page
      .getByRole("button", { name: /^enabled: true/i })
      .evaluate((b) => (b as HTMLButtonElement).click())
    await expect(
      page.getByRole("button", { name: /^enabled: false/i }),
    ).toBeVisible()

    const during: number[] = []
    for (let s = 1; s <= 5; s += 1) {
      await touch(cdp, "touchMove", {
        x: point.x - 50 - s * 2,
        y: point.y,
      })
      await page.waitForTimeout(8)
      during.push(await contentX(page, 0))
    }
    await touch(cdp, "touchEnd")

    const settled = await settle(page, 0, { stable: 20, maxMs: 3000 })
    const rest = settled[settled.length - 1]
    expect
      .soft(
        Math.abs(rest),
        `a row disabled mid-swipe must spring back to 0 — it rests at ${rest.toFixed(1)} (moves after the flip read ${during.map((v) => v.toFixed(1)).join(",")}; settle tail ${lastN(settled, 6).join(",")})`,
      )
      .toBeLessThanOrEqual(1)

    //re-enable and swipe the second row: opens only if the arbiter let go
    await page
      .getByRole("button", { name: /^enabled: false/i })
      .evaluate((b) => (b as HTMLButtonElement).click())
    await expect(
      page.getByRole("button", { name: /^enabled: true/i }),
    ).toBeVisible()
    await dragH(page, cdp, 1, -50)
    await expect
      .poll(() => contentX(page, 1), {
        message:
          "the second row must open after re-enabling (arbiter released)",
        timeout: 2000,
      })
      .toBeLessThan(-60)
    expect(errors, "no uncaught page error during the flip").toEqual([])
    await closeAll(page, cdp)
  })

  test("a viewport swap mid-swipe leaves the row settled, not stranded", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (e) => errors.push(String(e)))
    const { cdp } = await setup(page)
    const tray = await trayWidth(page, 0)
    const { point } = await aim(page, 0)

    await touch(cdp, "touchStart", point)
    for (let s = 1; s <= 12; s += 1) {
      await touch(cdp, "touchMove", {
        x: point.x - Math.round((50 * s) / 12),
        y: point.y,
      })
      await page.waitForTimeout(8)
    }
    //premise: the row follows the finger to −50. Polled, not read once: the
    //CDP call returns before the renderer has run the touchmove handler (a
    //move is dispatched with the next frame), so a single read after a
    //fixed wait can see the row still on an earlier move under load
    //measured flaky at 2000ms under ordinary host load in this same session:
    //the renderer's touch-handler backlog needs more than a fixed 2000ms to
    //drain sometimes, and waiting it out fully beats a flaky premise
    await expect
      .poll(async () => Math.abs((await contentX(page, 0)) - -50), {
        message: `premise: the row must follow the finger to −50 — sat at ${await contentX(page, 0)}`,
        timeout: 5000,
      })
      .toBeLessThanOrEqual(TOLERANCE_PX)

    await page.setViewportSize({ width: 844, height: 390 })
    const during: number[] = []
    for (let s = 1; s <= 5; s += 1) {
      await touch(cdp, "touchMove", {
        x: point.x - 50 - s * 2,
        y: point.y,
      })
      await page.waitForTimeout(8)
      during.push(await contentX(page, 0))
    }
    await touch(cdp, "touchEnd")
    await page.setViewportSize({ width: 390, height: 844 })

    const samples = await settle(page, 0, { stable: 20, maxMs: 3000 })
    const rest = samples[samples.length - 1]
    expect(
      allEqual(lastN(samples, 20)) && samples.length >= 20,
      `the row must come to rest after the swap — tail ${lastN(samples, 24).join(",")}`,
    ).toBe(true)
    expect(
      Math.abs(rest) <= 1 || Math.abs(rest + tray) <= 1,
      `the row must rest at 0 or at −${tray}, never between — rests at ${rest.toFixed(1)} (moves during landscape read ${during.map((v) => v.toFixed(1)).join(",")})`,
    ).toBe(true)
    expect(errors, "no uncaught page error across the swap").toEqual([])
    await closeAll(page, cdp)
  })

  test("300 open/close cycles: listeners on window/document and the JS heap plateau, and the page idles", async ({
    page,
  }) => {
    test.setTimeout(420_000)
    await page.addInitScript(installProbes)
    const { cdp } = await setup(page)
    await cdp.send("HeapProfiler.enable")

    //150 pairs = 300 gestures; sampled after 100, 200 and 300 gestures
    const PAIRS = 150
    const SAMPLE_AT = [50, 100, 150]
    const before = await sampleProbes(page, cdp)
    const samples: ({ at: number } & ProbeSample)[] = []

    //what the row saw, so a cycle that fails to open says why: the per-move
    //transform, the touch/pointer transitions on the content, and the page
    //scroller's position (a scroll closes rows and cancels touches)
    await watchEvents(page, 0)
    const pageScroll = () =>
      page.evaluate(() => {
        const el = document.querySelector("[data-scroll-view='y']")
        return el ? el.scrollTop : window.scrollY
      })
    let lastLiftAt = Date.now()

    //one lean cycle: open on position (a short settle so no flick decides),
    //poll it open, tap outside, poll it shut
    for (let i = 1; i <= PAIRS; i += 1) {
      const { point } = await aim(page, 0)
      const sinceTap = Date.now() - lastLiftAt
      const scrollBefore = await pageScroll()
      await page.evaluate(() => {
        ;(window as unknown as EventLogWindow).__touchLog = []
      })
      await touch(cdp, "touchStart", point)
      const moves: number[] = []
      for (let s = 1; s <= 12; s += 1) {
        await touch(cdp, "touchMove", { x: point.x - s * 5, y: point.y })
        moves.push(await contentX(page, 0))
      }
      await page.waitForTimeout(60)
      await touch(cdp, "touchEnd")
      const diagnose = async () =>
        `per-move transform ${moves.map((v) => v.toFixed(1)).join(",")}; events on the content: ${await eventLog(page)}; will-change "${await willChange(page, 0)}"; page scrollTop ${scrollBefore} → ${await pageScroll()}; ${sinceTap}ms after the previous tap`
      await expect
        .poll(() => contentX(page, 0), {
          message: `cycle ${i}: the row must open — ${await diagnose()}`,
          timeout: 2000,
        })
        .toBeLessThan(-60)
      await touch(cdp, "touchStart", { x: 40, y: 130 })
      await touch(cdp, "touchEnd")
      lastLiftAt = Date.now()
      await expect
        .poll(() => contentX(page, 0), {
          message: `cycle ${i}: the tap outside must close the row`,
          timeout: 2000,
        })
        .toBe(0)
      if (SAMPLE_AT.includes(i)) {
        const s = await sampleProbes(page, cdp)
        samples.push({ at: i * 2, ...s })
      }
    }

    //premise: the cycles really opened the row
    expect(
      await logCount(page, /first opened/),
      "premise: at least one open must be reported in the log",
    ).toBeGreaterThan(0)

    const report = [
      `before: heap ${fmtMB(before.heap)} listeners w${before.listeners.window}/d${before.listeners.document} nodes ${before.nodes}`,
      ...samples.map(
        (s) =>
          `after ${s.at}: heap ${fmtMB(s.heap)} listeners w${s.listeners.window}/d${s.listeners.document} nodes ${s.nodes}`,
      ),
      `listeners since load: ${describeListenerDelta(before, samples[0])}`,
    ].join(" | ")
    console.log(`[stress-swipeable cycles] ${report}`)

    //a listener the first gesture installs and then keeps is not a leak; a
    //count that keeps climbing is. So the samples must agree with each other
    //from the first one on, and a drift names the listener type it is
    for (const s of samples.slice(1)) {
      expect
        .soft(
          s.listeners,
          `listeners on window/document must plateau from the first sample on — after ${s.at}: ${describeListenerDelta(samples[0], s)} — ${report}`,
        )
        .toEqual(samples[0].listeners)
    }
    const g12 = samples[1].heap - samples[0].heap
    const g23 = samples[2].heap - samples[1].heap
    expect
      .soft(
        g23,
        `heap must plateau: growth 200→300 (${fmtMB(g23)}) must be ≤ growth 100→200 (${fmtMB(g12)}) + 1MB — ${report}`,
      )
      .toBeLessThanOrEqual(g12 + MB)
    //the lab log is capped at 40 entries and full after 20 cycles, so from the
    //first sample on the DOM must not grow
    expect
      .soft(
        Math.abs(samples[2].nodes - samples[0].nodes),
        `DOM node count must be flat once the log is saturated — ${report}`,
      )
      .toBeLessThanOrEqual(5)

    //idle: once the last close spring lands, no frame may be scheduled
    const tail = await settle(page, 0, { stable: 20, maxMs: 3000 })
    expect(allEqual(lastN(tail, 20)), "the last close must settle").toBe(
      true,
    )
    const quiet = await rafOverQuiet(page, 1000)
    expect(
      quiet.requested,
      `the spring loop must self-stop: ${quiet.requested} rAF requested in 1s of idle after 300 gestures — callers: ${JSON.stringify(quiet.callers)}`,
    ).toBe(0)
  })

  test("at 4x CPU throttle the spring still lands and stops", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const tray = await trayWidth(page, 0)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    try {
      const { point } = await aim(page, 0)
      await touch(cdp, "touchStart", point)
      for (let s = 1; s <= 12; s += 1) {
        await touch(cdp, "touchMove", { x: point.x - s * 5, y: point.y })
        await page.waitForTimeout(8)
      }
      await page.waitForTimeout(140)
      const held = await contentX(page, 0)
      expect(
        Math.abs(held - -60),
        `premise: the row must follow the finger to −60 under throttle — sat at ${held}`,
      ).toBeLessThanOrEqual(TOLERANCE_PX)

      //sampler first, release second: the whole spring is on the record
      await startSampler(page, 0, {
        stable: 20,
        maxMs: 3000,
        requireChange: true,
      })
      await touch(cdp, "touchEnd")
      const samples = await collectSampler(page)
      const text = samples.map((v) => v.toFixed(1)).join(",")
      expect(
        distinct(samples),
        `premise: the spring must animate (≥3 distinct transforms) — samples ${text}`,
      ).toBeGreaterThanOrEqual(3)
      expect(
        allEqual(lastN(samples, 20)) && samples.length >= 21,
        `the spring must settle (20 identical samples) within 3s at 4x throttle — samples ${text}`,
      ).toBe(true)
      const last = samples[samples.length - 1]
      expect(
        Math.abs(last + tray),
        `the spring must land at −${tray} — landed at ${last}`,
      ).toBeLessThanOrEqual(1)
      expect(
        await willChange(page, 0),
        "will-change must be cleared once the spring lands",
      ).toBe("")
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
    }
    await closeAll(page, cdp)
  })
})
