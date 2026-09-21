import type { ComponentPropsWithRef, CSSProperties } from "react"
import { useEffect, useRef } from "react"
import { useMergedRef } from "#adaptv/hooks/use-merged-ref"
import { mergeStyles } from "#adaptv/utils/styles"

/**
 * Props for {@link Spinner}. Native `<span>` props pass through, except the exposure
 * attributes and `children`: how a spinner reaches assistive technology is `label`,
 * and what it draws is its own.
 */
export interface SpinnerProps
  extends Omit<
    ComponentPropsWithRef<"span">,
    "children" | "role" | "aria-label" | "aria-labelledby" | "aria-hidden"
  > {
  /**
   * What is loading, for a spinner that says so on its own ("Loading tasks"). Present →
   * `role="progressbar"` + `aria-label`, and the label is announced ONCE through one
   * shared polite live region (below). Absent (or blank) → `aria-hidden="true"`: the
   * spinner is decoration, and the control or the text beside it carries the state.
   *
   * ⚠︎ Inside a busy `<button>`, leave the spinner unlabelled and put the state on the
   * BUTTON (`aria-busy`, its own name) — a button's children are presentational, so a
   * role inside it is not exposed.
   */
  label?: string
}

/** The presence attribute the shared observer writes while the spinner is off screen. */
const SPINNER_OFFSCREEN_ATTRIBUTE = "data-spinner-offscreen"

/**
 * How long a label waits before it is announced. Long enough that the shared live
 * region, created on the first labelled mount, is already in the accessibility tree
 * when its text changes — a region that appears WITH its text is not reliably read —
 * and that a load finishing sooner than this is never announced at all.
 */
const SPINNER_ANNOUNCE_DELAY_MS = 150

/**
 * How long an announced label stays in the live region before it is removed. The node
 * has to outlive the reader picking it up; react-aria's live announcer uses 7 s.
 */
const SPINNER_ANNOUNCE_CLEAR_MS = 7000

//BASE: the box is the size of the text around it, like Icon — `w-[1em] h-[1em]`
//rather than `size-[1em]` for the same tailwind-merge reason Icon documents (a later
//`size-*` replaces `w-*`/`h-*`, not the other way round). `inline-block`, never
//`inline`: a CSS transform does not apply to a non-replaced inline box, so an
//`inline` spinner would simply not turn. The baseline nudge seats it in a line of
//text the way icon fonts do.
const SPINNER_BASE_CLASS =
  "inline-block h-[1em] w-[1em] shrink-0 align-[-0.125em]"
//LOCKED: nothing on the class tier. The motion, its pause and its reduced-motion
//form are CSS on `data-adaptv` (styles/spinner.css) — styling.md §2's escape hatch —
//so there is no class a consumer's className could strand.
const SPINNER_LOCKED_CLASS = undefined
//The shared announcer is visually hidden with Tailwind's own recipe, as
//PullToRefresh's and Skeleton's status lines are.
const SPINNER_ANNOUNCER_CLASS = "sr-only"

/* =============================================================================
 * Q1 — one IntersectionObserver for every indicator on the page
 * ============================================================================= */

let offscreenObserver: IntersectionObserver | null = null

/** The presence attribute each observed node is stamped with — its component's own. */
const offscreenAttributes = new WeakMap<Element, string>()

/**
 * Observe `el` and stamp `attribute` while it is not on screen. The attribute is
 * written straight to the node — no React state, so a hundred spinners scrolling in
 * and out re-render nothing — and styles/spinner.css turns it into
 * `animation-play-state: paused`. Spinner and an indeterminate ProgressBar share the
 * one observer; each keeps its own attribute name (styling.md §3.1: namespaced per
 * component).
 */
function observeOffscreen(el: Element, attribute: string): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {}
  offscreenAttributes.set(el, attribute)
  offscreenObserver ??= new IntersectionObserver((entries) => {
    //entries arrive in time order, so the last one for a target is its state now
    for (const entry of entries) {
      const stamp = offscreenAttributes.get(entry.target)
      //a record queued before the node stopped being watched has nothing to stamp
      if (stamp) entry.target.toggleAttribute(stamp, !entry.isIntersecting)
    }
  })
  offscreenObserver.observe(el)
  return () => {
    offscreenObserver?.unobserve(el)
    offscreenAttributes.delete(el)
    el.removeAttribute(attribute)
  }
}

