import type { Page } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"
import { expect, test } from "./support/reload-guard"

/*
 * The display cluster's full-screen surfaces under stress — the pre-paint theme
 * script, the launch splash, the offline screen, the rotate guard and the three
 * "the app is not usable" screens — driven the way a device drives them (an OS
 * appearance flip, a reload, a network flip, a rotation, a giant font on a tiny
 * phone) but faster and more often than any hand can.
 *
 * Every measurement is read by an observer installed BEFORE the document exists
 * (`addInitScript`), because the claims here are about what happened between the
 * first byte and the settled page: which theme class the html element carried on
 * its first write, whether the splash left once or twice, how many times the guard
 * mounted. A read after the fact cannot see any of that. Note the init script runs
 * before `document.documentElement` exists — the observers watch `document` with
 * `subtree: true` and let the parser's own insertions reach them.
 */

const PORTRAIT = { width: 390, height: 844 }
const LANDSCAPE = { width: 844, height: 390 }
const TINY_PORTRAIT = { width: 320, height: 568 }
const TINY_LANDSCAPE = { width: 568, height: 320 }

const THEME_KEY = "ui-theme-preference"
//the playground supplies its own rotate guard (`adaptv.config.ts`
//`orientationGuardScreen`), so the screen adaptv mounts is the app's `role="alert"`
//with the app's copy — the only alert on /lab/screens
const GUARD = '[role="alert"]'
const GUARD_COPY = /rotate your device/i
const rotateGuard = (page: Page) =>
  page.getByRole("alert").filter({ hasText: GUARD_COPY })
const SPLASH = "[data-adaptv-splash]"

type ClassWrite = { at: number; className: string }
type SplashEvent = { at: number; kind: "added" | "removed" }
type GuardEvent = { at: number; kind: "added" | "removed" }

declare global {
  interface Window {
    __classWrites: ClassWrite[]
    __schemeChanges: number
    __splashLog: SplashEvent[]
    __guardLog: GuardEvent[]
    __mqlChangeListeners: number
    __listeners: Record<string, number>
  }
}

/** Every write to the html element's class attribute, from before the first byte. */
async function observeHtmlClass(page: Page) {
  await page.addInitScript(() => {
    window.__classWrites = []
    window.__schemeChanges = 0
    new MutationObserver((records) => {
      for (const record of records) {
        const target = record.target as Element
        if (target !== document.documentElement) continue
        window.__classWrites.push({
          at: performance.now(),
          className: target.className,
        })
      }
    }).observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    })
    matchMedia("(prefers-color-scheme: dark)").addEventListener(
      "change",
      () => {
        window.__schemeChanges += 1
      },
    )
  })
}

/** Every element matching `selector` that entered or left the document. */
async function observePresence(
  page: Page,
  selector: string,
  log: "__splashLog" | "__guardLog",
) {
  await page.addInitScript(
    ({ selector, log }) => {
      window[log] = []
      const matches = (node: Node) =>
        node.nodeType === 1 &&
        ((node as Element).matches(selector) ||
          (node as Element).querySelector(selector) !== null)
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes)
            if (matches(node))
              window[log].push({ at: performance.now(), kind: "added" })
          for (const node of record.removedNodes)
            if (matches(node))
              window[log].push({ at: performance.now(), kind: "removed" })
        }
      }).observe(document, { subtree: true, childList: true })
    },
    { selector, log },
  )
}

/** Net `change` listeners on every MediaQueryList, from before the first script. */
async function countMediaQueryListeners(page: Page) {
  await page.addInitScript(() => {
    window.__mqlChangeListeners = 0
    const proto = MediaQueryList.prototype
    const add = proto.addEventListener
    const remove = proto.removeEventListener
    proto.addEventListener = function (this: MediaQueryList, ...args) {
      if (args[0] === "change") window.__mqlChangeListeners += 1
      return add.apply(this, args as Parameters<typeof add>)
    }
    proto.removeEventListener = function (this: MediaQueryList, ...args) {
      if (args[0] === "change") window.__mqlChangeListeners -= 1
      return remove.apply(this, args as Parameters<typeof remove>)
    }
  })
}

