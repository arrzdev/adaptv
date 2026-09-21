/**
 * Animating the browser-chrome tint — `<meta name="theme-color">`, driven along a
 * `cubic-bezier` instead of snapping.
 *
 * **What it buys is a browser tab**, which is the one place a web app still looks like a web
 * page: a mobile browser's toolbar sitting above the app in a flat, unrelated colour while the
 * app itself animates. An installed PWA and a Capacitor build already render edge to edge with no
 * toolbar at all.
 *
 * There is deliberately **no platform branch** here. Writing the meta inside a WebView is inert,
 * not harmful — nothing reads it — so gating on "is this an installed app?" would buy nothing and
 * cost the one thing that gate is historically bad at: being right. adaptv has already been
 * bitten by arming behaviour off `display-mode` rather than off what the environment can actually
 * do. The tag either has an audience or it does not, and either way this code runs the same.
 *
 * ⚠︎ Three limits, all of them the platform's and none of them fixable here:
 *
 * - **iOS 26 ignores the tag entirely** (`docs/decisions/register.md` B17). WebKit dropped it and now
 *   derives each band from the fixed element touching that edge of the viewport (B33). The tag
 *   alone is therefore the **Android/Chrome + iOS ≤ 18** path; on an iOS 26 browser tab the same
 *   colour is ALSO painted onto a band donor — see {@link bandDonor} — which is the one platform
 *   branch in this file, and it exists because that element is on the page, not in the head.
 * - **Firefox has never supported it.**
 * - **The top bar only.** Android's navigation bar tracks the *device* theme and cannot be made
 *   to follow the app on web or PWA — measured across four Chrome versions in `docs/decisions/register.md` B29.
 *
 * The tag is written per frame from a `requestAnimationFrame` loop, because a meta tag is not a
 * style and no CSS transition can reach it. That is real main-thread work landing in the same
 * frames as whatever motion prompted it, so the loop does the least it can: one `Math` pass and a
 * string compare, and it skips the DOM write entirely on frames where the rounded colour has not
 * changed — over a 380ms fade between two near colours, most frames.
 */

import { THEME_COLOR_META_ID } from "#adaptv/shell/theme-init-script"
import type { Rgb } from "#adaptv/utils/color"
import { formatHex, mixRgb, parseCssColor } from "#adaptv/utils/color"
import type { EasingBezier } from "#adaptv/utils/easing"
import { easingValueAtX } from "#adaptv/utils/easing"
import { isInstalledApp, isIOS } from "#adaptv/utils/platform"

export type ChromeTintOptions = {
  /** Seconds, matching the CSS/`DrawerTransition` convention. Default `0.3`. */
  duration?: number
  /** `[x1, y1, x2, y2]`, exactly as `cubic-bezier()` takes it. Default: `ease`. */
  easing?: EasingBezier
  /**
   * Start colour. Defaults to whatever the tag currently reads, which is what makes an
   * interrupted transition resume from the colour on screen rather than jumping back.
   */
  from?: string
}

export type ChromeTintTransition = {
  /** Resolves when the tint lands, or when a later call takes the tag over. */
  finished: Promise<void>
  /** Leave the tint where it is. */
  stop: () => void
}

/** CSS's `ease`, so an option-less call matches an option-less `transition`. */
const DEFAULT_EASING: EasingBezier = [0.25, 0.1, 0.25, 1]
const DEFAULT_DURATION = 0.3
/** One frame at 60Hz — assumed until a real frame interval has been observed. */
const FALLBACK_FRAME_MS = 1000 / 60
/**
 * The longest gap still treated as a frame. Anything longer is a stall — a dropped frame, a
 * backgrounded tab — not a screen that refreshes at 30Hz, and leading by it would throw the tint
 * that far ahead of the page instead of a fraction of a frame ahead of the toolbar.
 */