/* =============================================================================
 * Announcement — once per loading episode, not per instance, not per render
 * ============================================================================= */

/**
 * Labelled indicators mounted right now — spinners and progress bars alike — per label,
 * and the episode they belong to. An episode starts when a label's count goes from 0 to
 * 1 and ends when it returns to 0; its object identity is what a pending announcement
 * checks it still belongs to. A Spinner and a ProgressBar saying the same thing are one
 * loading episode, so they share the count.
 */
const mountedLabels = new Map<string, { count: number; episode: object }>()
let announcer: HTMLElement | null = null

function ensureAnnouncer(): HTMLElement {
  if (announcer?.isConnected) return announcer
  const region = document.createElement("div")
  region.setAttribute("data-adaptv", "spinner-announcer")
  //role=status is polite by definition; the explicit aria-live is for the reader
  //pairings that only honour the attribute
  region.setAttribute("role", "status")
  region.setAttribute("aria-live", "polite")
  region.className = SPINNER_ANNOUNCER_CLASS
  document.body.appendChild(region)
  announcer = region
  return region
}

/**
 * Say `label` if the episode that scheduled this is still the one mounted. Each
 * episode has its own timer and flushes only itself: a label that started later waits
 * its own delay, and one that ended inside it — even if the same label has since
 * started again — was a flash with nothing to say.
 */
function announceEpisode(label: string, episode: object) {
  if (mountedLabels.get(label)?.episode !== episode) return
  const line = document.createElement("div")
  line.textContent = label
  ensureAnnouncer().appendChild(line)
  setTimeout(() => line.remove(), SPINNER_ANNOUNCE_CLEAR_MS)
}

/**
 * Register a mounted labelled indicator. The label is announced when its count goes from
 * 0 to 1 and stays up for the delay — a list of twenty "Loading" spinners, a re-render,
 * or StrictMode's second effect pass is one announcement; a later episode, after every
 * spinner with that label unmounted, is a new one.
 */
function holdLabel(label: string): () => void {
  const held = mountedLabels.get(label)
  if (held) held.count += 1
  else {
    const episode = {}
    mountedLabels.set(label, { count: 1, episode })
    //created now, written later: the region must exist before its text changes
    ensureAnnouncer()
    setTimeout(
      () => announceEpisode(label, episode),
      SPINNER_ANNOUNCE_DELAY_MS,
    )
  }
  return () => {
    const current = mountedLabels.get(label)
    if (!current) return
    current.count -= 1
    if (current.count === 0) mountedLabels.delete(label)
  }
}

