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
 * as the sheet, and a CI runner that starves requestAnimationFrame fails them with the geometry
 * intact (docs/design/behaviors.md records the simulator doing the same). They stay in the report
 * this spec attaches, so a run that went slow is visible without being red.
 */

type Check = { name: string; pass: boolean; detail: string }
type StepResult = {
  step: string
  checks: Check[]
  perf?: string
  samples: Array<{ t: number; top: number; bottom: number }>
}

const TIMING_CHECKS = new Set(["runs at frame rate", "eased, not snapped"])

//a phone held upright: the scenarios size the keyboard as a fraction of the viewport, and the
//interesting geometry (a sheet taller than the room left above the keyboard) needs a tall one.
//Touch, because the drag step fires TouchEvents and a desktop context has no constructor for them.
test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

/*
 * One geometry failure is KNOWN and allowed by name, and only that one: in the scenario where the
 * picker collapses first and the keyboard lands 48ms later, the content edge overshoots its rest
 * and comes back (headless chromium at this viewport: 844 → 506, turned 8px at 129ms, 463 → 471;
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
  await page.goto("/lab/drawer-keyboard?autorun")
  //the SSR splash self-unmounts on hydration, and `?autorun` opens the sheet from a client
  //effect, so nothing below is meaningful before it is gone
  await awaitClientHandover(page)
  //a SYNC predicate: an async one returns a Promise, which is truthy, and the wait is a no-op
  await page.waitForFunction(
    () =>
      Array.isArray(
        (window as unknown as { __drawerConformance?: unknown })
          .__drawerConformance,
      ),
    null,
    { timeout: 90_000 },
  )
  const results = await page.evaluate(
    () =>
      (window as unknown as { __drawerConformance: StepResult[] })
        .__drawerConformance,
  )
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

  //every frame-sampled step carries the series its checks were read from, so a reversal can
  //be named from the data and not only from its endpoints
  for (const r of results) {
    if (r.step === "drag with the keyboard up") continue
    expect(r.samples.length, r.step).toBeGreaterThan(2)
  }

  //the overlay says the same thing the data does
  const report = page.getByTestId("conformance-report")
  const failedTotal = checks.filter((c) => !c.pass).length
  await expect(report).toContainText(
    failedTotal === 0 ? "PASS" : `FAIL ${failedTotal}/${checks.length}`,
  )
})