const MAX_FRAME_MS = FALLBACK_FRAME_MS * 2
/** How far ahead of the curve the tint is sampled. See {@link transitionChromeTint}'s `step`. */
const LEAD_FRAMES = 0.5

const RESOLVED: ChromeTintTransition = {
  finished: Promise.resolve(),
  stop: () => {},
}

let running: { cancel: () => void } | null = null

/**
 * The tint the app's own theme wants, and whether something has taken the tag away from it.
 *
 * These two exist because "put it back" is otherwise unanswerable. A caller that captured the
 * colour before it dimmed the chrome would restore a stale one the moment the user flipped the
 * theme with the drawer still open — a real screen (a settings sheet with a light/dark switch),
 * not a contrived one. Routing `useSyncTheme` through {@link setThemeColorBase} instead lets the
 * theme keep updating underneath an override, so the restore lands on the theme that is now
 * current rather than the one that was current when the sheet opened.
 */
let base: string | null = null
let overridden = false

/**
 * Subscribers to {@link getChromeTintBase}. The base is app STATE — it moves when the theme flips,
 * and (once routes can declare a tint) when the route changes — so React has to be able to follow
 * it. The live tint deliberately has no subscription: it moves every frame while a transition is
 * in flight, and wiring a component tree to a 60fps animation value is the opposite of what this
 * module exists to make cheap. Read that one with {@link getChromeTint} when you actually want a
 * sample.
 */
const baseListeners = new Set<() => void>()

/** Subscribe to changes of the base. Returns the unsubscribe. */
export function subscribeChromeTintBase(listener: () => void): () => void {
  baseListeners.add(listener)
  return () => {
    baseListeners.delete(listener)
  }
}

/**
 * Marks the band donor: a 12px fixed strip at the top of the page whose `background-color` is
 * written in step with the meta, so an iOS 26 Safari tab shows the same tint the meta would have
 * given iOS 18.
 *
 * Why an element at all: iOS 26 Safari paints its top band from the `position: fixed` element
 * WebKit hit-tests 4px inside the top edge (`LocalFrameView::fixedContainerEdges`, B33). A
 * viewport-sized dimming layer — every drawer backdrop — is read ONCE and then latched for as
 * long as it is the element at that edge, which is why the band snapped to full dim at the start
 * of the open and hung ~140ms behind the close (`register.md` B33, 2026-09-21). A full-width strip
 * thinner than the viewport is a plain candidate instead: no latch, and every repaint of it
 * schedules a re-read, so the band follows the strip frame by frame. Measured on the iOS 26.1
 * simulator, both directions, tracking the scrim exactly.
 *
 * Why it is not visible: WebKit reads the strip's `background-color`, not its composited pixels,
 * and only skips a box under `opacity: 0.1` — so the strip is painted at 12% and nobody sees 12%
 * of the chrome colour over the first 12px of a page that is almost always that colour anyway.
 * It is `pointer-events: none` (the hit-test ignores that property on its first pass) and sits at
 * the top of the stacking order so the backdrop never covers the point WebKit samples.
 *
 * Why an iOS browser tab, and not "iOS 26": an installed web app and a Capacitor build render
 * under the status bar with no band to donate to, and Android reads the meta, so those have no
 * audience for a strip. iOS ≤ 18 reads the meta too, but it cannot be told apart: Safari 26
 * reports itself as `iPhone OS 18_7` (measured on the 26.1 simulator), so `isOSVersionAtLeast`
 * cannot see 26 and a version gate would silently switch the fix off on the one OS it is for.
 * On iOS 18 the strip is a 12px layer repainted only while the tint moves — the price of not
 * guessing.
 *
 * Why here and not in the drawer: the drawer, `useChromeTint` and a route's `chromeTint` all
 * write through this module, and the band has to agree with every one of them. One writer, two
 * outputs.
 */
const BAND_DONOR_ATTR = "data-adaptv-band-donor"

/**
 * The strip is measured against WebKit's own thresholds, not styled: taller than the 10px
 * "thin border" cut-off, wider than 90% of the viewport, and above the 0.1 opacity floor with
 * a margin for float rounding on either side.
 */
