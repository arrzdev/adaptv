import { act, render } from "@testing-library/react"
import { StrictMode, useRef } from "react"
import { beforeAll, describe, expect, it } from "vitest"
import { useAnimatedStyle } from "#adaptv/hooks/use-animated-style"
import { useAppInfo } from "#adaptv/hooks/use-app-info"
import {
  useAppState,
  useOnPause,
  useOnResume,
} from "#adaptv/hooks/use-app-state"
import { useBackHandler } from "#adaptv/hooks/use-back-handler"
import { useBattery } from "#adaptv/hooks/use-battery"
import { useChromeTint } from "#adaptv/hooks/use-chrome-tint"
import { useClipboard } from "#adaptv/hooks/use-clipboard"
import { useCompose } from "#adaptv/hooks/use-compose"
import { useDevice } from "#adaptv/hooks/use-device"
import { useGeolocation } from "#adaptv/hooks/use-geolocation"
import { useHapticTick } from "#adaptv/hooks/use-haptic-tick"
import { useHaptics } from "#adaptv/hooks/use-haptics"
import { useInsets } from "#adaptv/hooks/use-insets"
import { useIsOffline } from "#adaptv/hooks/use-is-offline"
import { useKeepAwake } from "#adaptv/hooks/use-keep-awake"
import { useLocale } from "#adaptv/hooks/use-locale"
import { useMediaQuery } from "#adaptv/hooks/use-media-query"
import { useMotion } from "#adaptv/hooks/use-motion"
import { useNotificationOpened } from "#adaptv/hooks/use-notification-opened"
import { useNotifications } from "#adaptv/hooks/use-notifications"
import { useOrientation } from "#adaptv/hooks/use-orientation"
import { usePrint } from "#adaptv/hooks/use-print"
import { usePrivacyScreen } from "#adaptv/hooks/use-privacy-screen"
import { useReducedMotion } from "#adaptv/hooks/use-reduced-motion"
import { useScreenReader } from "#adaptv/hooks/use-screen-reader"
import { useScrollEdgeFade } from "#adaptv/hooks/use-scroll-edge-fade"
import { useServiceWorkerMessage } from "#adaptv/hooks/use-service-worker-message"
import { useServiceWorkerUpdate } from "#adaptv/hooks/use-service-worker-update"
import { useShare } from "#adaptv/hooks/use-share"
import { useSpeech } from "#adaptv/hooks/use-speech"
import { useStatusBar } from "#adaptv/hooks/use-status-bar"
import { useSyncTheme } from "#adaptv/hooks/use-sync-theme"
import { useTheme } from "#adaptv/hooks/use-theme"
import { useVibrate } from "#adaptv/hooks/use-vibrate"

/*
 * Every hook, mounted and unmounted 300 times under StrictMode, with the
 * document's listeners, timers and observers counted from outside.
 *
 * What this pins that the per-hook suites cannot: a hook whose own test mounts
 * it once passes with an effect that subscribes and never unsubscribes, or that
 * unsubscribes a handle other than the one it took, or that keeps a timer alive
 * — the leak only shows up as growth, and only across many cycles. StrictMode
 * is the second half: React 19's dev double-invocation runs every effect
 * mount → cleanup → mount, so a cleanup that undoes less than its setup did
 * leaves one extra subscription per cycle, invisible in a single render.
 *
 * The counts are read through patched `EventTarget.prototype` methods, timer
 * globals and `MutationObserver` — a census, not a mock: the hooks run their
 * real code against happy-dom, and the census only records who is still
 * attached. The budget is exactly what the accessor pairs document as process
 * singletons, listed by name in {@link SINGLETONS}, so a new permanent listener
 * has to be written down here to pass.
 *
 * What a green run does NOT cover: the hooks whose capability finds no platform
 * under happy-dom and returns before attaching anything — battery, geolocation,
 * keep-awake (no `navigator.wakeLock`), speech, the service-worker pair. Their
 * effects run, but there is nothing for the census to see; their subscribe and
 * unsubscribe paths are exercised only in a browser, and by their own suites
 * with a stubbed platform.
 */

type Listener = EventListenerOrEventListenerObject | null
type Census = Map<EventTarget, Map<string, Set<Listener>>>

const census: Census = new Map()
const pendingTimers = new Set<unknown>()
const pendingIntervals = new Set<unknown>()
const pendingFrames = new Set<number>()
const liveObservers = new Set<MutationObserver>()