/** Net listeners on window and document, keyed `window:online` etc. */
async function countGlobalListeners(page: Page) {
  await page.addInitScript(() => {
    window.__listeners = {}
    const proto = EventTarget.prototype
    const add = proto.addEventListener
    const remove = proto.removeEventListener
    const keyFor = (target: EventTarget, type: string) =>
      target === window
        ? `window:${type}`
        : target === document
          ? `document:${type}`
          : null
    proto.addEventListener = function (this: EventTarget, ...args) {
      const key = keyFor(this, String(args[0]))
      if (key) window.__listeners[key] = (window.__listeners[key] ?? 0) + 1
      return add.apply(this, args as Parameters<typeof add>)
    }
    proto.removeEventListener = function (this: EventTarget, ...args) {
      const key = keyFor(this, String(args[0]))
      if (key) window.__listeners[key] = (window.__listeners[key] ?? 0) - 1
      return remove.apply(this, args as Parameters<typeof remove>)
    }
  })
}

function collectHydrationComplaints(page: Page): string[] {
  const complaints: string[] = []
  page.on("console", (message) => {
    const text = message.text()
    if (/hydrat|did not match|#418|#423|#425/i.test(text))
      complaints.push(`console.${message.type()}: ${text}`)
  })
  page.on("pageerror", (error) => {
    complaints.push(`uncaught: ${error.message}`)
  })
  return complaints
}

const themeOf = (className: string) =>
  className.split(/\s+/).find((c) => c === "light" || c === "dark") ?? null

/**
 * Flip the emulated OS scheme `count` times, alternating away from `from`, and
 * let the engine acknowledge each one through its own `change` event before the
 * next. Back-to-back `emulateMedia` calls inside one frame collapse to no change
 * at all (a→b→a is a no-op to the media query), so an unacknowledged burst is not
 * ten flips — it is however many the engine kept. Returns the wall time.
 */
async function flipScheme(
  page: Page,
  count: number,
  from: "light" | "dark",
) {
  const other = from === "dark" ? "light" : "dark"
  const started = Date.now()
  for (let i = 0; i < count; i++) {
    const before = await page.evaluate(() => window.__schemeChanges)
    //the first flip leaves `from`; an even count lands back on it
    await page.emulateMedia({ colorScheme: i % 2 === 0 ? other : from })
    await expect
      .poll(() => page.evaluate(() => window.__schemeChanges))
      .toBe(before + 1)
  }
  return Date.now() - started
}

test.describe("theme init script under runtime appearance flips", () => {
  test("an explicit dark preference paints dark on the html element's first write and ignores ten OS flips", async ({
    page,
  }) => {
    const complaints = collectHydrationComplaints(page)
    await observeHtmlClass(page)
    await page.addInitScript((key) => {
      localStorage.setItem(key, "dark")
    }, THEME_KEY)
    await page.emulateMedia({ colorScheme: "light" })
    await page.goto("/lab/stress-display")
    await awaitClientHandover(page)

    const writes = await page.evaluate(() => window.__classWrites)
    console.log(
      `[stress-screens ${test.info().project.name}] explicit dark, class writes ${JSON.stringify(writes.map((w) => [Math.round(w.at), w.className]))}`,
    )
    //the premise: the pre-paint script wrote the class before anything else did
    expect(writes.length).toBeGreaterThan(0)
    //the first write is already dark, so there is no frame to paint light in
    expect(themeOf(writes[0].className)).toBe("dark")
    //and nothing later ever wrote light
    expect(writes.map((w) => themeOf(w.className))).not.toContain("light")

    //emulated light since before the load; ten flips land back on light
    const elapsed = await flipScheme(page, 10, "light")

    const after = await page.evaluate(() => ({
      classes: [...document.documentElement.classList],
      preference: document.documentElement.getAttribute("data-ui-theme"),
      colorScheme: document.documentElement.style.colorScheme,
      writes: window.__classWrites.length,
    }))
    expect(after.classes).toContain("dark")
    expect(after.classes).not.toContain("light")
    expect(after.preference).toBe("dark")
    expect(after.colorScheme).toBe("dark")
    //an explicit preference does not react to the OS at all — no new class writes
    expect(after.writes).toBe(writes.length)
    expect(elapsed).toBeLessThan(2_000)
    expect(complaints).toEqual([])
  })

  test("the system preference follows ten OS flips in a row with no frame off-theme and no hydration complaint", async ({
    page,
  }) => {
    const complaints = collectHydrationComplaints(page)
    await observeHtmlClass(page)
    await page.addInitScript((key) => {
      localStorage.setItem(key, "system")
    }, THEME_KEY)
    await page.emulateMedia({ colorScheme: "dark" })
    await page.goto("/lab/stress-display")
    await awaitClientHandover(page)

    const initial = await page.evaluate(() => window.__classWrites)
    expect(initial.length).toBeGreaterThan(0)
    expect(themeOf(initial[0].className)).toBe("dark")

    //emulated dark since before the load; ten flips land back on dark
    const elapsed = await flipScheme(page, 10, "dark")
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/)
    expect(elapsed).toBeLessThan(2_000)

    //and a burst the engine is free to coalesce: ten flips issued back to back,
    //ending light — whatever the engine collapsed them to, the page ends on the
    //last one and never wrote a class without a theme
    for (let i = 0; i < 10; i++)
      await page.emulateMedia({ colorScheme: i % 2 ? "light" : "dark" })
    await expect(page.locator("html")).toHaveClass(/(^|\s)light(\s|$)/)
    await page.emulateMedia({ colorScheme: "dark" })
    await expect(page.locator("html")).toHaveClass(/(^|\s)dark(\s|$)/)

    const writes = await page.evaluate(() => window.__classWrites)
    const themes = writes.map((w) => themeOf(w.className))
    console.log(
      `[stress-screens ${test.info().project.name}] system, ${elapsed} ms for 10 flips, ${writes.length} class writes: ${JSON.stringify(themes)}`,
    )
    //every write carried exactly one theme class. The observer reads the class
    //when its callback runs, after the task that wrote it, so what this proves is
    //that no TASK ended with the html element off-theme — the remove-then-add
    //inside `applyTheme` is one task, and a frame can only paint between tasks
    expect(themes).not.toContain(null)
    for (const { className } of writes)
      expect(
        className
          .split(/\s+/)
          .filter((c) => c === "light" || c === "dark"),
      ).toHaveLength(1)
    //the flips landed: at least one light write after the initial dark
    expect(themes.slice(initial.length)).toContain("light")
    const state = await page.evaluate(() => ({
      preference: document.documentElement.getAttribute("data-ui-theme"),
      colorSchemeMeta: document.querySelector<HTMLMetaElement>(
        'meta[name="color-scheme"]',
      )?.content,
      colorScheme: document.documentElement.style.colorScheme,
    }))
    expect(state.preference).toBe("system")
    expect(state.colorSchemeMeta).toBe("light dark")
    expect(state.colorScheme).toBe("dark")
    expect(complaints).toEqual([])
  })
})