const BAND_DONOR_STYLE =
  "position:fixed;top:0;left:0;right:0;height:12px;opacity:0.12;pointer-events:none;z-index:2147483647"

let donor: HTMLElement | null = null

function wantsBandDonor(): boolean {
  return isIOS() && !isInstalledApp()
}

/** The donor, created on the first paint that has an audience; `null` everywhere else. */
function bandDonor(): HTMLElement | null {
  if (donor?.isConnected) return donor
  if (typeof document === "undefined" || !document.body) return null
  if (!wantsBandDonor()) return null
  const el = document.createElement("div")
  el.setAttribute(BAND_DONOR_ATTR, "")
  el.setAttribute("aria-hidden", "true")
  el.style.cssText = BAND_DONOR_STYLE
  document.body.appendChild(el)
  donor = el
  return el
}

function removeBandDonor(): void {
  donor?.remove()
  donor = null
}

function metaElement(): HTMLMetaElement | null {
  if (typeof document === "undefined") return null
  return document.getElementById(
    THEME_COLOR_META_ID,
  ) as HTMLMetaElement | null
}

/**
 * Whether there is a tag to write at all. NOT "whether anyone will see it" — that depends on the
 * browser and the platform and is not knowable here. Deliberately not exported at all:
 * the hook's `supported` and this module's no-op already answer it, and a third way to ask is a
 * third thing to disagree.
 */
function hasThemeColorMeta(): boolean {
  return metaElement() !== null
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false
  return (
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ===
    true
  )
}

/** The tint the chrome is showing right now, or `null` where there is no tag to read. */
export function getChromeTint(): string | null {
  return metaElement()?.content || null
}

/**
 * Put the tint at `color` immediately, cancelling any transition in flight. Use this to follow a
 * gesture, where the finger — not a clock — owns the progress.
 */
export function setChromeTint(color: string): void {
  running?.cancel()
  running = null
  overridden = true
  writeMeta(color)
}

/**
 * The one place the tint lands: the meta for the browsers that read it, the band donor for the
 * one that does not. Nothing writes either output on its own.
 */
function writeMeta(color: string) {
  const meta = metaElement()
  if (!meta) return
  meta.content = color
  const strip = bandDonor()
  if (strip) strip.style.backgroundColor = color
}

/**
 * Declare the tint the app's theme resolves to. `useSyncTheme` owns this call and is the only
 * caller that should make it: it paints immediately while the chrome is the theme's to paint, and
 * quietly re-aims the restore while something else holds the tint.
 *
 * Pass `null` when the tag goes away (theme disabled, unmount) so nothing restores into a colour
 * that no longer means anything.
 */
export function setThemeColorBase(color: string | null): void {
  const changed = base !== color
  base = color
  if (color === null) {
    overridden = false
    removeBandDonor()
  } else if (!overridden) {
    writeMeta(color)
  }
  if (changed) {
    for (const listener of baseListeners) listener()
  }
}

/** The colour {@link restoreChromeTint} would return to. Follow it with {@link subscribeChromeTintBase}. */
export function getChromeTintBase(): string | null {
  return base
}

/**
 * Hand the chrome back to the app's theme, along a curve. A no-op when nothing took it — so a
 * drawer that never dimmed the tint (an installed app) does not have to know that.
 */
export function restoreChromeTint(
  options: Omit<ChromeTintOptions, "from"> = {},
): ChromeTintTransition {
  if (!overridden || base === null) return RESOLVED
  const transition = transitionChromeTint(base, options)
  overridden = false
  return transition
}

/**
 * Walk the tint to `to` along `easing` over `duration`.
 *
 * A call while another is in flight takes over from the colour on screen, so a drawer closed
 * halfway through its own opening tints back from where it actually got to.
 *
 * Falls back to an immediate set — never a silent no-op — when the motion cannot or should not be
 * animated: reduced motion, a zero duration, or a colour on either end this cannot read (see
 * {@link parseCssColor}; a `color(display-p3 …)` lands here). It returns `RESOLVED` and writes
 * nothing at all when there is no tag.
 */