function count(target: EventTarget): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [type, set] of census.get(target) ?? []) {
    if (set.size > 0) out[type] = set.size
  }
  return out
}

/**
 * The listeners the capabilities keep for the life of the process, bound by
 * the first subscriber and deliberately never removed — `app-state.ts`
 * (`visibilitychange`, `pagehide`, `pageshow`), `network.ts` (`online`,
 * `offline`) and `orientation.ts` (`orientationchange`) all say so in their
 * headers, and `use-media-query.ts` keeps one live list per distinct query
 * (three here: the two {@link Everything} asks for, and reduced motion's).
 * Anything beyond this is a leak.
 */
const SINGLETONS = {
  document: { visibilitychange: 1 },
  window: {
    pagehide: 1,
    pageshow: 1,
    online: 1,
    offline: 1,
    orientationchange: 1,
  },
  mediaLists: { change: 3 },
} as const

/**
 * The census is taken on the instances a hook can reach — `window` and
 * `document` (`navigator` is not an event target; what hangs off it, a battery
 * manager or a wake lock sentinel, is a per-page object) — and on the
 * `MediaQueryList` prototype, since the media-query registry keeps one list
 * per query. Own-property patches rather
 * than `EventTarget.prototype`: under vitest's happy-dom the global
 * `EventTarget` is not the constructor the document inherits from, so a
 * prototype patch there records nothing, which is a broken probe reading as a
 * clean tree. The premise assertion below is what catches that.
 */
function patchTarget(target: EventTarget, key: EventTarget = target) {
  const add = target.addEventListener
  const remove = target.removeEventListener
  target.addEventListener = function (
    this: EventTarget,
    type: string,
    listener: Listener,
    options?: boolean | AddEventListenerOptions,
  ) {
    let byType = census.get(key)
    if (!byType) {
      byType = new Map()
      census.set(key, byType)
    }
    let set = byType.get(type)
    if (!set) {
      set = new Set()
      byType.set(type, set)
    }
    set.add(listener)
    return add.call(this, type, listener, options)
  }
  target.removeEventListener = function (
    this: EventTarget,
    type: string,
    listener: Listener,
    options?: boolean | EventListenerOptions,
  ) {
    census.get(key)?.get(type)?.delete(listener)
    return remove.call(this, type, listener, options)
  }
}

/** One key for every MediaQueryList, whichever query it answers. */
const MEDIA_LISTS = new EventTarget()

//the patches below are never undone: vitest runs this file in its own
//isolated environment, so nothing after it sees them
beforeAll(() => {
  patchTarget(window)
  patchTarget(document)
  patchTarget(
    Object.getPrototypeOf(window.matchMedia("(min-width: 0px)")),
    MEDIA_LISTS,
  )

  const g = globalThis as unknown as Record<string, unknown>
  const setT = g.setTimeout as typeof setTimeout
  const clearT = g.clearTimeout as typeof clearTimeout
  g.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    const id = setT(
      () => {
        pendingTimers.delete(id)
        fn()
      },
      ms,
      ...rest,
    )
    pendingTimers.add(id)
    return id
  }) as typeof setTimeout
  g.clearTimeout = ((id: unknown) => {
    pendingTimers.delete(id)
    return clearT(id as number)
  }) as typeof clearTimeout
  const setI = g.setInterval as typeof setInterval
  const clearI = g.clearInterval as typeof clearInterval
  g.setInterval = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    const id = setI(fn, ms, ...rest)
    pendingIntervals.add(id)
    return id
  }) as typeof setInterval
  g.clearInterval = ((id: unknown) => {
    pendingIntervals.delete(id)
    return clearI(id as number)
  }) as typeof clearInterval
  const raf = g.requestAnimationFrame as typeof requestAnimationFrame
  const caf = g.cancelAnimationFrame as typeof cancelAnimationFrame
  g.requestAnimationFrame = ((fn: FrameRequestCallback) => {
    const id = raf((t) => {
      pendingFrames.delete(id)
      fn(t)
    })
    pendingFrames.add(id)
    return id
  }) as typeof requestAnimationFrame
  g.cancelAnimationFrame = ((id: number) => {
    pendingFrames.delete(id)
    return caf(id)
  }) as typeof cancelAnimationFrame

  const NativeObserver = MutationObserver
  g.MutationObserver = class extends NativeObserver {
    observe(target: Node, options?: MutationObserverInit) {
      liveObservers.add(this)
      return super.observe(target, options)
    }
    disconnect() {
      liveObservers.delete(this)
      return super.disconnect()
    }
  }
})

