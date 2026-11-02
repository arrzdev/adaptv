import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The drawer-vs-keyboard conformance run, as a test that bites.
 *
 * `/lab/drawer-keyboard` drives adaptv's keyboard observer through its test seam, paints a block
 * where the keyboard would be, and asserts what a UIKit sheet guarantees while the sheet avoids
 * it: never above the safe top, flush against the keyboard, and no edge turning around
 * mid-flight. Until this file the run was read off a screenshot on a simulator and off
 * `window.__drawerConformance` over CDP, and no spec in this suite opened the page — so a
 * regression in the sheet's keyboard avoidance reached a device before anything said so.
 *
 * The geometry checks are asserted here on both engines. The two TIMING checks are read but not
 * asserted, by name: "runs at frame rate" and "eased, not snapped" measure the sampler as much
 * as the sheet, and on the page clock below every frame is 16ms by construction, so they say
 * nothing about the machine. They stay in the report this spec attaches.
 */

type Check = { name: string; pass: boolean; detail: string }
type StepResult = {
  step: string
  checks: Check[]
  perf?: string
  samples: Array<{ t: number; top: number; bottom: number }>
}

const TIMING_CHECKS = new Set(["runs at frame rate", "eased, not snapped"])

//a turn needs a sample before it, at it and after it: with two, a reversal or an overshoot
//cannot show, and every geometry check of the step passes without reading anything
const MIN_SAMPLES = 3

//a phone held upright: the scenarios size the keyboard as a fraction of the viewport, and the
//interesting geometry (a sheet taller than the room left above the keyboard) needs a tall one.
//Touch, because the drag step fires TouchEvents and a desktop context has no constructor for them.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

/*
 * One geometry failure is KNOWN and allowed by name, and only that one: in the scenario where the
 * picker collapses first and the keyboard lands 48ms later, the content edge overshoots its rest
 * and comes back (both engines at this viewport, on the page clock: 844 → 506, turned 13px at 116ms;
 * the installed targets in docs/design/behaviors.md show the same turn). The harness names it so
 * the fix can be aimed; until it lands, this spec fails on ANY other geometry failure and on the
 * day the known one disappears, so the allowance is deleted the moment it is stale.
 */
const KNOWN_REVERSAL = {
  step: "picker collapses, keyboard lags",
  name: "content edge never reverses",
}
test.setTimeout(120_000)

test("the conformance run passes every geometry check @tailwind", async ({
  page,
}, testInfo) => {
  //One frame per 16ms of page time, stepped from here, with the sheet's CSS transitions held to
  //the same clock (`?virtual`): how many samples a step gets no longer depends on how fast the
  //runner paints (a starved webkit runner once gave "release 70%→0" two).
  await openOnPausedClock(page, "/lab/drawer-keyboard?virtual")
  const results = await runOnClock(page, () => page.clock.runFor(16))
  await testInfo.attach("conformance", {
    body: JSON.stringify(
      results.map(({ samples, ...rest }) => ({
        ...rest,
        samples: samples.length,
      })),
      null,
      2,
    ),
    contentType: "application/json",
  })

  //the run has 17 steps and about 107 checks; a page that opened the sheet but bailed out early
  //must not pass by asserting nothing
  expect(results.length).toBeGreaterThanOrEqual(15)
  const checks = results.flatMap((r) =>
    r.checks.map((c) => ({ step: r.step, ...c })),
  )
  expect(checks.length).toBeGreaterThanOrEqual(90)

  const failedGeometry = checks.filter(
    (c) => !TIMING_CHECKS.has(c.name) && !c.pass,
  )
  const known = failedGeometry.filter(
    (c) =>
      c.step === KNOWN_REVERSAL.step && c.name === KNOWN_REVERSAL.name,
  )
  expect(
    failedGeometry
      .filter((c) => !known.includes(c))
      .map((c) => `${c.step}: ${c.name} — ${c.detail}`),
  ).toEqual([])
  //the known turn is expected to be there, named; when it is not, delete KNOWN_REVERSAL
  expect(known.map((c) => c.detail)).toHaveLength(1)
  expect(known[0].detail).toMatch(/turned \d+px at \d+ms/)

  //every frame-sampled step carries a series long enough to read its checks from
  for (const r of results) {
    if (r.step === "drag with the keyboard up") continue
    expect(r.samples.length, r.step).toBeGreaterThanOrEqual(MIN_SAMPLES)
  }

  //the overlay says the same thing the data does
  const report = page.getByTestId("conformance-report")
  const failedTotal = checks.filter((c) => !c.pass).length
  await expect(report).toContainText(
    failedTotal === 0 ? "PASS" : `FAIL ${failedTotal}/${checks.length}`,
  )
})

/*
 * A starved runner, made on purpose: the page clock jumps 400ms at a time, so each 700ms step
 * sees two frames. The run must call that out, step by step, instead of passing geometry checks
 * it had no series to read.
 */
test("a step sampled fewer than 3 times is reported undersampled @tailwind", async ({
  page,
}) => {
  await openOnPausedClock(page, "/lab/drawer-keyboard?only=dismiss")
  //Frames at the normal pace until the sheet's content is mounted: a 400ms jump can fire the
  //run's 600ms start timer before the sheet has rendered, and the run then has nothing to drive.
  //Starved from there on.
  const sheet = page.locator("[data-pwa-drawer] > div")
  const results = await runOnClock(page, async () =>
    (await sheet.count())
      ? page.clock.fastForward(400)
      : page.clock.runFor(16),
  )

  const sampled = results.map((r) => ({
    step: r.step,
    samples: r.samples.length,
    check: r.checks.find((c) => c.name === "sampled enough to judge"),
  }))
  expect(sampled.length).toBeGreaterThan(0)
  for (const s of sampled) {
    expect(s.samples, s.step).toBeLessThan(MIN_SAMPLES)
    expect(s.check?.pass, s.step).toBe(false)
    expect(s.check?.detail, s.step).toMatch(/^undersampled: \d samples/)
  }
})

/**
 * The splash leaves on timers, so the clock runs through the handover; it is paused before the
 * sheet opens, so the run's first timer is already on the paused clock.
 */
async function openOnPausedClock(page: Page, url: string) {
  await page.clock.install()
  await page.goto(url)
  await awaitClientHandover(page)
  //a second ahead: the clock is still running, and pausing in its past throws
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 1_000)
  await page
    .getByRole("button", { name: "Open drawer (runs itself)" })
    .click()
}

/** Moves the page clock with `advance` until the run publishes, and returns what it published. */
async function runOnClock(page: Page, advance: () => Promise<void>) {
  for (let i = 0; i < 5_000; i++) {
    await advance()
    const done = await page.evaluate(() =>
      Array.isArray(
        (window as unknown as { __drawerConformance?: unknown })
          .__drawerConformance,
      ),
    )
    if (done) {
      return page.evaluate(
        () =>
          (window as unknown as { __drawerConformance: StepResult[] })
            .__drawerConformance,
      )
    }
  }
  throw new Error(
    "the conformance run never published window.__drawerConformance (5000 clock steps)",
  )
}
