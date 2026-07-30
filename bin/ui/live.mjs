// Every LIVE region of the CLI, rendered by Ink.
//
// This is the renderer port. The string renderer grew one piece of cursor arithmetic per live
// region — `\r\x1b[2K` to redraw a row, `\x1b[NA` to walk back over several, `\x1b[0J` to erase
// what follows — and each of those is a place to be off by one. One of them shipped: the watch
// block walked itself up the screen a row per frame and its erase ate the settled lines above
// it. Nothing here computes a cursor position. A region is a description of what should be on
// screen, and Ink reconciles it.
//
// THE DIVISION OF LABOUR, and it is deliberate:
//
//   live regions   here. Spinners, lanes, the watch block, the picker — everything that is
//                  redrawn in place. This is where every cursor bug has ever been.
//   static text    stays in `render.mjs` as plain writes. A banner, a notice and a settled row
//                  are printed once and scroll; there is no arithmetic to get wrong, and
//                  routing them through Ink would mean booting it (136-177ms) to print a help
//                  page. Ink is mounted only for as long as something is actually animating,
//                  and the settled row is written after it unmounts.
//
// NO JSX: `bin/` ships as raw source (DECISIONS O12), so there is no build step. `h` is
// `createElement`.
import { Box, render, Text, useApp, useInput } from "ink"
import { createElement as h, useEffect, useState } from "react"
import { FRAME_MS, FRAMES, IDLE_MS, ROLE } from "./theme.mjs"

/** The braille spinner, on the theme's clock. */
function useSpinner() {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), FRAME_MS)
    return () => clearInterval(t)
  }, [])
  return FRAMES[frame % FRAMES.length]
}

/** Subscribe a component to a plain pub/sub bus. */
function useBus(bus) {
  const [state, setState] = useState(bus.get)
  useEffect(() => bus.subscribe(setState), [bus])
  return state
}

/**
 * Take a transient Ink region off the screen: ERASE it, then unmount — in that order.
 *
 * Ink deliberately leaves its last frame on screen when it unmounts. That is right for a UI
 * that IS the output and wrong for every region here, all of which are transient: the caller
 * prints the settled text afterwards, into the space the region gave back. Unmounting first
 * leaves nothing to clear, so the region stays and whatever comes next lands underneath it.
 *
 * Shared rather than written per component because it was got wrong twice, independently, and
 * the two failures looked nothing like each other. In `liveRows` the spinner rows survived and
 * every step appeared twice. In the watch block the surviving rows silently shifted the screen
 * down, so `rewindLines` — which counts back a fixed number of rows to redraw the platform
 * lines in place — landed that many rows too low and rebuilt underneath its own history:
 *
 *     ✓ ios  iPhone 16 Pro (simulator) · cached · 366ms
 *     ✓ ios  iPhone 16 Pro (simulator) · reloaded · 369ms
 *     ✓ ios  iPhone 16 Pro (simulator) · 21.4s
 *
 * One function, so there is one place to be right.
 */
export function eraseRegion(app) {
  app.clear?.()
  app.unmount?.()
}

/** A minimal store the command side pushes into and the components read. */
export function makeBus(initial) {
  let state = initial
  let listener = null
  return {
    get: () => state,
    set: (next) => {
      state =
        typeof next === "function" ? next(state) : { ...state, ...next }
      listener?.(state)
    },
    subscribe: (fn) => {
      listener = fn
      fn(state)
      return () => {
        listener = null
      }
    },
  }
}

/* -----------------------------------------------------------------------------
 * one row
 * -------------------------------------------------------------------------- */

/**
 * `⠴ ios  compiling`
 *
 * NO running clock. A live row says what is happening; how long it took is the SETTLED row's
 * business (`✓ ios  iPhone 16 Pro · 20.0s`). A number ticking in place is motion that carries
 * no new information — the spinner already says "alive" — and it made a calm page restless.
 */
function Row({ label, phase }) {
  const frame = useSpinner()
  return h(
    Box,
    null,
    h(Text, { ...ROLE.busy }, frame),
    h(Text, null, ` ${label}  `),
    h(
      Box,
      { flexShrink: 1, overflow: "hidden" },
      h(Text, { ...ROLE.quiet, wrap: "truncate-end" }, phase),
    ),
  )
}

/** The whole live block: one row per lane, in the order the lanes were given. */
function Rows({ bus }) {
  const { rows } = useBus(bus)
  return h(
    Box,
    { flexDirection: "column", marginLeft: 2 },
    ...rows.map((r) =>
      h(Row, { key: r.label, label: r.label, phase: r.phase }),
    ),
  )
}

/**
 * Mount a live block of `labels` and return a controller.
 *
 * The controller is what the string renderer's live loops become: `phase(label, text)` instead
 * of recomputing and redrawing a row, `stop()` instead of erasing one. The caller settles the
 * rows itself, afterwards, with ordinary writes — Ink is only ever mounted while something is
 * moving.
 */
export function liveRows(labels) {
  const bus = makeBus({
    rows: labels.map((label) => ({ label, phase: "preparing" })),
  })
  const app = render(h(Rows, { bus }), { patchConsole: false })
  return {
    /** Set one row's phase. Idempotent — the same text does not re-render. */
    phase: (label, text) =>
      bus.set((s) => ({
        rows: s.rows.map((r) =>
          r.label === label && r.phase !== text
            ? { ...r, phase: text }
            : r,
        ),
      })),
    stop: () => eraseRegion(app),
  }
}

/* -----------------------------------------------------------------------------
 * the picker
 * -------------------------------------------------------------------------- */

function Picker({ bus, message, options }) {
  const { exit } = useApp()
  const { index } = useBus(bus)
  useInput((input, key) => {
    if (key.upArrow || input === "k")
      bus.set((s) => ({
        index: (s.index - 1 + options.length) % options.length,
      }))
    else if (key.downArrow || input === "j")
      bus.set((s) => ({ index: (s.index + 1) % options.length }))
    else if (key.return) {
      bus.set({ chosen: options[bus.get().index].value })
      exit()
    } else if (
      key.escape ||
      input === "q" ||
      (key.ctrl && input === "c")
    ) {
      bus.set({ cancelled: true })
      exit()
    }
  })
  return h(
    Box,
    { flexDirection: "column", marginLeft: 2 },
    h(Text, null, message),
    ...options.map((o, i) =>
      h(
        Text,
        { key: String(o.value ?? i) },
        i === index
          ? h(Text, { ...ROLE.busy }, "  › ")
          : h(Text, null, "    "),
        h(Text, i === index ? { bold: true } : { ...ROLE.quiet }, o.label),
      ),
    ),
    h(Text, { ...ROLE.quiet }, "  ↑↓ move · ↵ select · esc cancel"),
  )
}

/**
 * The arrow-key picker. Resolves to the chosen value, or `null` when cancelled.
 *
 * Erases itself on the way out — the choice is reported by whatever the caller prints next, so
 * a list left on screen is a question that has already been answered (R37 covers the cancel
 * case, which must still leave a line).
 */
export async function inkSelect(message, options) {
  const bus = makeBus({ index: 0, chosen: undefined, cancelled: false })
  const app = render(h(Picker, { bus, message, options }), {
    patchConsole: false,
    exitOnCtrlC: false,
  })
  await app.waitUntilExit()
  //`waitUntilExit` already unmounted, so this is only the erase — but it goes through the
  //shared helper anyway, so there is no second opinion about what taking a region down means.
  eraseRegion(app)
  const { chosen, cancelled } = bus.get()
  return cancelled ? null : chosen
}

/** Shared with the string renderer so both agree on when a row starts showing its age. */
export { IDLE_MS }
