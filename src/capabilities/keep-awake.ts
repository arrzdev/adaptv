//Keep-awake accessor — hold the screen on. ONE implementation for all six
//targets: the W3C Screen Wake Lock API (`navigator.wakeLock`). There is no
//native branch, deliberately — there is no official `@capacitor/keep-awake`
//plugin, and pulling in a community one to duplicate an API the WebView may
//already have is a dependency the owner has to agree to, not a default.
//
//## What was verified, and what was not
//
//  • Chrome 84+, Firefox 126+, Safari 16.4+ (iOS/iPadOS included) — supported.
//  • **iOS installed PWA**: before iOS 18.4 the request RESOLVED WITH A
//    SENTINEL AND THE SCREEN STILL DIMMED (WebKit bug 254545, fixed 18.4). A
//    Home Screen Web App runs in a ViewService with no `UIApplication`, so the
//    old `idleTimerDisabled` implementation had nothing to talk to. This is the
//    worst failure shape there is — a success value that isn't one — and JS
//    cannot detect it, so it is reported through {@link getKeepAwakeCaveat}
//    rather than pretended away.
//  • **Capacitor Android WebView** — supported, and it holds the screen.
//    Measured 2026-09-02: Pixel 10 emulator API 36, Android System WebView
//    Chrome/149.0.7827.5, the playground built with `adaptv build android`,
//    driven over CDP. `navigator.wakeLock` is present, `request('screen')`
//    resolves with `released: false`. `adb shell dumpsys power` shows a
//    `SCREEN_BRIGHT_WAKE_LOCK 'WindowManager/displayId:0'` row attributed to
//    the app's package while held and no such row after `release()` — the
//    WebView maps the JS lock to the window's keep-screen-on flag. With
//    `screen_off_timeout` at 15 s: released, `mWakefulness=Asleep` after 25 s;
//    held again, `mWakefulness=Awake` after 25 s with the row at ACQ=-27s.
//    caniwebview's "unsupported" is wrong for this WebView.
//  • **Capacitor WKWebView** — the same mechanism as Safari. Measured
//    2026-09-02 on an iPhone 17 Pro simulator, iOS 26.1: present, the request
//    resolves and holds, the release drops it. A Capacitor app is a full app
//    with a `UIApplication`, so the ViewService gap above is not its gap: the
//    unified log shows the app's own UI process taking WebCore's disabler
//    (`ScreenSleepDisabler::updateState() shouldKeepScreenAwake=1` at the
//    request, `=0` at the release), and MobileSafari on the same simulator
//    logs the identical line for the same page. `isIdleTimerDisabled` read
//    over lldb while held is NO — it is WebKit's own sleep disabler (Safari's
//    since 16.4), not the idle-timer property. The simulator has no Auto-Lock
//    (no Display & Brightness row) and never idle-locks, so the lit screen
//    itself is owed to a physical iPhone — docs/roadmap/owed-device-verification.md.
//    Both runs showed the community plugin is not needed; the rule above stands.
import {
  isIOS,
  isNativePlatform,
  isOSVersionAtLeast,
} from "#adaptv/utils/platform"

/**
 * `"held"` — the screen is being kept on.
 * `"unsupported"` — no wake-lock API here; asking again cannot help.
 * `"rejected"` — the API exists but refused (low battery, power-save mode, or
 * the document was not visible), or the lock was released before the request
 * resolved; retryable once the condition clears.
 */
export type KeepAwakeOutcome = "held" | "unsupported" | "rejected"

type Sentinel = {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: "release", listener: () => void) => void
}

type WakeLockApi = {
  request: (type: "screen") => Promise<Sentinel>
}

function wakeLock(): WakeLockApi | undefined {
  if (typeof navigator === "undefined") return undefined
  return (navigator as { wakeLock?: WakeLockApi }).wakeLock
}

const listeners = new Set<() => void>()
let sentinel: Sentinel | null = null
//"the app asked for the screen to stay on" — separate from whether a sentinel
//is currently held, because the platform drops the lock on every tab switch
let wanted = false
let visibilityBound = false

function emit(): void {
  for (const cb of listeners) cb()
}

/**
 * Whether the wake-lock API exists here. Synchronous, so a "keep screen on"
 * toggle can be hidden — or shown disabled with an explanation — on the first
 * render instead of after a failed tap.
 */