test.describe("splash overlay under a reload storm", () => {
  test("five reloads: the splash leaves exactly once per document and never comes back", async ({
    page,
  }) => {
    await observePresence(page, SPLASH, "__splashLog")
    const complaints = collectHydrationComplaints(page)
    await page.goto("/lab/screens")
    await awaitClientHandover(page)

    const logs: SplashEvent[][] = []
    for (let i = 0; i < 6; i++) {
      if (i > 0) {
        await page.reload()
        await awaitClientHandover(page)
      }
      //the page's own row polls for 1.5 s before it commits to an answer
      await expect(page.getByText("gone, as expected")).toBeVisible()
      logs.push(await page.evaluate(() => window.__splashLog))
    }
    console.log(
      `[stress-screens ${test.info().project.name}] splash per document: ${JSON.stringify(logs.map((log) => log.map((e) => `${e.kind}@${Math.round(e.at)}`)))}`,
    )
    for (const log of logs) {
      //the premise: the server-rendered splash was in this document at all
      expect(log.filter((e) => e.kind === "added").length).toBeGreaterThan(
        0,
      )
      //it left exactly once…
      expect(log.filter((e) => e.kind === "removed")).toHaveLength(1)
      //…and nothing was added after it left
      const removedAt = log.find((e) => e.kind === "removed")?.at ?? 0
      expect(
        log.filter((e) => e.kind === "added" && e.at > removedAt),
      ).toHaveLength(0)
    }
    expect(await page.locator(SPLASH).count()).toBe(0)
    expect(complaints).toEqual([])
  })
})

