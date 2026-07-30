// The `dev` watch block, rendered by Ink.
//
// This is the first component of the renderer port, and it is first on purpose: it is the one
// place a cursor-arithmetic bug has actually shipped. The block is two rows when a notice is
// pending and one when it is not, and the string renderer grows and shrinks it by hand —
// counting rows, moving the cursor up, erasing to the end of the screen, and parking the cursor
// back at the top. Getting that off by one walked the whole block up the screen a row per frame
// and its erase then ate the settled platform lines above it. That is not a bug you fix; it is
// a bug you stop being able to write.
//
// Under Ink there is no arithmetic. The block is a description of what should be on screen and
// the layout engine reconciles it — a notice appearing is a state change, not a re-measure.
//
// NO JSX: `bin/` ships as raw source (DECISIONS O12, `files: ["bin"]`, and tsdown builds only
// `src/`), so there is no build step to compile it. `h` is `createElement`.
import { Box, render, Text, useApp, useInput } from "ink"
import { createElement as h, useEffect, useState } from "react"
import { eraseRegion } from "./live.mjs"
import { FRAME_MS, FRAMES, GLYPH, HMR_FLASH_MS, ROLE } from "./theme.mjs"

/** The braille spinner, on the theme's own clock. */
function useSpinner(active) {
  const [frame, setFrame] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setFrame((f) => f + 1), FRAME_MS)
    return () => clearInterval(t)
  }, [active])
  return FRAMES[frame % FRAMES.length]
}

/**
 * The keys row. ALWAYS present — this is R41, and it is now structural rather than remembered:
 * a notice is a sibling above it, so there is no code path in which one replaces the other.
 */
function Keys({ keys, available }) {
  if (!keys)
    return h(
      Box,
      null,
      h(Text, { ...ROLE.key.text }, "ctrl-c"),
      h(Text, { ...ROLE.quiet.text }, " stop"),
    )
  if (!available)
    return h(
      Text,
      { ...ROLE.quiet.text },
      "keys unavailable (stdin is not a TTY). Run adaptv directly for r/b",
    )
  return h(
    Box,
    null,
    h(Text, { ...ROLE.key.text }, "r"),
    h(Text, { ...ROLE.quiet.text }, " reload js   "),
    h(Text, { ...ROLE.key.text }, "b"),
    h(Text, { ...ROLE.quiet.text }, " rebuild app   "),
    h(Text, { ...ROLE.key.text }, "ctrl-c"),
    h(Text, { ...ROLE.quiet.text }, " stop"),
  )
}

/** `! config change  · press b to rebuild and see the changes` */
function Notice({ text }) {
  return h(
    Box,
    null,
    h(Text, { ...ROLE.notice.text }, GLYPH.notice),
    h(Text, null, " "),
    h(Text, { bold: true }, text),
    h(Text, { ...ROLE.quiet.text }, "  · press "),
    h(Text, { ...ROLE.key.text }, "b"),
    h(Text, { ...ROLE.quiet.text }, " to rebuild and see the changes"),
  )
}

/** The activity row: a spinner while HMR applies, otherwise the keys. */
function Activity({ changed, keys, available }) {
  const frame = useSpinner(Boolean(changed))
  if (!changed) return h(Keys, { keys, available })
  return h(
    Box,
    null,
    h(Text, { ...ROLE.busy.text }, frame),
    h(Text, null, " "),
    h(Text, { ...ROLE.strong.text }, "watching"),
    h(Text, { ...ROLE.quiet.text }, `  ↻ ${changed}`),
  )
}

/**
 * The block: notice (optional), a blank row, then the activity row.
 *
 * `marginLeft` is the two-space body indent from the theme — expressed as layout rather than
 * as a string prefix on every line, which is the other thing that used to be hand-maintained.
 */
function Watch({ bus, keys, available }) {
  const { exit } = useApp()
  const [state, setState] = useState({ notice: null, changed: null })

  useEffect(() => bus.subscribe(setState), [bus])

  //An HMR flash is transient: it shows the changed files for a beat and then the row returns
  //to the keys. A timer per flash, cleared if another arrives first.
  useEffect(() => {
    if (!state.changed) return
    const t = setTimeout(
      () => setState((s) => ({ ...s, changed: null })),
      HMR_FLASH_MS,
    )
    return () => clearTimeout(t)
  }, [state.changed])

  //`isActive` gates the raw-mode listener, and it must: Ink throws outright when raw mode is
  //unavailable, which is every non-TTY — a CI job, a piped run, a test. The string renderer
  //guards the same case with `keysAvailable()`, and the keys row already says so rather than
  //advertising keys that will never arrive.
  useInput(
    (input, key) => {
      if (key.ctrl && input === "c") return bus.onQuit?.()
      if (input === "q") return bus.onQuit?.()
      if (input === "r") return bus.onReload?.()
      if (input === "b") return bus.onRebuild?.()
    },
    { isActive: keys && available },
  )

  //Registered so `exit` is reachable from the bus without the caller knowing about Ink.
  useEffect(() => {
    bus._exit = exit
  }, [bus, exit])

  return h(
    Box,
    { flexDirection: "column", marginLeft: 2 },
    state.notice ? h(Notice, { text: state.notice }) : null,
    state.notice ? h(Text, null, "") : null,
    h(Activity, { changed: state.changed, keys, available }),
  )
}

/**
 * Mount the watch block. Returns the SAME interface `liveWatcher` in `render.mjs` returns —
 * `hmr`, `notice`, `clearNotice`, `stop` — so `runLive` cannot tell which renderer it got.
 * That is what makes the port switchable one component at a time.
 */
export function inkWatcher({
  keys = true,
  onReload,
  onRebuild,
  onQuit,
} = {}) {
  let listener = null
  let state = { notice: null, changed: null }
  const push = (next) => {
    state = { ...state, ...next }
    listener?.(state)
  }
  const bus = {
    subscribe: (fn) => {
      listener = fn
      fn(state)
      return () => {
        listener = null
      }
    },
    onReload,
    onRebuild,
    onQuit,
  }
  const available =
    Boolean(process.stdin.isTTY) &&
    typeof process.stdin.setRawMode === "function"

  const app = render(h(Watch, { bus, keys, available }), {
    //Ink clears and repaints its own region; anything already on screen scrolls above it.
    patchConsole: false,
  })

  return {
    hmr: (files) => push({ changed: files }),
    notice: (text) => push({ notice: text }),
    clearNotice: () => push({ notice: null }),
    //Erase-then-unmount, and the order is the whole bug — see `eraseRegion`. This block is
    //ALSO what `rewindLines` counts back from: `r`/`b` walk the cursor up over the blank
    //separator and one row per platform so the settled platform lines animate again in place.
    //Leaving this block on screen made every one of those rewinds land short.
    stop: () => eraseRegion(app),
    /** Await this before exiting the process, so Ink can restore the terminal. */
    done: () => app.waitUntilExit(),
  }
}
