import type { Page } from "@playwright/test"
import { expect, test } from "@playwright/test"
import { awaitClientHandover } from "./support/hydrated"

/*
 * The hooks under navigation churn — every capability lab page mounted and
 * unmounted thirty times by client-side navigation, with the document's
 * listeners and timers counted from outside.
 *
 * `src/hooks/hooks-stress.test.tsx` runs every hook through 300 StrictMode
 * mount/unmount cycles against happy-dom. What only a browser can add is the real
 * engine's event targets, the router's own mount/unmount of a route's tree, and a
 * heap that can be measured. The census is an init script that wraps
 * `addEventListener` / `removeEventListener` on the `EventTarget` prototype —
 * which `window` and `document` inherit from in both engines — and the interval
 * timers; the premise that it records anything is asserted while the locale page
 * is mounted, the one page whose capability binds and unbinds a window listener
 * with its subscribers. A cycle is `router.navigate` there and back: no document load, which
 * an init-script load counter proves.
 *
 * The contract is the one the unit test pins: what the thirtieth departure
 * leaves on `window` and `document` is exactly what the first left — the
 * capabilities' documented process singletons and nothing more — and no interval
 * survives a page it was started on. On Chromium the JS heap is collected through
 * CDP and read before and after; the growth bound is loose on purpose, a leak
 * of one listener closure per cycle is caught by the census, not the heap.
 *
 * WebKit rate-limits `history.pushState` to 100 calls per 10 s and throws a
 * SecurityError past that, which the router surfaces as a rejected navigation
 * (seen as "Attempt to use history.pushState() more than 100 times per 10
 * seconds" at 330 navigations in 4 s). No user reaches that rate; the churn
 * here is paced under it on WebKit, and unpaced on Chromium.
 */

//just under WebKit's 100 pushState calls per 10 s
const WEBKIT_NAVIGATION_GAP_MS = 105

type Census = {
  window: Record<string, number>
  document: Record<string, number>
  intervals: number
  loads: number
}

declare global {
  interface Window {
    __census?: () => Census
  }
}

function installCensus() {
  const loads =
    Number(sessionStorage.getItem("stress:hook-loads") ?? "0") + 1
  sessionStorage.setItem("stress:hook-loads", String(loads))

  type Listener = EventListenerOrEventListenerObject | null
  const live = new Map<EventTarget, Map<string, Set<Listener>>>()
  const proto = EventTarget.prototype
  const add = proto.addEventListener
  const remove = proto.removeEventListener
  proto.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: Listener,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (this === window || this === document) {
      let byType = live.get(this)
      if (!byType) {
        byType = new Map()
        live.set(this, byType)
      }
      let set = byType.get(type)
      if (!set) {
        set = new Set()
        byType.set(type, set)
      }
      set.add(listener)
    }
    return add.call(this, type, listener, options)
  }
  proto.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: Listener,
    options?: boolean | EventListenerOptions,
  ) {
    live.get(this)?.get(type)?.delete(listener)
    return remove.call(this, type, listener, options)
  }

  const intervals = new Set<unknown>()
  const setI = window.setInterval
  const clearI = window.clearInterval
  window.setInterval = ((
    handler: TimerHandler,
    ms?: number,
    ...rest: unknown[]
  ) => {
    const id = setI(handler, ms, ...rest)
    intervals.add(id)
    return id
  }) as typeof window.setInterval
  window.clearInterval = ((id: unknown) => {
    intervals.delete(id)
    return clearI(id as number)
  }) as typeof window.clearInterval

  const count = (target: EventTarget) => {
    const out: Record<string, number> = {}
    for (const [type, set] of live.get(target) ?? []) {
      if (set.size > 0) out[type] = set.size
    }
    return out
  }
  window.__census = () => ({
    window: count(window),
    document: count(document),
    intervals: intervals.size,
    loads,
  })
}

const census = (page: Page) =>
  page.evaluate(() => {
    if (!window.__census) throw new Error("the census is not installed")
    return window.__census()
  })

