import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { bootControlled, deploy } from "./sw"

/*
 * The update flow under `serviceWorkerUpdate: "prompt"` — the exact inverse of
 * `update.spec.ts`.
 *
 * Under the default `auto`, a waiting worker is applied at the next cold launch
 * and the app never hears about it. Under `prompt`, adaptv must apply NOTHING on
 * its own, at any launch, ever — it hands the app the moment and waits for a
 * person. Both halves are worth an assertion and they fail in opposite
 * directions:
 *
 *   - applying anyway → a reload lands on top of whatever the user was doing,
 *     which is the entire thing this policy was chosen to prevent
 *   - never offering  → the app renders no banner, nobody can ever accept, and
 *     the update is stuck forever with nothing logged
 *
 * The second one is why the offer is read through `useServiceWorkerUpdate()` on
 * the lab page rather than from `registration.waiting`. A waiting worker proves
 * the BROWSER noticed the deploy; only the hook proves the signal crossed into
 * React, which is the surface an app actually builds a banner on.
 */

const LAB = "/lab/service-worker"

//Same pair as `update.spec.ts`: one cache the sweep must take, one it must not.
const STALE = "static-e2e-previous-build"
const FOREIGN = "acme-analytics-v1"

/** Read a `LabRow`'s value — label and value are sibling spans. */
function labValue(page: Page, label: string) {
  return page
    .getByText(label, { exact: true })
    .locator("xpath=following-sibling::span")
}

const UPDATE_AVAILABLE = "useServiceWorkerUpdate().updateAvailable"

test.describe("update flow (serviceWorkerUpdate: prompt)", () => {
  test("a deploy is offered to the app and applied only on intent", async ({
    page,
  }, testInfo) => {
    //a full production build runs inside this test
    test.setTimeout(300_000)

    await bootControlled(page)
    await page.goto(LAB, { waitUntil: "load" })
    await page.evaluate(
      async ([stale, foreign]) => {
        await caches.open(stale)
        await caches.open(foreign)
      },
      [STALE, FOREIGN],
    )

    //The control for the whole file. `updateAvailable` starting true would make
    //every assertion below pass without a deploy ever happening.
    await expect(
      labValue(page, UPDATE_AVAILABLE),
      "an update was offered before anything was deployed",
    ).toHaveText("false")

    deploy(
      `e2e-prompt-${testInfo.project.name}-${Date.now()}`,
      testInfo.config.rootDir,
    )

    /* 1 — offered ------------------------------------------------------------ */
    await page.reload({ waitUntil: "load" })
    await expect(
      labValue(page, UPDATE_AVAILABLE),
      "a worker installed and waited, but `useServiceWorkerUpdate()` never reported it — an app under this policy can render no banner and the update is unreachable",
    ).toHaveText("true", { timeout: 30_000 })

    /* 2 — not applied, not even at a launch ---------------------------------- */
    //`auto` applies here. This policy exists precisely so that it does not, so a
    //second launch is the assertion: reload, and the old worker must STILL be the
    //one in charge. `update.spec.ts` asserts the opposite of this same moment.
    await page.reload({ waitUntil: "load" })
    await expect(
      labValue(page, UPDATE_AVAILABLE),
      "the offer did not survive a launch — an app that shows its banner once and loses it is worse than one that never shows it",
    ).toHaveText("true", { timeout: 30_000 })

    const held = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      return {
        stillWaiting: !!registration?.waiting,
        cacheNames: await caches.keys(),
      }
    })
    expect(
      held.stillWaiting,
      "the waiting worker was applied without anyone asking — under `prompt` a launch must change nothing",
    ).toBe(true)
    expect(
      held.cacheNames,
      "the previous build's cache was swept, so the new worker activated on its own",
    ).toContain(STALE)

    /* 3 — applied on intent -------------------------------------------------- */
    //The app's own button, wired to `applyUpdate()` from the hook — the same call
    //a real banner makes. adaptv reloads the page itself once the new worker takes
    //over, which is why every read below is inside a poll that tolerates a
    //destroyed execution context.
    await page.getByRole("button", { name: "applyUpdate()" }).click()

    await expect
      .poll(
        async () => {
          try {
            const state = await page.evaluate(async () => {
              const registration =
                await navigator.serviceWorker.getRegistration()
              return {
                waitingApplied: !!registration && !registration.waiting,
                controlled: !!navigator.serviceWorker.controller,
                cacheNames: await caches.keys(),
              }
            })
            return {
              waitingApplied: state.waitingApplied,
              controlled: state.controlled,
              sweptPreviousBuild: !state.cacheNames.includes(STALE),
              keptForeignCache: state.cacheNames.includes(FOREIGN),
            }
          } catch {
            //the reload adaptv performs after the handover — the event being
            //waited for, not an error
            return { waitingApplied: false }
          }
        },
        {
          timeout: 60_000,
          message:
            "`applyUpdate()` did not take: under `prompt` this is the ONLY path an update has, so a failure here means no user of this app can ever move off the build they are on",
        },
      )
      .toEqual({
        waitingApplied: true,
        controlled: true,
        sweptPreviousBuild: true,
        keptForeignCache: true,
      })
  })
})