/**
 * An indeterminate activity indicator that sits in a line of text: it idles off
 * screen, it is found and announced once by a screen reader, and its motion stays in
 * the form a compositor runs.
 *
 * ```tsx
 * <Text>Syncing <Spinner /></Text>                       // decorative, 1em
 * <Spinner label="Loading tasks" className="size-8" />   // says so, once
 * <Button aria-busy disabled><Spinner /> Saving</Button> // the button carries it
 * ```
 *
 * ## The quirks it owns (`docs/research/component-surface.md §8.1`)
 *
 * **1. An off-screen spinner keeps the page from idling.** A running infinite
 * animation is work every frame whether or not anyone can see it; a list with a
 * spinner per row pays it for every row below the fold. Each spinner is watched by ONE
 * shared `IntersectionObserver`, which stamps `data-spinner-offscreen` while it is out
 * of the viewport, and the stylesheet pauses it there. `IntersectionObserver` rather
 * than `content-visibility: auto`: that property only skips an element's CONTENTS (the
 * animation here is on the element itself), and it is Safari 18+, below adaptv's
 * iOS 15 floor, so it could only ever be a second mechanism beside this one. A spinner
 * under a `display: none` ancestor has no animation at all — the engine cancels CSS
 * animations without a box.
 *
 * **2. Some spinner motions stall on a busy main thread.** Chromium keeps a narrow list
 * of SVG animations off the compositor (`compositor_animations.cc`): SMIL, animating a
 * shape INSIDE the drawing, the individual `rotate`/`scale`/`translate` properties, and
 * `stroke-dasharray` — the Material arc Ionic and Quasar animate. Those freeze exactly
 * while the app is busy. A `transform` keyframe on the outer `<svg>` is NOT on that
 * list: on the lab page, that shape (Tailwind's `animate-spin` on an icon) traced
 * compositeFailed 0, the same as this span, while `rotate:` on the same svg traced
 * 524288. So the wrapper does not rescue `animate-spin`; it guards against the forms
 * that do fall back. The motion is one `transform` keyframe on the HTML `<span>` and
 * the drawn arc is static, so restyling the drawing cannot introduce them, and the box
 * turns around its centre (a shape inside an svg turns around `0 0`).
 *
 * **3. Screen readers hear it once.** A labelled spinner is `role="progressbar"` with
 * no value (indeterminate, per ARIA) and its label, so it is found in the reading
 * order; and its label is announced through ONE document-level polite live region,
 * once per loading episode — twenty spinners with the same label mounting together,
 * or one re-rendering, is one announcement. A per-instance `role="status"` would be
 * silent on mount (a live region is read when its text CHANGES) and, where it did
 * speak, would speak once per instance. Unlabelled, it is `aria-hidden`.
 *
 * **Reduced motion does not stop it.** An indicator that stops says "done", which is
 * the wrong thing to tell anyone. Under `prefers-reduced-motion: reduce` the box stops
 * turning and its `<svg>` pulses its opacity: nothing moves across the screen, and it
 * still reads as busy. The pulse is on the child because an animation outranks every
 * normal declaration — on the box it would override an `opacity-50` in `className`;
 * on the child the two multiply. Answered by the stylesheet, so the first paint is
 * already right (a hook is `false` during SSR and hydration).
 *
 * **Forced colors:** the arc is `stroke="currentColor"`, and forced colors rewrite
 * `color`, so it paints in the system text colour of whatever it sits in.
 *
 * | Tier | Classes | Why |
 * |------|---------|-----|
 * | base | `inline-block h-[1em] w-[1em] shrink-0 align-[-0.125em]` | text-sized, and a box a transform applies to |
 * | className | yours | size (`size-8`), colour (`text-primary`) |
 * | locked | — | the motion is CSS on the identity attribute, not a class |
 *
 * ⚠︎ `inline` (or `contents`) in `className` stops the rotation: a transform does not
 * apply to an inline box.
 *
 * ⚠︎ ANY `animate-*` in `className` replaces the turn, not only `animate-none`:
 * `utilities` is a later layer than adaptv's, and its `animation` shorthand also resets
 * the play state, so the off-screen pause no longer holds for that spinner. Under
 * reduced motion the pulse is on the svg, so `animate-none` on the box does not stop
 * it — `[&>svg]:animate-none` does.
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="spinner"` | always |
 * | `data-spinner-offscreen` | while out of the viewport (written by the observer) |
 */
export function Spinner({
  label,
  className,
  style,
  ref,
  ...props
}: SpinnerProps) {
  const merged = mergeStyles({
    base: SPINNER_BASE_CLASS,
    className,
    locked: SPINNER_LOCKED_CLASS,
    style,
  })

  //a blank label names nothing: it would be a progressbar announced with no name
  const name = label?.trim() || undefined

  const node = useRef<HTMLSpanElement | null>(null)
  const setRef = useMergedRef(node, ref ?? null)

  useEffect(() => {
    const el = node.current
    if (!el) return
    return observeOffscreen(el, SPINNER_OFFSCREEN_ATTRIBUTE)
  }, [])

  useEffect(() => {
    if (name === undefined) return
    return holdLabel(name)
  }, [name])

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label is only ever set together with role="progressbar", which the static check cannot see through the conditional
    <span
      {...props}
      ref={setRef}
      className={merged.className}
      style={merged.style}
      data-adaptv="spinner"
      role={name ? "progressbar" : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : "true"}
    >
      {/* Static: the span turns, and the drawing only pulses under reduced motion.
          No shape inside it animates, and there is no SMIL and no dash animation. */}
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
        strokeLinecap="round"
        className="block h-full w-full"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="10" opacity={0.25} />
        <path d="M12 2a10 10 0 0 1 10 10" />
      </svg>
    </span>
  )
}

