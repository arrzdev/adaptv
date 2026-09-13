import type { ComponentPropsWithRef } from "react"
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
 * Q1 — one IntersectionObserver for every spinner on the page
 * ============================================================================= */

let offscreenObserver: IntersectionObserver | null = null

/**
 * Observe `el` and stamp {@link SPINNER_OFFSCREEN_ATTRIBUTE} while it is not on screen.
 * The attribute is written straight to the node — no React state, so a hundred
 * spinners scrolling in and out re-render nothing — and styles/spinner.css turns it
 * into `animation-play-state: paused`.
 */
function observeOffscreen(el: Element): () => void {
  if (typeof IntersectionObserver === "undefined") return () => {}
  offscreenObserver ??= new IntersectionObserver((entries) => {
    //entries arrive in time order, so the last one for a target is its state now
    for (const entry of entries) {
      entry.target.toggleAttribute(
        SPINNER_OFFSCREEN_ATTRIBUTE,
        !entry.isIntersecting,
      )
    }
  })
  offscreenObserver.observe(el)
  return () => {
    offscreenObserver?.unobserve(el)
    el.removeAttribute(SPINNER_OFFSCREEN_ATTRIBUTE)
  }
}

/* =============================================================================
 * Announcement — once per loading episode, not per instance, not per render
 * ============================================================================= */

/**
 * Labelled spinners mounted right now, per label, and the episode they belong to. An
 * episode starts when a label's count goes from 0 to 1 and ends when it returns to 0;
 * its object identity is what a pending announcement checks it still belongs to.
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
 * Register a mounted labelled spinner. The label is announced when its count goes from
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
 * An indeterminate activity indicator that sits in a line of text, and the three
 * things a hand-rolled `<svg className="animate-spin">` gets wrong.
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
 * **2. Only some spinner animations survive a busy main thread, and SVG is where they
 * don't.** Chromium composites an animation on an SVG element only in narrow cases: not
 * with SMIL, not inside a resource container, not on an `<svg>` with a `viewBox`
 * transform, not for the individual `rotate`/`scale`/`translate` properties — and never
 * `stroke-dasharray`, which is what the Material arc in Ionic and Quasar animates. Those
 * spinners freeze exactly while the app is busy, which is when a spinner is on screen.
 * This one rotates an HTML `<span>` with a `@keyframes` rule on `transform` — the
 * shape react-native-web's ActivityIndicator and Tailwind's `animate-spin` share — and
 * the drawn arc inside it is static. It also sidesteps the spec rule that SVG children
 * turn around `0 0`: an HTML box turns around its centre.
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
    return observeOffscreen(el)
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
      {/* Static: the span turns, the drawing never animates. No viewBox transform
          is ever asked to composite, and there is no SMIL and no dash animation. */}
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
