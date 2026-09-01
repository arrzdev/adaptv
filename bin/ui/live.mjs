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
// NO JSX: `bin/` ships as raw source (`docs/decisions/dist-build.md` — `bin` is in `files`, and
//         tsdown does not build it), so there is no build step. `h` is
// `createElement`.
import { Box, render, Text, useInput } from "ink"
import { createElement as h, useEffect, useState } from "react"
import { FRAME_MS, FRAMES, ROLE } from "./theme.mjs"

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
 *
 * THE ORDER IS THE WHOLE CONTRACT, and it is not recoverable afterwards: Ink's `unmount()`
 * ends with `log.done()`, which forgets how many rows the last frame occupied WITHOUT erasing
 * them. A `clear()` after that erases zero lines — a silent no-op on a region that is still on
 * screen. So nothing here may unmount by any other route first; in particular a component must
 * not call `useApp().exit()` (see `inkSelect`).
 */
export function eraseRegion(app) {
  app.clear?.()
  app.unmount?.()
}

/**
 * The Ink options EVERY region mounts with. One object, for the same reason there is one
 * `eraseRegion`: the erase is only sound if every region was mounted the same way.
 *
 * `maxFps: 0` turns Ink's frame-rate cap OFF, and that is a correctness fix rather than a
 * performance one. The cap defers a render into a trailing timer, so a component whose last two
 * updates land inside one frame still has a paint PENDING when the region is taken down — and
 * `unmount()` re-renders. That pending frame is therefore painted straight back over the screen
 * `eraseRegion` had just cleared, and then forgotten, so it can never be erased again:
 *
 *     …⠹ ios  linking…   erase   ⠹ ios  linking   ← repainted by unmount, after the erase
 *     ✓ ios  iPhone 16 Pro (simulator) · 21.4s
 *
 * Reproducing it takes only two `phase()` calls a few ms apart before `stop()` — an ordinary
 * sequence when a tool's last line arrives just before its step returns. It leaked 20 times out
 * of 20; with the cap off, 0 of 20.
 *
 * Nothing here needs the cap. Pacing is the CALLER's, and always was: phases are sampled rather
 * than followed (`nextPhase()`), the bus drops an update that changes nothing, and the spinner
 * runs on the theme's own clock. The cap paced nothing that wasn't paced already — it only made
 * the erase racy.
 */