Spinner.displayName = "Spinner"

/* =============================================================================
 * ProgressBar — the same module, because it owns the same engine facts
 * ============================================================================= */

/**
 * Props for {@link ProgressBar}. Native `<span>` props pass through, except the
 * exposure attributes and `children`: how a bar reaches assistive technology is `label`
 * and `value`, and what it draws is its own.
 */
export interface ProgressBarProps
  extends Omit<
    ComponentPropsWithRef<"span">,
    | "children"
    | "role"
    | "aria-label"
    | "aria-labelledby"
    | "aria-hidden"
    | "aria-valuenow"
    | "aria-valuemin"
    | "aria-valuemax"
    | "aria-valuetext"
  > {
  /**
   * How much is done, from `0` to `1`; clamped to that range. Omitted → indeterminate:
   * a sweep that says "working" without saying how far. A value that is not a finite
   * number (`NaN`, `Infinity` — `loaded / total` while the total is still `0`) is
   * indeterminate too: the amount is unknown, and drawing it as 0 % or 100 % would
   * claim a state nobody knows.
   */
  value?: number
  /**
   * What is progressing ("Uploading photo"). Present → `role="progressbar"` +
   * `aria-label`, plus `aria-valuenow` (a percentage) when determinate, and the label
   * is announced ONCE through Spinner's shared live region — the value never is.
   * Absent (or blank) → `aria-hidden="true"`, exactly like an unlabelled Spinner: the
   * bar is decoration and the text beside it carries the state, so a determinate value
   * reaches assistive technology only with a label.
   */
  label?: string
}

/** The presence attribute the shared observer writes while an indeterminate bar is off screen. */
const PROGRESS_BAR_OFFSCREEN_ATTRIBUTE = "data-progress-bar-offscreen"

//BASE: a full-width, 4px, rounded track in the text colour — the height, the radius
//and the colour (`text-primary`) are the consumer's.
const PROGRESS_BAR_BASE_CLASS = "block h-1 w-full rounded-full"
//LOCKED: the track and the indicator are absolutely positioned children, and the
//indeterminate sweep travels outside the box on both ends — `overflow-visible` or
//`static` in className would draw it across the page.
const PROGRESS_BAR_LOCKED_CLASS = "relative overflow-hidden"

/** `value` as a fraction in [0, 1], or `undefined` when there is no known amount. */
function progressOf(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined
  return Math.min(1, Math.max(0, value))
}