test.describe("offline screen under a network storm", () => {
  test("twenty network flips in a row leave the hook on the last answer and still listening", async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName !== "chromium",
      "setOffline fires no online/offline events in WebKit",
    )
    await countGlobalListeners(page)
    await page.goto("/lab/offline")
    await awaitClientHandover(page)
    await expect(page.getByText("false", { exact: true })).toBeVisible()

    const listenersBefore = await page.evaluate(() => ({
      ...window.__listeners,
    }))
    //the premise: the hook is listening on window for both events
    expect(listenersBefore["window:online"]).toBeGreaterThan(0)
    expect(listenersBefore["window:offline"]).toBeGreaterThan(0)

    const started = Date.now()
    for (let i = 0; i < 20; i++)
      await page.context().setOffline(i % 2 === 0)
    const elapsed = Date.now() - started
    //an even count ends online
    await expect(page.getByText("false", { exact: true })).toBeVisible()

    const listenersAfter = await page.evaluate(() => ({
      ...window.__listeners,
    }))
    console.log(
      `[stress-screens ${test.info().project.name}] 20 flips in ${elapsed} ms; window listeners before ${JSON.stringify(listenersBefore)} after ${JSON.stringify(listenersAfter)}`,
    )
    expect(elapsed).toBeLessThan(2_000)
    expect(listenersAfter["window:online"]).toBe(
      listenersBefore["window:online"],
    )
    expect(listenersAfter["window:offline"]).toBe(
      listenersBefore["window:offline"],
    )

    //still reactive after the storm, in both directions
    await page.context().setOffline(true)
    await expect(page.getByText("true", { exact: true })).toBeVisible()
    await page.context().setOffline(false)
    await expect(page.getByText("false", { exact: true })).toBeVisible()
    //and the screen itself still works: its retry action reaches the owner
    const row = page
      .getByText("onRetry calls", { exact: true })
      .locator("..")
    await page.getByRole("button", { name: "Try again" }).click()
    await expect(row).toContainText("1")
  })
})

