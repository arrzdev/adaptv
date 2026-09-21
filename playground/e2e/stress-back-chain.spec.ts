import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The back chain under rapid fire — presses faster than React commits, handlers
 * that come and go mid-chain, and one that throws.
 *
 * `back-chain.spec.ts` presses once per state. Here the contract in
 * `src/capabilities/back-chain.ts` is driven at its edges:
 *
 *   - `runBackChain` iterates a SNAPSHOT sorted by band then recency, so a
 *     handler registered or removed while the chain runs takes effect on the
 *     NEXT press, never mid-press;
 *   - a throwing handler is skipped, the press goes on to the next band, and the
 *     result is whatever the rest decides — the chain never rethrows;
 *   - each press is one auction: twenty presses in a row consume the three open
 *     fakes in band-then-recency order and then fall to the floor seventeen times.
 *
 * The lab page registers through React effects, so its handlers leave the chain
 * only after a commit. For the mid-chain and throwing cases the test registers
 * handlers directly on the capability's own module — the module the app itself
 * imports, at the `/@fs` URL the dev server serves the linked framework from,
 * built from the client entry's resource entry so it holds on every checkout
 * (drawer-handle-mouse.spec.ts does the same). The premise that it IS that
 * instance (a handler registered there wins a press the lab's own log can see)
 * is asserted before anything else is.
 */

const BACK_CHAIN_MODULE = "capabilities/back-chain.ts"

type Chain = {
  registerBackHandler: (
    handler: () => boolean,
    priority?: number,
  ) => () => void
  runBackChain: () => boolean
  BackPriority: Record<string, number>
}

declare global {
  interface Window {
    __chain?: Chain
    __chainLog?: string[]
  }
}

async function loadChain(page: Page) {
  await page.evaluate(async (file) => {
    const entry = performance
      .getEntriesByType("resource")
      .map((resource) => resource.name)
      .find((name) => /\/src\/routes\/client-entry\.tsx$/.test(name))
    if (!entry) throw new Error("the adaptv client entry was never loaded")
    const url = entry.replace(/routes\/client-entry\.tsx$/, file)
    window.__chain = (await import(/* @vite-ignore */ url)) as Chain
    window.__chainLog = []
  }, BACK_CHAIN_MODULE)
}

const labLog = (page: Page) => page.locator("[data-lab-log] li")

const runButton = (page: Page) =>
  page.getByRole("button", { name: "runBackChain()" })

test.describe("Back chain under rapid fire", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/lab/back-chain")
    await awaitClientHandover(page)
    await expect(page.getByText("useBackHandler(…, 100)")).toBeVisible()
    await loadChain(page)
    //the premise: the imported module is the app's own chain
    await page.evaluate(() => {
      const chain = window.__chain
      if (!chain) throw new Error("module not loaded")
      const off = chain.registerBackHandler(() => {
        window.__chainLog?.push("probe")
        off()
        return true
      }, 1000)
    })
    await runButton(page).click()
    await expect(labLog(page).first()).toContainText(
      "runBackChain() → consumed",
    )
    expect(await page.evaluate(() => window.__chainLog)).toEqual(["probe"])
    expect(
      await labLog(page).count(),
      "the probe won before any lab handler ran",
    ).toBe(1)
  })

  test("twenty presses consume the three fakes in order, then fall to the floor", async ({
    page,
  }) => {
    await page.getByRole("button", { name: "Open a fake overlay" }).click()
    await page
      .getByRole("button", { name: "Open a second fake overlay" })
      .click()
    await page.getByRole("button", { name: "Open a fake menu" }).click()
    await expect(page.getByText("true", { exact: true })).toHaveCount(3)

    //each press is its own task, as a hardware button's would be; the lab log
    //keeps 40 lines, so the winners are read as soon as they have to be
    for (let press = 0; press < 3; press += 1) {
      await runButton(page).click()
    }
    //the three fakes have closed: the commit the log is read after
    await expect(page.getByText("false", { exact: true })).toHaveCount(3)
    const winners = (await labLog(page).allInnerTexts())
      .filter((line) => line.includes("consumed the press"))
      .reverse()
    expect(winners.map((line) => line.split("· ")[1])).toEqual([
      "Second overlay (400) consumed the press",
      "Overlay (400) consumed the press",
      "Transient (300) consumed the press",
    ])

    const results = await page.evaluate(() => {
      const out: boolean[] = []
      for (let press = 0; press < 17; press += 1) {
        out.push(window.__chain?.runBackChain() ?? true)
      }
      return out
    })
    expect(
      results,
      "nothing left to consume: seventeen floor results",
    ).toEqual(Array.from({ length: 17 }, () => false))
    //the deferring handlers were still reached on every one of them
    const lines = await labLog(page).allInnerTexts()
    expect(
      lines.filter((line) => line.includes("Affordance (200) deferred")),
    ).toHaveLength(17)
    expect(
      lines.filter((line) =>
        line.includes("useBackHandler (100) deferred"),
      ),
    ).toHaveLength(17)
  })

  test("a throwing handler is skipped, and the press still reaches the bands below it", async ({
    page,
  }) => {
    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))

    const results = await page.evaluate(() => {
      const chain = window.__chain
      if (!chain) throw new Error("module not loaded")
      const log = window.__chainLog ?? []
      const offThrow = chain.registerBackHandler(() => {
        log.push("throw")
        throw new Error("a handler that throws")
      }, chain.BackPriority.Overlay)
      const offBelow = chain.registerBackHandler(() => {
        log.push("below")
        return true
      }, chain.BackPriority.Transient)
      const out: boolean[] = []
      for (let press = 0; press < 20; press += 1)
        out.push(chain.runBackChain())
      offThrow()
      offBelow()
      return { out, log }
    })
    expect(results.out).toEqual(Array.from({ length: 20 }, () => true))
    expect(results.log.slice(1)).toEqual(
      Array.from({ length: 20 }, () => ["throw", "below"]).flat(),
    )
    expect(errors, "the chain never rethrows").toEqual([])
  })

  test("a handler that registers and unregisters mid-chain takes effect on the next press only", async ({
    page,
  }) => {
    const results = await page.evaluate(() => {
      const chain = window.__chain
      if (!chain) throw new Error("module not loaded")
      const log = window.__chainLog ?? []
      let offLate: (() => void) | null = null
      //on its first run this handler adds a HIGHER band handler and removes
      //itself; the snapshot means neither change is seen until the next press
      const offSelf = chain.registerBackHandler(() => {
        log.push("self")
        offLate ??= chain.registerBackHandler(() => {
          log.push("late")
          return true
        }, chain.BackPriority.Overlay)
        offSelf()
        return false
      }, chain.BackPriority.Transient)
      const offFloor = chain.registerBackHandler(() => {
        log.push("floor")
        return true
      }, chain.BackPriority.Affordance)
      const first = chain.runBackChain()
      const second = chain.runBackChain()
      const third = chain.runBackChain()
      offLate?.()
      offFloor()
      return { first, second, third, log }
    })
    expect(results.first).toBe(true)
    expect(results.second).toBe(true)
    expect(results.third).toBe(true)
    expect(results.log.slice(1)).toEqual(["self", "floor", "late", "late"])
  })

  test("twenty presses on the seam in one task never run the chain twice per press", async ({
    page,
  }) => {
    //`window.__adaptvBack` is the lab shell's seam: the same call the platform
    //listener makes, so a burst here is a burst of hardware presses
    const results = await page.evaluate(() => {
      const chain = window.__chain
      const back = (window as { __adaptvBack?: () => unknown })
        .__adaptvBack
      if (!chain || !back) throw new Error("seam not installed")
      const log = window.__chainLog ?? []
      const off = chain.registerBackHandler(() => {
        log.push("press")
        return true
      }, chain.BackPriority.Overlay)
      for (let press = 0; press < 20; press += 1) back()
      off()
      return log
    })
    expect(results.slice(1)).toEqual(
      Array.from({ length: 20 }, () => "press"),
    )
  })
})