export function isKeepAwakeSupported(): boolean {
  return wakeLock() !== undefined
}

/**
 * A known way this can fail *while reporting success*, or `null` when there
 * isn't one. Render it next to the toggle: this is the one platform gap the
 * return values genuinely cannot express, because the platform lies.
 *
 * The platform that lies is an installed PWA on iOS below 18.4 (WebKit 254545,
 * a Home Screen web app bug). The native app never gets a caveat: the Android
 * WebView holds the screen (dumpsys-verified 2026-09-02), and the WKWebView in
 * a Capacitor app has a `UIApplication` and takes Safari's own sleep disabler,
 * so the ViewService bug is not its bug. The native check comes first so the
 * iOS-version branch stays web-only.
 */
export function getKeepAwakeCaveat(): string | null {
  if (!isKeepAwakeSupported()) return null
  if (isNativePlatform()) return null
  //WebKit 254545: fixed in 18.4, broken (silently) in every installed PWA below
  if (isIOS() && !isOSVersionAtLeast(18, 4)) {
    return "iOS below 18.4 resolves the wake lock but still dims the screen in an installed PWA (WebKit bug 254545)."
  }
  return null
}

/** Whether a wake lock is held right now. */
export function isKeepAwakeActive(): boolean {
  return sentinel !== null && !sentinel.released
}

/** Subscribe to acquire/release transitions; returns an unsubscribe. */
export function subscribeKeepAwake(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}

async function acquire(): Promise<KeepAwakeOutcome> {
  const api = wakeLock()
  if (!api) return "unsupported"
  try {
    const next = await api.request("screen")
    //the answer outlived what asked for it: the release ran while the request
    //was in flight (StrictMode's mount → cleanup → remount does this), or a
    //second request already won. Either way this sentinel is surplus — let it
    //go, or it holds the platform lock with nothing left to release it
    if (!wanted || isKeepAwakeActive()) {
      //a refused release of a surplus sentinel is nobody's error to see
      next.release().catch(() => {})
      return wanted ? "held" : "rejected"
    }
    //the platform let the lock go before its answer arrived (the document hid
    //in between): there is nothing to hold, and the visibility re-acquire will
    //ask again, so this is the retryable outcome
    if (next.released) return "rejected"
    sentinel = next
    //the platform releases the lock itself whenever the document hides; the
    //sentinel's own event is the only notification, so mirror it into our state
    next.addEventListener("release", () => {
      if (sentinel === next) sentinel = null
      emit()
    })
    emit()
    return "held"
  } catch {
    //NotAllowedError: hidden document, power-save mode, or a battery level the
    //OS won't spend. All temporary — the caller may retry.
    return "rejected"
  }
}

function bindVisibility(): void {
  if (visibilityBound || typeof document === "undefined") return
  visibilityBound = true
  //A wake lock does NOT survive the document being hidden — switching tabs or
  //backgrounding the app drops it, and coming back does not restore it. Without
  //this, "keep the screen on" works exactly until the first notification pulls
  //the user away, which is precisely when it mattered.
  document.addEventListener("visibilitychange", () => {
    if (!wanted) return
    if (document.visibilityState !== "visible") return
    if (isKeepAwakeActive()) return
    void acquire()
  })
}

/**
 * Keep the screen on until {@link releaseKeepAwake}. Never rejects — an absent
 * API and a refused request are both values the caller has to render.
 *
 * Re-acquires automatically when the app returns to the foreground, because the
 * platform drops the lock on hide (see {@link bindVisibility}). Call it from a
 * user gesture where you can: a request made while the document is not visible
 * is refused outright.
 */
export async function requestKeepAwake(): Promise<KeepAwakeOutcome> {
  if (!isKeepAwakeSupported()) return "unsupported"
  wanted = true
  bindVisibility()
  if (isKeepAwakeActive()) return "held"
  return acquire()
}

/**
 * Let the screen sleep again. Idempotent, and safe to call when nothing is
 * held — it also clears the re-acquire intent, so a later foreground does not
 * quietly turn the lock back on.
 */
export async function releaseKeepAwake(): Promise<void> {
  wanted = false
  const held = sentinel
  sentinel = null
  if (!held || held.released) {
    emit()
    return
  }
  try {
    await held.release()
  } catch {
    //already gone (the platform released it first) — the state is what matters
  }
  emit()
}