test.describe("orientation guard under rapid rotation", () => {
  test.use({ hasTouch: true, viewport: LANDSCAPE })

  test("ten rotations in under two seconds: one guard, no flicker, no listener growth", async ({
    page,
  }) => {
    await countMediaQueryListeners(page)
    await observePresence(page, GUARD, "__guardLog")
    await page.goto("/lab/screens")
    await awaitClientHandover(page)
    //the premise: a coarse pointer held sideways
    expect(
      await page.evaluate(
        () =>
          matchMedia("(orientation: landscape) and (pointer: coarse)")
            .matches,
      ),
    ).toBe(true)
    await expect(rotateGuard(page)).toHaveCount(1)

    const listenersBefore = await page.evaluate(
      () => window.__mqlChangeListeners,
    )
    const logBefore = await page.evaluate(() => window.__guardLog.length)

    const started = Date.now()
    for (let i = 0; i < 10; i++)
      await page.setViewportSize(i % 2 === 0 ? PORTRAIT : LANDSCAPE)
    const elapsed = Date.now() - started
    //ten rotations end landscape (i = 9): the guard is up
    await expect(rotateGuard(page)).toHaveCount(1)
    await expect(rotateGuard(page)).toBeVisible()

    const after = await page.evaluate(() => ({
      listeners: window.__mqlChangeListeners,
      log: window.__guardLog,
    }))
    const events = after.log.slice(logBefore)
    console.log(
      `[stress-screens ${test.info().project.name}] 10 rotations in ${elapsed} ms; guard events ${JSON.stringify(events.map((e) => `${e.kind}@${Math.round(e.at)}`))}; MQL change listeners ${listenersBefore} → ${after.listeners}`,
    )
    expect(elapsed).toBeLessThan(2_000)
    //every rotation is at most one mount or one unmount — never a mount-unmount
    //pair for a single rotation, which is what a flicker is
    expect(events.length).toBeLessThanOrEqual(10)
    const adds = events.filter((e) => e.kind === "added").length
    const removes = events.filter((e) => e.kind === "removed").length
    //an even number of rotations from landscape lands on landscape: net zero
    expect(adds - removes).toBe(0)
    //alternating, never two of a kind in a row
    for (let i = 1; i < events.length; i++)
      expect(events[i].kind).not.toBe(events[i - 1].kind)
    //the media query registry holds ONE change listener per distinct query for the
    //life of the document — rotations subscribe and unsubscribe components, not
    //listeners, so the count cannot grow with the number of rotations
    expect(after.listeners).toBe(listenersBefore)

    //and it is still live after the storm
    await page.setViewportSize(PORTRAIT)
    await expect(rotateGuard(page)).toHaveCount(0)
  })
})

/*
 * The three "the app is not usable" screens on the smallest phone adaptv targets
 * with the largest system font: the copy has to wrap, not push the page sideways,
 * and the one action each screen offers has to be where a finger can reach it.
 */