/** Navigate through the app's router — the same call a `<Link>` makes. */
const navigate = (page: Page, to: string, gapMs: number) =>
  page.evaluate(
    async ([to, gapMs]) => {
      const router = (
        window as {
          __TSR_ROUTER__?: {
            navigate: (options: { to: string }) => Promise<void>
          }
        }
      ).__TSR_ROUTER__
      if (!router) throw new Error("the router seam is not installed")
      await router.navigate({ to })
      if (location.pathname !== to) {
        throw new Error(
          `navigation did not land on ${to}: ${location.pathname}`,
        )
      }
      if (gapMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, gapMs))
      }
    },
    [to, gapMs] as const,
  )

/** Let React paint the route the navigation mounted, then read once. */
async function settled(page: Page) {
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        setTimeout(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  )
  return census(page)
}

const PAGES = [
  "/lab/hooks",
  "/lab/app-state",
  "/lab/network",
  "/lab/locale",
  "/lab/back-chain",
  "/lab/clipboard",
  "/lab/share",
  "/lab/keep-awake",
  "/lab/orientation",
  "/lab/device",
]

const CYCLES = 30

test.describe("Hooks under navigation churn", () => {
  test("thirty round trips through every capability page leave the document as the first one did", async ({
    page,
    browserName,
  }) => {
    const gapMs = browserName === "webkit" ? WEBKIT_NAVIGATION_GAP_MS : 0
    //330 paced navigations are 35 s on WebKit
    if (gapMs > 0) test.setTimeout(120_000)
    await page.addInitScript(installCensus)
    await page.goto("/lab")
    await awaitClientHandover(page)

    const errors: string[] = []
    page.on("pageerror", (error) => errors.push(error.message))

    const cdp =
      browserName === "chromium"
        ? await page.context().newCDPSession(page)
        : null
    const heap = async () => {
      if (!cdp) return 0
      await cdp.send("HeapProfiler.collectGarbage")
      return page.evaluate(
        () =>
          (performance as { memory?: { usedJSHeapSize: number } }).memory
            ?.usedJSHeapSize ?? 0,
      )
    }

    //one cycle first: the capabilities bind their process singletons on the
    //first subscriber, and that is the baseline the last cycle is held to
    for (const to of PAGES) await navigate(page, to, gapMs)
    await navigate(page, "/lab", gapMs)
    const first = await settled(page)
    //the premise: the census sees the app's own listeners while a page is up.
    //Most capabilities bind a process singleton on the first subscriber and
    //keep it, so a mounted page adds nothing the baseline lacks; locale is the
    //one that binds `languagechange` on the first subscriber and unbinds on
    //the last, so its page is one window listener the index page never has
    await navigate(page, "/lab/locale", gapMs)
    const mounted = await settled(page)
    expect(
      mounted.window.languagechange,
      `the census saw no languagechange listener while /lab/locale was mounted: ${JSON.stringify(mounted.window)}`,
    ).toBe(1)
    expect(first.window.languagechange).toBeUndefined()
    await navigate(page, "/lab", gapMs)
    const heapFirst = await heap()

    for (let cycle = 1; cycle < CYCLES; cycle += 1) {
      for (const to of PAGES) await navigate(page, to, gapMs)
      await navigate(page, "/lab", gapMs)
    }
    const last = await settled(page)
    const heapLast = await heap()

    //the census lives per document: a reload in the churn would compare two
    //documents. The baseline count is whatever the boot left (a cold dev
    //server has reloaded a WebKit document once), the churn adds none
    expect(last.loads, "no document load in the churn").toBe(first.loads)
    expect(last.window).toEqual(first.window)
    expect(last.document).toEqual(first.document)
    expect(last.intervals).toBe(first.intervals)
    expect(errors).toEqual([])
    if (cdp) {
      const growth = heapLast - heapFirst
      test.info().annotations.push({
        type: "heap",
        description: `${(heapFirst / 1e6).toFixed(1)} MB → ${(heapLast / 1e6).toFixed(1)} MB over ${CYCLES - 1} cycles`,
      })
      expect(growth, "heap growth over the churn").toBeLessThan(8_000_000)
    }
  })
})