export const REGION = { patchConsole: false, maxFps: 0 }

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
    h(Text, { ...ROLE.busy.text }, frame),
    h(Text, null, ` ${label}  `),
    h(
      Box,
      { flexShrink: 1, overflow: "hidden" },
      h(Text, { ...ROLE.quiet.text, wrap: "truncate-end" }, phase),
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
  const app = render(h(Rows, { bus }), REGION)
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

/**
 * How many device rows the picker shows at once.
 *
 * A machine with two iOS runtimes installed lists 36 simulators, and the picker drew every
 * one: a 38-line block that pushed the question itself off the top of the terminal, so the
 * dev arrowed through a wall with nothing on screen saying what was being asked (R63). Six
 * is enough to see the shape of the list and small enough that the whole prompt — question,
 * window, key hint — is read at a glance.
 */
const WINDOW = 6

/**
 * Where the visible window starts, given where the cursor moved to.
 *
 * The window is STICKY: it holds still while the cursor moves inside it and only follows
 * once the cursor would leave, which is what makes a long list feel like a list rather than
 * a treadmill. The alternative — recentring on the cursor every keypress — scrolls on every
 * press and gives the dev no fixed point to read against.
 *
 * Pure, and separated from the component for that reason: this is the whole behaviour of the
 * feature, and it is arithmetic. Wrapping is covered by the clamps — `↓` off the last row
 * gives index 0 (window snaps to the top), `↑` off the first gives the last (window snaps to
 * the bottom).
 */
export function scrollTo(index, start, count, size = WINDOW) {
  if (count <= size) return 0
  const last = count - size
  let next = Math.min(Math.max(start, 0), last)
  if (index < next) next = index
  else if (index >= next + size) next = index - size + 1
  return Math.min(Math.max(next, 0), last)
}

/**
 * How wide the label column is, so the hints line up under each other.
 *
 * A picker is a LIST, and the CLI already aligns the right-hand side of a list rather than
 * letting it ride on the label — `addresses()` pads its keys, `doctor` lays out a table. Left
 * ragged, 36 device rows put the `· iOS 26.1` at a different column on every line, and the one
 * fact that tells two rows apart was the hardest thing on screen to scan (R65).
 *
 * Returns 0 — no padding — when nothing carries a hint (`confirm()` is a two-option `select`),
 * or when the aligned row would not fit the terminal. A picker row that WRAPS is worse than a
 * ragged one: it costs the window a line and the block stops being six rows tall.
 */
export function hintColumn(options, columns) {
  if (!options.some((o) => o.hint)) return 0
  const label = Math.max(...options.map((o) => String(o.label).length))
  const hint = Math.max(...options.map((o) => String(o.hint ?? "").length))
  //2 indent + 2 cursor + label + `  · ` + hint
  return 4 + label + 4 + hint <= columns ? label : 0
}

function Picker({ bus, message, options, onDone }) {
  const { index, start } = useBus(bus)
  const move = (delta) =>
    bus.set((s) => {
      const next = (s.index + delta + options.length) % options.length
      return {
        index: next,
        start: scrollTo(next, s.start, options.length),
      }
    })
  useInput((input, key) => {
    if (key.upArrow || input === "k") move(-1)
    else if (key.downArrow || input === "j") move(1)
    //An answer only REPORTS itself. It must not touch the bus (a re-render after the region
    //is taken down would redraw the list) and must not `exit()` — see `eraseRegion`.
    else if (key.return) onDone({ chosen: options[bus.get().index].value })
    else if (key.escape || input === "q" || (key.ctrl && input === "c"))
      onDone({ cancelled: true })
  })
  const windowed = options.length > WINDOW
  const shown = windowed ? options.slice(start, start + WINDOW) : options
  const above = windowed ? start : 0
  const below = windowed ? options.length - start - shown.length : 0
  //Both markers are drawn WHENEVER the list is windowed, blank when that direction holds
  //nothing. Drawing them only when they have a count would change the block's height as the
  //dev scrolls past either end, and every row would jump a line under a cursor that had not
  //moved.
  const marker = (arrow, n) =>
    h(Text, { ...ROLE.quiet.text }, n > 0 ? `  ${arrow} ${n} more` : " ")
  const pad = hintColumn(options, process.stdout.columns || 80)
  return h(
    Box,
    { flexDirection: "column", marginLeft: 2 },
    //Bold, like every other heading adaptv prints over a group (`section()`): it is the one
    //line on screen the dev has to read before they can answer.
    h(Text, { ...ROLE.strong.text }, message),
    windowed ? marker("↑", above) : null,
    ...shown.map((o, i) => {
      const at = start + i
      return h(
        Text,
        { key: String(o.value ?? at) },
        //The cursor sits in the GLYPH column, so the label starts exactly where a settled
        //`✓ web` label starts. The picker used to draw itself two columns to the right of
        //every other line on the page (R65).
        at === index
          ? h(Text, { ...ROLE.key.text }, "› ")
          : h(Text, null, "  "),
        h(
          Text,
          at === index ? { bold: true } : { ...ROLE.quiet.text },
          o.label.padEnd(pad),
        ),
        //Dim, and after the label, because it is metadata about the row rather than part of
        //its name (R25) — and it is the ONLY thing separating two identically-named devices
        //on different runtimes, so it stays dim on the highlighted row too. TWO spaces before
        //the `·`, which is how every other row in the CLI opens its metadata (R31).
        o.hint ? h(Text, { ...ROLE.quiet.text }, `  · ${o.hint}`) : null,
      )
    }),
    windowed ? marker("↓", below) : null,
    //The same row the watch block draws: a pressable key is cyan bold, its label is dim, and
    //three spaces separate one offer from the next. This was a single flat dim string, so the
    //picker was the one place in the CLI where a key you can press did not look like one —
    //and `theme.mjs` names `↑↓` and `↵` as examples of that very role (R65).
    h(
      Text,
      null,
      h(Text, { ...ROLE.key.text }, "↑↓"),
      h(Text, { ...ROLE.quiet.text }, " move   "),
      h(Text, { ...ROLE.key.text }, "↵"),
      h(Text, { ...ROLE.quiet.text }, " select   "),
      h(Text, { ...ROLE.key.text }, "esc"),
      h(Text, { ...ROLE.quiet.text }, " cancel"),
    ),
  )
}

/**
 * The arrow-key picker. Resolves to the chosen value, or `null` when cancelled.
 *
 * Erases itself on the way out — the choice is reported by whatever the caller prints next, so
 * a list left on screen is a question that has already been answered (R37 covers the cancel
 * case, which must still leave a line).
 *
 * THE ANSWER IS A PROMISE, NOT `waitUntilExit`. That is the whole reason this reads the way it
 * does. Waiting on Ink's exit meant the component had already called `exit()` — Ink unmounts,
 * leaves its last frame on screen and forgets it (`eraseRegion`), so the erase that followed
 * erased nothing and every answered picker stayed:
 *
 *     which ios device?
 *       iPhone 16 Pro (simulator)
 *     ↑↓ move   ↵ select   esc cancel
 *     which android device?
 *     ↑↓ move   ↵ select   esc cancel
 *     ⠏ ios  linking plugins
 *
 * Two answered questions and a lane, all on screen at once. So the keypress resolves a plain
 * promise instead, and the region is still MOUNTED when `eraseRegion` takes it down.
 */
export async function inkSelect(message, options) {
  const bus = makeBus({ index: 0, start: 0 })
  let settle
  const answered = new Promise((resolve) => {
    settle = resolve
  })
  const app = render(
    h(Picker, { bus, message, options, onDone: (r) => settle(r) }),
    //`exitOnCtrlC: false` because Ctrl-C is one of the picker's own answers (cancel), and Ink's
    //handler would unmount before it — the very take-down this function exists to avoid.
    { ...REGION, exitOnCtrlC: false },
  )
  const { chosen, cancelled } = await answered
  eraseRegion(app)
  return cancelled ? null : chosen
}