test.describe("full-screen fallbacks at 320 px and a 200 % font", () => {
  test.use({ viewport: TINY_PORTRAIT })

  test("not-found, boot-error and offline stay inside their box with the action reachable", async ({
    page,
  }) => {
    await page.goto("/lab/stress-display")
    await awaitClientHandover(page)
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
    })
    //the premise: a rem is really 32 px now
    expect(
      await page.evaluate(() =>
        parseFloat(getComputedStyle(document.documentElement).fontSize),
      ),
    ).toBe(32)

    const screens = [
      [
        "stress-screen-not-found",
        '[data-adaptv="not-found"]',
        "link",
        "Back to home",
      ],
      [
        "stress-screen-boot-error",
        '[data-adaptv="boot-error"]',
        "button",
        "Try again",
      ],
      [
        "stress-screen-offline",
        '[data-adaptv="offline"]',
        "button",
        "Try again",
      ],
    ] as const
    for (const [boxId, selector, role, name] of screens) {
      const box = page.getByTestId(boxId)
      const screen = box.locator(selector)
      await expect(screen).toBeVisible()
      const geometry = await box.evaluate((el, selector) => {
        const screen = el.querySelector(selector) as HTMLElement
        return {
          boxWidth: el.clientWidth,
          boxScrollWidth: el.scrollWidth,
          screenWidth: screen.clientWidth,
          screenScrollWidth: screen.scrollWidth,
          pageWidth: document.scrollingElement?.clientWidth,
          pageScrollWidth: document.scrollingElement?.scrollWidth,
        }
      }, selector)
      console.log(
        `[stress-screens ${test.info().project.name}] ${boxId} ${JSON.stringify(geometry)}`,
      )
      expect(geometry.boxScrollWidth).toBeLessThanOrEqual(
        geometry.boxWidth,
      )
      expect(geometry.screenScrollWidth).toBeLessThanOrEqual(
        geometry.screenWidth,
      )
      expect(geometry.pageScrollWidth).toBeLessThanOrEqual(
        geometry.pageWidth ?? 0,
      )
      const action = screen.getByRole(role, { name })
      await action.scrollIntoViewIfNeeded()
      await expect(action).toBeVisible()
      const boxRect = await box.boundingBox()
      const actionRect = await action.boundingBox()
      expect(boxRect).not.toBeNull()
      expect(actionRect).not.toBeNull()
      if (!boxRect || !actionRect) throw new Error("unreachable")
      expect(actionRect.x).toBeGreaterThanOrEqual(boxRect.x - 0.5)
      expect(actionRect.x + actionRect.width).toBeLessThanOrEqual(
        boxRect.x + boxRect.width + 0.5,
      )
      //actionable: visible, enabled, not covered — without firing a reload or a navigation
      await action.click({ trial: true })
    }
  })

  test("the update-required screen wraps its copy and covers the page", async ({
    page,
  }) => {
    await page.goto("/lab/ota")
    await awaitClientHandover(page)
    await page.evaluate(
      ({ key }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            buildTag: "e2e0000000000000",
            since: Date.now() - 20 * 86_400_000 - 3_600_000,
          }),
        )
      },
      { key: "adaptv.ota.store-release" },
    )
    await page.reload()
    await awaitClientHandover(page)
    const screen = page.locator('[data-adaptv="update-required"]')
    await expect(screen).toBeVisible()
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
    })
    const geometry = await screen.evaluate((el) => ({
      width: el.clientWidth,
      scrollWidth: el.scrollWidth,
      pageWidth: document.scrollingElement?.clientWidth,
      pageScrollWidth: document.scrollingElement?.scrollWidth,
      textRight: Math.max(
        ...[...el.querySelectorAll("p")].map(
          (p) => p.getBoundingClientRect().right,
        ),
      ),
    }))
    console.log(
      `[stress-screens ${test.info().project.name}] update-required ${JSON.stringify(geometry)}`,
    )
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width)
    expect(geometry.pageScrollWidth).toBeLessThanOrEqual(
      geometry.pageWidth ?? 0,
    )
    expect(geometry.textRight).toBeLessThanOrEqual(TINY_PORTRAIT.width)
    await expect(
      screen.getByText("This version of the app is out of date."),
    ).toBeVisible()
    //cleanup: the record is persisted, and the next test in this worker must not inherit it
    await page.evaluate(() =>
      localStorage.removeItem("adaptv.ota.store-release"),
    )
  })
})

test.describe("the rotate guard at 320 px and a 200 % font", () => {
  test.use({ hasTouch: true, viewport: TINY_LANDSCAPE })

  test("keeps its prompt inside the viewport", async ({ page }) => {
    await page.goto("/lab/screens")
    await awaitClientHandover(page)
    await expect(rotateGuard(page)).toBeVisible()
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
    })
    const geometry = await rotateGuard(page).evaluate((el) => {
      const text = el.querySelector("p") as HTMLElement
      const rect = text.getBoundingClientRect()
      return {
        width: el.clientWidth,
        scrollWidth: el.scrollWidth,
        textLeft: rect.left,
        textRight: rect.right,
        textBottom: rect.bottom,
        pageScrollWidth: document.scrollingElement?.scrollWidth,
        pageWidth: document.scrollingElement?.clientWidth,
      }
    })
    console.log(
      `[stress-screens ${test.info().project.name}] guard ${JSON.stringify(geometry)}`,
    )
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width)
    expect(geometry.textLeft).toBeGreaterThanOrEqual(0)
    expect(geometry.textRight).toBeLessThanOrEqual(TINY_LANDSCAPE.width)
    expect(geometry.pageScrollWidth).toBeLessThanOrEqual(
      geometry.pageWidth ?? 0,
    )
  })
})