function noop() {}

/** Every hook a screen could mount at once, with the arguments it takes. */
function Everything() {
  const box = useRef<HTMLDivElement | null>(null)
  useTheme()
  useSyncTheme({ themeColorLight: "#fff", themeColorDark: "#000" })
  useStatusBar("light")
  useMediaQuery("(min-width: 1px)")
  useMediaQuery("(prefers-color-scheme: dark)")
  useReducedMotion()
  useVibrate()
  useHaptics()
  useHapticTick()
  useAppState()
  useOnResume(noop)
  useOnPause(noop)
  useIsOffline()
  useBackHandler(() => false)
  useBattery()
  useLocale()
  useDevice()
  useAppInfo()
  useClipboard()
  useShare()
  useNotifications()
  useNotificationOpened(noop)
  useKeepAwake()
  useOrientation()
  useMotion()
  useScreenReader()
  usePrivacyScreen()
  useGeolocation()
  useSpeech()
  usePrint()
  useCompose()
  useChromeTint()
  useInsets()
  useServiceWorkerUpdate()
  useServiceWorkerMessage(noop)
  useScrollEdgeFade(box, true, {
    start: true,
    end: true,
    horizontal: false,
  })
  useAnimatedStyle(box, { opacity: 1 }, { opacity: { duration: 0.001 } })
  return <div ref={box} />
}

type Snapshot = {
  document: Record<string, number>
  window: Record<string, number>
  mediaLists: Record<string, number>
  timers: number
  intervals: number
  frames: number
  observers: number
}

function snapshot(): Snapshot {
  return {
    document: count(document),
    window: count(window),
    mediaLists: count(MEDIA_LISTS),
    timers: pendingTimers.size,
    intervals: pendingIntervals.size,
    frames: pendingFrames.size,
    observers: liveObservers.size,
  }
}

/** Let every pending microtask and short timer of the cycle settle. */
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const CYCLES = 300

//300 StrictMode renders of every hook is CPU work: inside the 5s default on a CI
//runner, well past it on a loaded 2-CPU host. The budget is for the slow host; a leak
//still fails as the census assertion it breaks, not as a timeout.
const BUDGET = { timeout: 60_000 }

describe(
  "every hook, 300 mount/unmount cycles under StrictMode",
  BUDGET,
  () => {
    it("leaves nothing behind but the documented singletons, and grows nothing between cycles", async () => {
      //a hook-free render first: react-dom binds its own document listener
      //(`selectionchange`, once per document) on the first root, and that is
      //React's, not a hook's, so it belongs in the baseline
      render(
        <StrictMode>
          <div />
        </StrictMode>,
      ).unmount()
      await settle()
      const before = snapshot()

      //one cycle first: the accessor pairs bind their process singletons on the
      //first subscriber, and that one-off is what the after-cycle census must
      //be compared against, not the pristine document
      let view = render(
        <StrictMode>
          <Everything />
        </StrictMode>,
      )
      await settle()
      const mounted1 = snapshot()
      view.unmount()
      await settle()
      const after1 = snapshot()

      for (let cycle = 1; cycle < CYCLES; cycle += 1) {
        view = render(
          <StrictMode>
            <Everything />
          </StrictMode>,
        )
        if (cycle % 50 === 0) await settle()
        view.unmount()
      }
      await settle()
      const after300 = snapshot()

      //the premise: the hooks really attached things while mounted, so an empty
      //census would be a broken probe rather than a clean tree
      expect(
        Object.keys(mounted1.document).length +
          Object.keys(mounted1.window).length +
          Object.keys(mounted1.mediaLists).length,
        `the census saw nothing while mounted: ${JSON.stringify(mounted1)}`,
      ).toBeGreaterThan(4)

      //no growth: the 300th unmount leaves exactly what the 1st left
      expect(after300).toEqual(after1)

      //and what the 1st left is the documented singleton set, nothing more
      expect(after1.document).toEqual({
        ...before.document,
        ...SINGLETONS.document,
      })
      expect(after1.window).toEqual({
        ...before.window,
        ...SINGLETONS.window,
      })
      expect(after1.mediaLists).toEqual({
        ...before.mediaLists,
        ...SINGLETONS.mediaLists,
      })
      expect(after1.intervals).toBe(before.intervals)
      expect(after1.frames).toBe(before.frames)
      expect(after1.observers).toBe(before.observers)
      expect(after1.timers).toBe(before.timers)
    })
  },
)
