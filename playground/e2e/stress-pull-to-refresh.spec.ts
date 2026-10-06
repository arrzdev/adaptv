import type { CDPSession, Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import type { ProbeSample } from "./support/stress-probes"
import {
  awaitStable,
  describeListenerDelta,
  fmtMB,
  installProbes,
  MB,
  rafOverQuiet,
  sampleProbes,
} from "./support/stress-probes"

/*
 * PullToRefresh under STRESS: the exact threshold, a pull while a refresh is in
 * flight, a second finger, a burst of short pulls, a starved CPU, a hundred
 * cycles, and a pull that starts on a swipeable row (the lab's second box, the
 * mail-list shape the component exists for). `pull-to-refresh.spec.ts` pins the
 * promise; this pins its edges.
 *
 * Driver: CDP `Input.dispatchTouchEvent` (the component reads its finger out of
 * `touches`/`changedTouches`, which a synthetic TouchEvent leaves empty), with
 * `hasTouch` on the context and
 * a PORTRAIT viewport. The lift is React state that renders a frame later, so it
 * is read BETWEEN moves, and where an exact value matters a two-frame wait
 * precedes the read. Every test is on a FRESH page and its measured pull is the
 * first CDP gesture of that page — never a warm-up, never a retry into a reload.
 * Multi-touch: two `touchPoints` with ids; a `touchEnd` RELEASES the points it
 * lists (measured on a plain page: `touchEnd([f2])` fires `touchend` with
 * changedTouches=[2] and touches=[1]; `touchEnd([f1])` lifts finger 1, and the
 * next `touchMove([f1])` presses it again as a new touch).
 *
 * ⚠︎ chromium-only: CDP touch, `performance.memory`, `HeapProfiler`, CPU
 * throttling. Chromium here is the Android WebView engine; iOS WebKit, where the
 * pull must not fight the rubber band, stays a manual sim walk.
 *
 * Doctrine: hydration gate in every test, no retries, no warm-ups, and EVERY
 * case asserts its premise (the lift read exactly 80, the refresh really started
 * and docked, finger 2 landed on the scroller the engine listens on, at least
 * one short pull lifted, the heap sample followed a GC). Not `mode: "serial"`:
 * serial skips every test after the first failure and some of these are
 * expected to fail on purpose; `--workers=1` already serialises them.
 */

test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

// the inner box is the LAST scroller on the page (the page root is first)
const SCROLLER = '[data-scroll-view="y"]'
const PTR_ROOT = '[data-adaptv="pull-to-refresh"]'
const LOG = "[data-lab-log] li"
/** pull-to-refresh-physics.ts */
const PULL_THRESHOLD = 80
const STUCK_HEIGHT = 68

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

const logTexts = (page: Page) => page.locator(LOG).allInnerTexts()
const logCount = async (page: Page, re: RegExp) =>
  (await logTexts(page)).filter((t) => re.test(t)).length
const startedCount = (page: Page) => logCount(page, /onRefresh started/)
const resolvedCount = (page: Page) => logCount(page, /onRefresh resolved/)

/** translateY the inner box's content wrapper carries while pulling. */
const contentLift = (page: Page) =>
  page.evaluate(() => {
    const all = document.querySelectorAll('[data-scroll-view="y"]')
    const wrap = all[all.length - 1]?.parentElement
    if (!wrap) return 0
    const t = getComputedStyle(wrap).transform
    return t === "none" ? 0 : new DOMMatrixReadOnly(t).m42
  })

/** The wrapper's INLINE transform, "" or "none" once the hook has let go. */
const contentInlineTransform = (page: Page) =>
  page.evaluate(() => {
    const all = document.querySelectorAll('[data-scroll-view="y"]')
    const wrap = all[all.length - 1]?.parentElement as HTMLElement | null
    return wrap?.style.transform ?? "?"
  })

/** The lab's rows box: a PullToRefresh over swipeable rows. */
const ROWS_SCROLLER = "[data-lab-rows-scroller]"

/** translateY the rows box's content wrapper carries while pulling. */
const rowsLift = (page: Page) =>
  page.evaluate(() => {
    const wrap = document.querySelector(
      "[data-lab-rows-scroller]",
    )?.parentElement
    if (!wrap) return 0
    const t = getComputedStyle(wrap).transform
    return t === "none" ? 0 : new DOMMatrixReadOnly(t).m42
  })

/** translateX of the first message row's content. */
const rowContentX = (page: Page) =>
  page.evaluate(() => {
    const el = document.querySelector(
      "[data-lab-rows-scroller] [data-swipeable-content]",
    )
    if (!el) return 0
    const t = getComputedStyle(el).transform
    return t === "none" ? 0 : new DOMMatrixReadOnly(t).m41
  })

/** Two frames: one for React to commit the pull, one for the hook's write. */
const nextFrame = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  )