export function transitionChromeTint(
  to: string,
  options: ChromeTintOptions = {},
): ChromeTintTransition {
  if (!hasThemeColorMeta()) return RESOLVED

  overridden = true

  const {
    duration = DEFAULT_DURATION,
    easing = DEFAULT_EASING,
    from = getChromeTint() ?? undefined,
  } = options

  const target = parseCssColor(to)
  const start = from ? parseCssColor(from) : null

  if (
    !target ||
    !start ||
    duration <= 0 ||
    prefersReducedMotion() ||
    typeof requestAnimationFrame === "undefined"
  ) {
    setChromeTint(target ? formatHex(target) : to)
    return RESOLVED
  }

  running?.cancel()

  const meta = metaElement()
  if (!meta) return RESOLVED

  //bound after the guard so the frame loop closes over non-null colours
  const fromRgb: Rgb = start
  const toRgb: Rgb = target

  const ms = duration * 1000
  const startedAt = performance.now()
  let frame = 0
  let previousFrameAt = 0
  let last = meta.content
  let settle: () => void = () => {}
  const finished = new Promise<void>((resolve) => {
    settle = resolve
  })

  function write(rgb: Rgb) {
    const hex = formatHex(rgb)
    //the chrome only ever shows 8 bits per channel, so most frames of a short fade between two
    //near colours round to the tint already on the tag — skip the write and the invalidation
    if (hex === last) return
    last = hex
    writeMeta(hex)
  }

  function step(now: number) {
    //Sample the curve slightly AHEAD of now. This is the whole difference between the tint
    //reading as part of the motion and reading as a second thing chasing it.
    //
    //Page pixels are composited by the renderer; the toolbar is painted by the BROWSER process,
    //which only learns about the tag an IPC hop later. So a meta written during frame N shows up
    //part-way through the next one, while a compositor-driven `opacity` on the same curve is
    //already correct in frame N.
    //
    //Measured on an iOS 18 simulator against the drawer's own scrim — 60fps capture, both
    //surfaces sampled from the SAME video frames, three runs per setting, offsets read in the
    //time domain over the steep part of the open:
    //
    //    lead        median offset (+ = toolbar trails)
    //    none        +13.9  +16.0  +11.0 ms
    //    half frame   +1.3   -5.0   -0.1 ms
    //    full frame  -10.0   -2.8  -13.0 ms
    //
    //Half a frame, not a whole one: the toolbar's paint lands somewhere INSIDE the frame after
    //the write, not at the end of it, so leading by a full frame overshoots into visibly running
    //ahead of the scrim. Do not "round it up" — a full frame was tried and it is worse.
    //
    //The lead is a fraction of the last frame's MEASURED interval rather than of a hardcoded
    //16.7ms, so a 120Hz screen leads by its own 4.2ms instead of by double — capped, because a
    //long gap is a stall rather than a refresh rate (see MAX_FRAME_MS).
    const interval = previousFrameAt
      ? Math.min(now - previousFrameAt, MAX_FRAME_MS)
      : FALLBACK_FRAME_MS
    previousFrameAt = now
    const elapsed = (now - startedAt + interval * LEAD_FRAMES) / ms
    if (elapsed >= 1) {
      write(toRgb)
      running = null
      settle()
      return
    }
    write(mixRgb(fromRgb, toRgb, easingValueAtX(elapsed, easing)))
    frame = requestAnimationFrame(step)
  }

  frame = requestAnimationFrame(step)

  const handle = {
    cancel() {
      cancelAnimationFrame(frame)
      settle()
    },
  }
  running = handle

  return {
    finished,
    stop() {
      if (running !== handle) return
      running = null
      handle.cancel()
    },
  }
}