/**
 * A progress bar: determinate (`value` 0–1) or indeterminate (no `value`). It lives
 * beside {@link Spinner} because the indeterminate bar is the same problem drawn
 * differently, and it reuses Spinner's machinery rather than a copy of it.
 *
 * ```tsx
 * <ProgressBar value={loaded / total} label="Uploading photo" />
 * <ProgressBar label="Loading tasks" className="h-2 text-primary" />
 * <ProgressBar className="fixed inset-x-0 top-0" />   // decorative page loader
 * ```
 *
 * ## The quirks it owns
 *
 * **1. An off-screen indeterminate bar keeps the page from idling** — Spinner's quirk
 * 1, answered by the same shared `IntersectionObserver`, which stamps
 * `data-progress-bar-offscreen`; the stylesheet pauses the sweep there. A determinate
 * bar is not observed: at rest it has no animation to pause.
 *
 * **2. The motion is `transform`, never `width` or `left`.** The fill is
 * `scaleX(value)` and the sweep is `translateX`, so neither lays out a frame and both
 * run on the compositor (docs/decisions/animation.md A3). A value change is a 200 ms
 * `transform` transition.
 *
 * **3. Forced colors erase a CSS bar.** A bar drawn with `background-color` is
 * repainted in the system background under forced colors, so the fill would vanish
 * (Spinner is a stroke and never had this problem). The indicator opts out of that
 * repaint and paints `CanvasText`, the system text colour, and the box gets an outline
 * so the empty part of the track still reads.
 *
 * **4. RTL fills from the right.** `scaleX` grows from `transform-origin` and the sweep
 * is `translateX`, and neither has a logical form, so the parts are placed physically
 * and one selector decides direction for all of them: a `dir="rtl"` attribute on the
 * bar or any ancestor. Under it the fill grows from the right and the sweep travels
 * leftwards; the fill and the sweep always agree, and the sweep always enters and
 * leaves off the track.
 * ⚠︎ A `dir="ltr"` island inside an RTL page still draws RTL, and CSS `direction: rtl`
 * with no `dir` attribute draws LTR — the ancestor rule scroll-fade.css uses.
 * `:dir()` would follow the element's own direction, but it is above the iOS 15 floor.
 *
 * **Reduced motion, as Spinner:** an indeterminate bar never stops (a still bar reads
 * as stalled). The sweep ends, the indicator spans the track, and it pulses its opacity
 * with Spinner's own keyframes — on the child, so a consumer's opacity on the box still
 * applies. A determinate bar jumps to its value instead of easing.
 *
 * **Not `<progress>`:** its fill is `::-webkit-progress-value` / `::-moz-progress-bar`,
 * a pseudo-element no transform or transition reaches the same way on every engine,
 * its indeterminate look is the engine's own, and it cannot be decorative.
 *
 * | Tier | Classes | Why |
 * |------|---------|-----|
 * | base | `block h-1 w-full rounded-full` | the look — height, radius, colour are yours |
 * | className | yours | `h-2`, `text-primary`, `rounded-none` |
 * | locked | `relative overflow-hidden` | positioned parts; the sweep must be clipped |
 *
 * | Attribute | When |
 * |-----------|------|
 * | `data-adaptv="progress-bar"` | always |
 * | `data-progress-bar-indeterminate` | no known value |
 * | `data-progress-bar-offscreen` | indeterminate and out of the viewport (written by the observer) |
 * | `data-part="track"` / `data-part="indicator"` | the two children |
 * | `--progress-value` | the clamped fraction, determinate only |
 */
export function ProgressBar({
  value,
  label,
  className,
  style,
  ref,
  ...props
}: ProgressBarProps) {
  const progress = progressOf(value)
  const indeterminate = progress === undefined

  const merged = mergeStyles({
    base: PROGRESS_BAR_BASE_CLASS,
    className,
    locked: PROGRESS_BAR_LOCKED_CLASS,
    style,
    //the fill reads it; locked so a consumer `style` cannot desynchronise the bar
    //from its own aria-valuenow
    lockedStyle: indeterminate
      ? undefined
      : ({ "--progress-value": progress } as CSSProperties),
  })

  //a blank label names nothing, as for Spinner
  const name = label?.trim() || undefined
  const percent =
    name !== undefined && progress !== undefined
      ? Math.round(progress * 100)
      : undefined

  const node = useRef<HTMLSpanElement | null>(null)
  const setRef = useMergedRef(node, ref ?? null)

  useEffect(() => {
    if (!indeterminate) return
    const el = node.current
    if (!el) return
    return observeOffscreen(el, PROGRESS_BAR_OFFSCREEN_ATTRIBUTE)
  }, [indeterminate])

  useEffect(() => {
    if (name === undefined) return
    return holdLabel(name)
  }, [name])

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-label and the values are only ever set together with role="progressbar", which the static check cannot see through the conditional
    <span
      {...props}
      ref={setRef}
      className={merged.className}
      style={merged.style}
      data-adaptv="progress-bar"
      data-progress-bar-indeterminate={indeterminate ? "" : undefined}
      role={name ? "progressbar" : undefined}
      aria-label={name}
      aria-hidden={name ? undefined : "true"}
      aria-valuemin={percent === undefined ? undefined : 0}
      aria-valuemax={percent === undefined ? undefined : 100}
      aria-valuenow={percent}
    >
      {/* A progressbar's children are presentational: both parts are drawing only,
          styled from styles/spinner.css on data-part. */}
      <span data-part="track" />
      <span data-part="indicator" />
    </span>
  )
}

ProgressBar.displayName = "ProgressBar"