/** The lift sampled once per rAF for `frames` frames. */
function sampleFrames(page: Page, frames: number) {
  return page.evaluate(
    (n) =>
      new Promise<number[]>((resolve) => {
        const read = () => {
          const all = document.querySelectorAll('[data-scroll-view="y"]')
          const wrap = all[all.length - 1]?.parentElement
          if (!wrap) return Number.NaN
          const t = getComputedStyle(wrap).transform
          return t === "none" ? 0 : new DOMMatrixReadOnly(t).m42
        }
        const out: number[] = []
        const tick = () => {
          out.push(read())
          if (out.length >= n) resolve(out)
          else requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
    frames,
  )
}

type SamplerWindow = Window & { __stressSampler?: Promise<number[]> }

/** Start a per-rAF sampler of the lift in the page (non-blocking); it stops after
 *  `stable` identical samples — once a change was seen, when `requireChange` —
 *  or at `maxMs`. Started BEFORE a release so the whole close is on record. */
async function startSampler(
  page: Page,
  {
    stable = 20,
    maxMs = 3000,
    requireChange = false,
  }: { stable?: number; maxMs?: number; requireChange?: boolean } = {},
) {
  await page.evaluate(
    ([stableN, limitMs, needChange]) => {
      const read = () => {
        const all = document.querySelectorAll('[data-scroll-view="y"]')
        const wrap = all[all.length - 1]?.parentElement
        if (!wrap) return Number.NaN
        const t = getComputedStyle(wrap).transform
        return t === "none" ? 0 : new DOMMatrixReadOnly(t).m42
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
    [stable, maxMs, requireChange] as const,
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

type EventLogWindow = Window & { __touchLog?: string[] }

/** Record the touch/pointer transitions the scroller (the element the engine
 *  listens on) and the gesture root see, so a failure names the event that
 *  ended a pull. `touches` is the count of fingers still down. */
async function watchEvents(page: Page) {
  await page.evaluate(
    ([scrollerSel, rootSel]) => {
      const w = window as unknown as EventLogWindow
      w.__touchLog = []
      const all = document.querySelectorAll(scrollerSel as string)
      const scroller = all[all.length - 1]
      const root = document.querySelector(rootSel as string)
      const watch = (node: Element | null | undefined, label: string) => {
        if (!node) return
        for (const type of [
          "touchstart",
          "touchend",
          "touchcancel",
          "pointerdown",
          "pointerup",
          "pointercancel",
          "pointerleave",
        ]) {
          node.addEventListener(
            type,
            (e) => {
              const detail =
                "touches" in e
                  ? `touches=${(e as TouchEvent).touches.length}`
                  : `id=${(e as PointerEvent).pointerId}`
              w.__touchLog?.push(`${label}:${type}(${detail})`)
            },
            true,
          )
        }
      }
      watch(scroller, "scroller")
      watch(root, "root")
    },
    [SCROLLER, PTR_ROOT] as const,
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

async function boxCentre(page: Page) {
  const box = await page.locator(SCROLLER).last().boundingBox()
  if (!box) throw new Error("the inner box has no layout box")
  return {
    x: Math.round(box.x + box.width / 2),
    y: Math.round(box.y + box.height * 0.25), // room to drag DOWN
  }
}

/** Drag the box by (dx, dy), reading the lift between moves so React renders and
 *  the pull accumulates. Returns the max lift seen. Leaves the finger down unless
 *  `release`. */
async function drag(
  page: Page,
  cdp: CDPSession,
  from: { x: number; y: number },
  dy: number,
  {
    dx = 0,
    steps = 16,
    release = true,
  }: { dx?: number; steps?: number; release?: boolean } = {},
) {
  await touch(cdp, "touchStart", from)
  let max = 0
  for (let s = 1; s <= steps; s += 1) {
    await touch(cdp, "touchMove", {
      x: Math.round(from.x + (dx * s) / steps),
      y: Math.round(from.y + (dy * s) / steps),
    })
    const l = await contentLift(page)
    if (l > max) max = l
  }
  if (release) await touch(cdp, "touchEnd")
  return max
}

/** Flip a lab toggle from script — a DOM click() dispatches only the click, so
 *  no pointer lands on the page before the measured (first) gesture. */
async function toggle(page: Page, from: RegExp, to: RegExp) {
  await page
    .getByRole("button", { name: from })
    .evaluate((b) => (b as HTMLButtonElement).click())
  await expect(page.getByRole("button", { name: to })).toBeVisible()
}

test.describe("PullToRefresh under stress", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "needs CDP touch injection, performance.memory and CPU throttling — Chromium only",
  )

  async function setup(page: Page) {
    const cdp = await page.context().newCDPSession(page)
    await page.goto("/lab/pull-to-refresh")
    await awaitClientHandover(page)
    await page.locator(SCROLLER).last().waitFor()
    await page.locator(SCROLLER).last().scrollIntoViewIfNeeded()
    await awaitStable(
      () =>
        page
          .locator(SCROLLER)
          .last()
          .evaluate((el) => el.getBoundingClientRect().top),
      {
        message: "the scroller never held still after scrolling into view",
      },
    )
    //NO warm-up: the measured pull is the first CDP gesture on this page
    return { cdp }
  }

  test("a release at exactly the threshold refreshes", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const from = await boxCentre(page)
    await touch(cdp, "touchStart", from)
    const trace: number[] = []
    let lift = 0
    let dy = 0
    //one pixel a move, two frames, one read: the lift must LAND on 80
    for (dy = 1; dy <= PULL_THRESHOLD + 20; dy += 1) {
      await touch(cdp, "touchMove", { x: from.x, y: from.y + dy })
      await nextFrame(page)
      lift = await contentLift(page)
      trace.push(lift)
      if (Math.abs(lift - PULL_THRESHOLD) <= 0.5) break
      if (lift > PULL_THRESHOLD + 0.5) break
    }
    expect(
      Math.abs(lift - PULL_THRESHOLD),
      `premise: the lift must read exactly ${PULL_THRESHOLD} right before the release — it read ${lift} at finger +${dy}px (trace ${trace.join(",")})`,
    ).toBeLessThanOrEqual(0.5)

    await touch(cdp, "touchEnd")
    await expect
      .poll(() => startedCount(page), {
        message:
          "a release at exactly the threshold must start one refresh",
        timeout: 4000,
      })
      .toBe(1)
    await expect
      .poll(() => resolvedCount(page), {
        message: "the refresh must resolve",
        timeout: 4000,
      })
      .toBe(1)
    expect(await startedCount(page), "exactly one refresh").toBe(1)
  })

  test("a pull while a refresh is in flight neither double-fires nor moves the docked content", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    await toggle(page, /^slow refresh: false/i, /^slow refresh: true/i)

    const from = await boxCentre(page)
    const max1 = await drag(page, cdp, from, 150)
    expect(
      max1,
      `premise: the first pull must lift past ${PULL_THRESHOLD} — max ${max1}`,
    ).toBeGreaterThan(PULL_THRESHOLD)
    await expect
      .poll(() => startedCount(page), {
        message: "premise: the first pull must start the (slow) refresh",
        timeout: 3000,
      })
      .toBe(1)
    await expect
      .poll(
        async () => Math.abs((await contentLift(page)) - STUCK_HEIGHT),
        {
          message: `premise: the content must dock at ${STUCK_HEIGHT} while refreshing`,
          timeout: 2000,
        },
      )
      .toBeLessThanOrEqual(2)

    //second pull, 120px, reading the lift between moves — from the box where
    //it now sits (the dock translated it)
    const from2 = await boxCentre(page)
    const lifts: number[] = []
    await touch(cdp, "touchStart", from2)
    for (let s = 1; s <= 16; s += 1) {
      await touch(cdp, "touchMove", {
        x: from2.x,
        y: Math.round(from2.y + (120 * s) / 16),
      })
      lifts.push(await contentLift(page))
    }
    await touch(cdp, "touchEnd")
    const maxLift = Math.max(...lifts)
    const minLift = Math.min(...lifts)
    expect
      .soft(
        Math.abs(maxLift - STUCK_HEIGHT),
        `the docked content must not follow a second finger — lift ranged ${minLift.toFixed(1)}…${maxLift.toFixed(1)} during the pull (per-move ${lifts.map((v) => v.toFixed(1)).join(",")})`,
      )
      .toBeLessThanOrEqual(3)
    expect
      .soft(
        Math.abs(minLift - STUCK_HEIGHT),
        `the docked content must not drop under a second finger either — min lift ${minLift.toFixed(1)}`,
      )
      .toBeLessThanOrEqual(3)
    expect(
      await startedCount(page),
      "a pull during a refresh must not start a second one",
    ).toBe(1)

    //the 3s work resolves, the dock closes, nothing else fired
    await expect
      .poll(() => contentLift(page), {
        message: "after the work resolves the content must return to 0",
        timeout: 6000,
      })
      .toBeLessThanOrEqual(1)
    await expect.poll(() => resolvedCount(page), { timeout: 2000 }).toBe(1)
    expect(await startedCount(page), "still exactly one refresh").toBe(1)
  })

  test("a second finger tapping during a pull does not end the pull", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const box = await page.locator(SCROLLER).last().boundingBox()
    if (!box) throw new Error("the inner box has no layout box")
    const from = await boxCentre(page)
    const f1 = (dy: number) => ({ x: from.x, y: from.y + dy, id: 1 })
    //finger 2 lands INSIDE the scroller the engine listens on (a thumb resting
    //on the same list), well away from finger 1
    const f2 = {
      x: Math.round(box.x + box.width * 0.75),
      y: Math.round(box.y + box.height * 0.8),
      id: 2,
    }
    const f2Under = await page.evaluate(
      ([x, y, sel]) => {
        const el = document.elementFromPoint(x as number, y as number)
        return {
          tag: el ? el.tagName.toLowerCase() : "none",
          inScroller: !!el?.closest(sel as string),
        }
      },
      [f2.x, f2.y, SCROLLER] as const,
    )
    expect(
      f2Under.inScroller,
      `premise: finger 2 (${f2.x},${f2.y}) must land inside the scroller — it is on <${f2Under.tag}>`,
    ).toBe(true)

    await watchEvents(page)
    await touch(cdp, "touchStart", f1(0))
    const lifts: number[] = []
    for (let s = 1; s <= 12; s += 1) {
      await touch(cdp, "touchMove", f1(5 * s))
      lifts.push(await contentLift(page))
    }
    await nextFrame(page)
    const held = await contentLift(page)
    expect(
      Math.abs(held - 60),
      `premise: finger 1 must pull the content to ≈60 — read ${held} (per-move ${lifts.map((v) => v.toFixed(1)).join(",")})`,
    ).toBeLessThanOrEqual(10)

    await touch(cdp, "touchStart", [f1(60), f2])
    //finger 2 lifts: a touchEnd releases the points it lists
    await touch(cdp, "touchEnd", [f2])

    //finger 1 has not moved: a pull still alive holds the content where it is;
    //a pull the lift ended lets it spring away
    const still = await sampleFrames(page, 15)
    const stillMin = Math.min(...still)
    const stillMax = Math.max(...still)
    expect
      .soft(
        stillMax - stillMin <= 1 && Math.abs(stillMin - held) <= 2,
        `after finger 2 lifted, finger 1 held still at +60 and the content must not move by itself — it went ${still.map((v) => v.toFixed(1)).join(",")} (was ${held.toFixed(1)}); events seen: ${await eventLog(page)}`,
      )
      .toBe(true)

    //finger 1 continues to +130 — well past the threshold
    const more: number[] = []
    for (let s = 1; s <= 8; s += 1) {
      await touch(cdp, "touchMove", f1(60 + Math.round((70 * s) / 8)))
      await nextFrame(page)
      more.push(await contentLift(page))
    }
    const final = more[more.length - 1]
    expect
      .soft(
        final,
        `finger 1 must still own the pull after finger 2 lifted — at +130 the lift must be past ${PULL_THRESHOLD}, read ${final.toFixed(1)} (per-move ${more.map((v) => v.toFixed(1)).join(",")})`,
      )
      .toBeGreaterThan(PULL_THRESHOLD)

    await touch(cdp, "touchEnd")
    await expect
      .poll(() => startedCount(page), {
        message:
          "the release of finger 1 past the threshold must start exactly one refresh",
        timeout: 4000,
      })
      .toBe(1)
  })

  test("ten short pulls in quick succession never refresh and always return to rest", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    const maxes: number[] = []
    for (let i = 0; i < 10; i += 1) {
      const from = await boxCentre(page)
      maxes.push(await drag(page, cdp, from, 40, { steps: 6 }))
    }
    expect(
      Math.max(...maxes),
      `premise: at least one of the ten pulls must lift past 10 — per-pull max ${maxes.map((v) => v.toFixed(1)).join(",")}`,
    ).toBeGreaterThan(10)

    await page.waitForTimeout(500)
    expect(
      await startedCount(page),
      `ten sub-threshold pulls must never refresh (per-pull max ${maxes.map((v) => v.toFixed(1)).join(",")})`,
    ).toBe(0)
    await expect
      .poll(() => contentLift(page), {
        message: "the content must return to rest",
        timeout: 2000,
      })
      .toBeLessThanOrEqual(1)
    await expect
      .poll(
        () => page.locator(`${PTR_ROOT} > [data-part="indicator"]`).count(),
        {
          message: "the spinner track must unmount once idle",
          timeout: 2000,
        },
      )
      .toBe(0)
    expect(
      await page.locator(`${PTR_ROOT} [data-spinning]`).count(),
      "nothing may be spinning",
    ).toBe(0)
    const inline = await contentInlineTransform(page)
    expect(
      inline === "" || inline === "none",
      `the content wrapper must carry no transform at rest — reads "${inline}"`,
    ).toBe(true)
  })

  test("at 4x CPU throttle the release spring settles", async ({
    page,
  }) => {
    const { cdp } = await setup(page)
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 })
    try {
      const from = await boxCentre(page)
      await touch(cdp, "touchStart", from)
      const lifts: number[] = []
      for (let s = 1; s <= 12; s += 1) {
        await touch(cdp, "touchMove", f(from, 5 * s))
        lifts.push(await contentLift(page))
      }
      await nextFrame(page)
      const held = await contentLift(page)
      expect(
        Math.abs(held - 60),
        `premise: the content must follow the finger to ≈60 under throttle — read ${held} (per-move ${lifts.map((v) => v.toFixed(1)).join(",")})`,
      ).toBeLessThanOrEqual(10)

      await startSampler(page, {
        stable: 20,
        maxMs: 3000,
        requireChange: true,
      })
      await touch(cdp, "touchEnd")
      const samples = await collectSampler(page)
      const text = samples.map((v) => v.toFixed(1)).join(",")
      expect(
        distinct(samples),
        `premise: the close must animate (≥3 distinct lifts) — samples ${text}`,
      ).toBeGreaterThanOrEqual(3)
      expect(
        allEqual(lastN(samples, 20)) && samples.length >= 21,
        `the close must settle (20 identical samples) within 3s at 4x throttle — samples ${text}`,
      ).toBe(true)
      expect(
        Math.abs(samples[samples.length - 1]),
        `the close must land at 0 — landed at ${samples[samples.length - 1]}`,
      ).toBeLessThanOrEqual(0.5)
    } finally {
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 })
    }
  })

  test("100 pull/release cycles: listeners and heap plateau, the page idles", async ({
    page,
  }) => {
    test.setTimeout(300_000)
    await page.addInitScript(installProbes)
    const { cdp } = await setup(page)
    await cdp.send("HeapProfiler.enable")

    const N = 100
    const SAMPLE_AT = [33, 66, 100]
    const before = await sampleProbes(page, cdp)
    const samples: ({ at: number } & ProbeSample)[] = []
    let lifted = 0
    for (let i = 1; i <= N; i += 1) {
      const from = await boxCentre(page)
      const max = await drag(page, cdp, from, 40, { steps: 6 })
      if (max > 10) lifted += 1
      if (SAMPLE_AT.includes(i)) {
        const s = await sampleProbes(page, cdp)
        samples.push({ at: i, ...s })
      }
    }
    expect(
      lifted,
      `premise: the cycles must actually pull — ${lifted} of ${N} lifted past 10`,
    ).toBeGreaterThan(0)
    expect(await startedCount(page), "short pulls never refresh").toBe(0)

    const report = [
      `before: heap ${fmtMB(before.heap)} listeners w${before.listeners.window}/d${before.listeners.document} nodes ${before.nodes}`,
      ...samples.map(
        (s) =>
          `after ${s.at}: heap ${fmtMB(s.heap)} listeners w${s.listeners.window}/d${s.listeners.document} nodes ${s.nodes}`,
      ),
      `${lifted}/${N} cycles lifted`,
      `listeners since load: ${describeListenerDelta(before, samples[0])}`,
    ].join(" | ")
    console.log(`[stress-pull-to-refresh cycles] ${report}`)

    //a listener the first pull installs and then keeps is not a leak; a count
    //that keeps climbing is. So the samples must agree with each other from
    //the first one on, and a drift names the listener type it is
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
        `heap must plateau: growth 66→100 (${fmtMB(g23)}) must be ≤ growth 33→66 (${fmtMB(g12)}) + 1MB — ${report}`,
      )
      .toBeLessThanOrEqual(g12 + MB)
    expect
      .soft(
        Math.abs(samples[2].nodes - before.nodes),
        `DOM node count must be flat (short pulls log nothing) — ${report}`,
      )
      .toBeLessThanOrEqual(5)

    //idle: once the last close lands, no frame may be scheduled
    await expect
      .poll(() => contentLift(page), { timeout: 3000 })
      .toBeLessThanOrEqual(1)
    await startSampler(page, { stable: 20, maxMs: 3000 })
    const tail = await collectSampler(page)
    expect(allEqual(lastN(tail, 20)), "the last close must settle").toBe(
      true,
    )
    const quiet = await rafOverQuiet(page, 1000)
    expect(
      quiet.requested,
      `the page must idle: ${quiet.requested} rAF requested in 1s after 100 cycles — callers: ${JSON.stringify(quiet.callers)}`,
    ).toBe(0)
  })

  test("a pull that starts on a swipeable row pulls and refreshes, and a sideways drag on the row is the row's swipe", async ({
    page,
  }) => {
    //the screen the component exists for: a list of rows that swipe. Every
    //finger lands on a row, so a pull that cannot start there never starts
    const { cdp } = await setup(page)
    const rows = page.locator(ROWS_SCROLLER)
    await rows.scrollIntoViewIfNeeded()
    await awaitStable(
      () => rows.evaluate((el) => el.getBoundingClientRect().top),
      {
        message: "the rows box never held still after scrolling into view",
      },
    )
    const content = rows.locator("[data-swipeable-content]").first()
    const box = await content.boundingBox()
    if (!box) throw new Error("the first message row has no layout box")
    const from = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    }
    const onRow = await page.evaluate(
      ([x, y]) =>
        document
          .elementFromPoint(x as number, y as number)
          ?.closest("[data-swipeable-root]") !== null,
      [from.x, from.y] as const,
    )
    expect(onRow, `premise: (${from.x},${from.y}) must be on a row`).toBe(
      true,
    )
    expect(
      await rows.evaluate((el) => el.scrollTop),
      "premise: the rows box is at its top",
    ).toBe(0)

    //the pull: 120px down from the row, reading the lift between moves
    const lifts: number[] = []
    await touch(cdp, "touchStart", from)
    for (let s = 1; s <= 16; s += 1) {
      await touch(cdp, "touchMove", {
        x: from.x,
        y: Math.round(from.y + (120 * s) / 16),
      })
      lifts.push(await rowsLift(page))
    }
    expect(
      Math.max(...lifts),
      `the pull must follow the finger past the threshold — per-move ${lifts.map((v) => v.toFixed(1)).join(",")}`,
    ).toBeGreaterThan(PULL_THRESHOLD)
    await touch(cdp, "touchEnd")
    await expect
      .poll(() => logCount(page, /rows box refresh started/), {
        message:
          "the release past the threshold must start the rows box refresh",
        timeout: 2000,
      })
      .toBe(1)
    await expect
      .poll(() => logCount(page, /rows box refresh resolved/), {
        timeout: 4000,
      })
      .toBe(1)
    await expect
      .poll(() => rowsLift(page), {
        message: "after the work resolves the rows return to 0",
        timeout: 4000,
      })
      .toBeLessThanOrEqual(1)
    expect(
      await startedCount(page),
      "the plain box above must not have refreshed",
    ).toBe(0)
    expect(
      await logCount(page, /message opened/),
      "a vertical pull must not open a row",
    ).toBe(0)

    //the swipe: 60px left on the same row, held still, released — the row's
    const swipeLifts: number[] = []
    await touch(cdp, "touchStart", from)
    for (let s = 1; s <= 12; s += 1) {
      await touch(cdp, "touchMove", { x: from.x - s * 5, y: from.y })
      swipeLifts.push(await rowsLift(page))
    }
    //held still past the row's 60ms velocity window: the release is the
    //position's verdict, not a flick's
    await page.waitForTimeout(60)
    await touch(cdp, "touchEnd")
    await expect
      .poll(() => rowContentX(page), {
        message: "the sideways drag must open the row",
        timeout: 2000,
      })
      .toBeLessThan(-60)
    expect(
      Math.max(...swipeLifts),
      `a sideways drag on a row must not lift the rows — per-move ${swipeLifts.map((v) => v.toFixed(1)).join(",")}`,
    ).toBeLessThanOrEqual(1)
    expect(
      await logCount(page, /rows box refresh started/),
      "the swipe must not have refreshed",
    ).toBe(1)
  })

  test("a mouse swipe on a row inside the refresher opens the row: the refresher's capture does not end it", async ({
    page,
  }) => {
    //the pointer path: the refresher used to capture the pointer on whatever
    //it landed on at pointerdown. A row inside it moves the capture to its
    //own content at its lock, which fires lostpointercapture at the element
    //the refresher captured, and the row reads that as its drag ending
    await setup(page)
    const rows = page.locator(ROWS_SCROLLER)
    await rows.scrollIntoViewIfNeeded()
    await awaitStable(
      () => rows.evaluate((el) => el.getBoundingClientRect().top),
      {
        message: "the rows box never held still after scrolling into view",
      },
    )
    const content = rows.locator("[data-swipeable-content]").first()
    const box = await content.boundingBox()
    if (!box) throw new Error("the first message row has no layout box")
    const from = {
      x: Math.round(box.x + box.width / 2),
      y: Math.round(box.y + box.height / 2),
    }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    const xs: number[] = []
    for (let s = 1; s <= 12; s += 1) {
      await page.mouse.move(from.x - s * 5, from.y)
      xs.push(await rowContentX(page))
    }
    expect(
      Math.min(...xs),
      `PREMISE: the row must follow the mouse — per-move ${xs.map((v) => v.toFixed(1)).join(",")}`,
    ).toBeLessThan(-30)
    //held still past the row's 60ms velocity window, then released
    await page.waitForTimeout(60)
    await page.mouse.up()
    await expect
      .poll(() => rowContentX(page), {
        message: `the mouse swipe must open the row — per-move ${xs.map((v) => v.toFixed(1)).join(",")}`,
        timeout: 2000,
      })
      .toBeLessThan(-60)
    expect(
      await logCount(page, /rows box refresh started/),
      "a sideways mouse drag must not refresh",
    ).toBe(0)
  })
})

function f(from: { x: number; y: number }, dy: number) {
  return { x: from.x, y: from.y + dy }
}
