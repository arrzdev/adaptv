// The presentation layer for the adaptv CLI — one calm, quiet visual language.
//
// Deliberately NOT a task-tree framework: a single custom spinner renderer so the
// output reads like a modern build tool (Vite/Expo), not a log dump. One glyph set
// (✓ / ✖ / a braille spinner), aligned lines, dim timings. Concurrent work (`run
// all`) shows one live line per platform. @clack/prompts is used ONLY for the
// arrow-key device picker.
//
//   - TTY      → animated spinner lines, redrawn in place
//   - non-TTY  → plain "· step" / "✓ step (1.2s)" lines, no cursor tricks (CI-safe)
//   - --verbose→ the raw underlying tool output is streamed through instead
import * as p from "@clack/prompts"

/* -------------------------------------------------------------------------- */
/* colour (a tiny ANSI helper; honours NO_COLOR)                              */
/* -------------------------------------------------------------------------- */

const noColor = "NO_COLOR" in process.env
const paint = (code) => (s) =>
  noColor ? `${s}` : `\x1b[${code}m${s}\x1b[0m`
export const c = {
  dim: paint("2"),
  bold: paint("1"),
  green: paint("32"),
  red: paint("31"),
  yellow: paint("33"),
  cyan: paint("36"),
  magenta: paint("35"),
}

const isCI = !!process.env.CI
const isTTY = !!process.stdout.isTTY && !isCI
const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
const out = (s) => process.stdout.write(s)
const width = () => process.stdout.columns || 80

const elapsed = (start) => {
  const ms = Date.now() - start
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** A human total duration from `start` (e.g. "8s", "1m 12s"). */
export function since(start) {
  const s = Math.round((Date.now() - start) / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/* -------------------------------------------------------------------------- */
/* static output — header, log lines, summary                                 */
/* -------------------------------------------------------------------------- */

/** The command banner: `  adaptv  run android`. */
export function header(title) {
  out(`\n  ${c.bold(c.magenta("adaptv"))}  ${c.dim(title)}\n\n`)
}

export const log = {
  info: (m) => out(`  ${c.dim(m)}\n`),
  warn: (m) => out(`  ${c.yellow("!")} ${c.dim(m)}\n`),
  success: (m) => out(`  ${c.green("✓")} ${m}\n`),
  error: (m) => out(`  ${c.red("✖")} ${m}\n`),
}

/** A step that was skipped because its inputs are unchanged (build cache hit). */
export function skip(label, note = "cached") {
  out(`  ${c.green("✓")} ${label}  ${c.dim(`· ${note}`)}\n`)
}

/** Print a captured-log tail (on failure), indented + dimmed. */
export function tail(text) {
  if (!text) return
  for (const l of text.split("\n")) out(`    ${c.dim(l)}\n`)
}

/** The closing line — a single outcome + total. Per-platform detail rides on the
 * step/lane lines above, so there's no redundant summary block. */
export function footer(hint) {
  out(`\n  ${hint}\n\n`)
}

/**
 * The single live status line for a `run`. While an HMR update applies the ✓ turns into
 * a spinner and the changed files show; raw dev-server output is suppressed (driven by
 * `hmr(files)` instead).
 *
 * Deliberately does NOT repeat the dev server URL — it's already on the `dev server`
 * line two rows up, and echoing it here just costs a line to say nothing new. What
 * belongs here is what CHANGES: hot-reload activity, a pending native change, and the
 * keys available at any moment.
 */
export function liveWatcher({ keys = true } = {}) {
  const hint = keys
    ? `  ${c.dim("·")}  ${c.dim(`${c.bold("r")} rebuild   ${c.bold("ctrl-c")} stop`)}`
    : ""
  const idleLine = `  ${c.green("✓")} ${c.bold("watching")}${hint}`
  if (!isTTY) {
    out(`${idleLine}\n`)
    return {
      hmr: () => {},
      notice: () => {},
      clearNotice: () => {},
      stop: () => {},
    }
  }
  let frame = 0
  let changed = null
  let clearAt = 0
  let notice = null
  const draw = () => {
    if (changed && Date.now() < clearAt) {
      out(
        `\r\x1b[2K  ${c.cyan(FRAMES[frame++ % FRAMES.length])} ${c.bold("watching")}  ${c.dim(`↻ ${changed}`)}`,
      )
      return
    }
    changed = null
    if (notice) {
      // A pending native change outranks the idle hint — it's the one thing the dev
      // has to act on, and it stays put until they do.
      out(
        `\r\x1b[2K  ${c.yellow("!")} ${c.bold(notice)}  ${c.dim("·")}  ${c.dim(`press ${c.bold("r")} to rebuild`)}`,
      )
      return
    }
    out(`\r\x1b[2K${idleLine}`)
  }
  draw()
  const anim = setInterval(draw, 80)
  return {
    hmr: (files) => {
      changed = files
      clearAt = Date.now() + 900
    },
    notice: (text) => {
      notice = text
    },
    clearNotice: () => {
      notice = null
    },
    stop: () => {
      clearInterval(anim)
      out("\r\x1b[2K")
    },
  }
}

/**
 * Raw-mode key handling for the run loop — Expo-style, and available the WHOLE time
 * rather than only once something is detected: `r` to reinstall on demand is useful
 * whenever a device gets into a state you don't trust, not just after adaptv notices a
 * native change.
 *
 * Raw mode means the terminal stops translating ctrl-c into SIGINT for us, so it has to
 * be forwarded by hand — otherwise the run becomes unkillable. No-op off a TTY (CI,
 * piped output), where there's no one to press anything.
 */
/**
 * Move the cursor back up `n` rows and clear everything below it.
 *
 * Lets a re-run redraw the SAME rows instead of appending a second copy of the story:
 * pressing `r` should walk the platform lines back to a spinner, not print a fresh pair
 * underneath the settled ones. `runLine`/`runLanes` both draw downward from wherever the
 * cursor is and leave it on the row below, so rewinding onto the first platform row is
 * all they need. Returns false off a TTY, where the caller should just append.
 */
export function rewindLines(n) {
  if (!isTTY || n <= 0) return false
  out(`\x1b[${n}A\x1b[0J`)
  return true
}

/** ctrl-c as a raw byte: in raw mode the terminal no longer turns it into SIGINT. */
const CTRL_C = "\u0003"

export function onKeys({ onRebuild, onQuit }) {
  const stdin = process.stdin
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function")
    return () => {}
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding("utf8")
  const handler = (key) => {
    if (key === CTRL_C || key === "q") {
      onQuit?.()
      return
    }
    if (key === "r" || key === "R") void onRebuild?.()
  }
  stdin.on("data", handler)
  return () => {
    stdin.off("data", handler)
    try {
      stdin.setRawMode(false)
    } catch {}
    stdin.pause()
  }
}

/* -------------------------------------------------------------------------- */
/* device picker (clack)                                                       */
/* -------------------------------------------------------------------------- */

/**
 * A single-select picker. `options` is an array of `{ value, label, hint? }`.
 * Returns the chosen value, or exits on cancel.
 */
export async function select(message, options) {
  const value = await p.select({ message, options })
  if (p.isCancel(value)) {
    p.cancel("cancelled.")
    process.exit(130)
  }
  return value
}

/* -------------------------------------------------------------------------- */
/* line prettifier — Gradle "NN% EXECUTING" → a block bar, else trim noise      */
/* -------------------------------------------------------------------------- */

const BAR_WIDTH = 12
function bar(percent) {
  const filled = Math.round((percent / 100) * BAR_WIDTH)
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled)
}

/** Shorten/prettify a captured line for the live sub-detail. */
export function prettyLine(line) {
  const m = line.match(/(\d{1,3})%\s+([A-Z]+)/)
  if (m) {
    const pct = Math.min(100, Number(m[1]))
    return `${bar(pct)} ${pct}%`
  }
  return line.replace(/^\s*\[(capacitor|info|debug)\]\s*/i, "").trim()
}

/* -------------------------------------------------------------------------- */
/* the spinner renderer                                                        */
/* -------------------------------------------------------------------------- */

/** Compose one aligned line, clipping the dim right-hand detail to the width. */
function compose(glyph, label, right) {
  const base = 2 + 1 + 1 + stripLen(label) + 2 // indent + glyph + gap + label + gap
  const budget = Math.max(6, width() - base - 1)
  const clipped =
    right && right.length > budget
      ? `${right.slice(0, budget - 1)}…`
      : right
  return `  ${glyph} ${label}${clipped ? `  ${c.dim(clipped)}` : ""}`
}

// ANSI escape (ESC = char 27), built without a literal control char in the source.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const stripLen = (s) => s.replace(ANSI, "").length

/**
 * Run one step as a single spinner line. `fn(report)` does the work; `report(line)`
 * updates the live detail. Resolves to `fn`'s return; rejects (after marking the line
 * ✖) if it throws. In `verbose`, streams the raw lines instead of animating.
 */
export async function runLine(label, fn, { verbose = false } = {}) {
  const start = Date.now()
  let detail = ""
  const report = (line) => {
    const pretty = prettyLine(line)
    if (!pretty) return
    detail = pretty
    if (verbose) out(`    ${c.dim(line)}\n`)
  }

  // a step's return value, when it's a string, is its final detail (e.g. an artifact
  // path) — shown before the elapsed time on the ✓ line.
  const doneRight = (r) => {
    const t = elapsed(start)
    return typeof r === "string" && r ? `${r} · ${t}` : t
  }

  if (verbose || !isTTY) {
    out(`  ${c.dim("·")} ${label}\n`)
    try {
      const r = await fn(report)
      out(`  ${c.green("✓")} ${label}  ${c.dim(doneRight(r))}\n`)
      return r
    } catch (err) {
      out(`  ${c.red("✖")} ${label}\n`)
      throw err
    }
  }

  let frame = 0
  const draw = () => {
    out(
      `\r\x1b[2K${compose(c.cyan(FRAMES[frame++ % FRAMES.length]), label, detail)}`,
    )
  }
  draw()
  const timer = setInterval(draw, 80)
  try {
    const r = await fn(report)
    clearInterval(timer)
    out(`\r\x1b[2K${compose(c.green("✓"), label, doneRight(r))}\n`)
    return r
  } catch (err) {
    clearInterval(timer)
    out(`\r\x1b[2K${compose(c.red("✖"), label, "")}\n`)
    throw err
  }
}

/**
 * Run several lanes concurrently, each as ONE live line (used for `run all`). A lane
 * is `{ label, run: async (report) => detailString }`; `report(line)` updates that
 * lane's live detail, and the resolved string becomes its final detail. Never rejects
 * — returns `[{ ok, error }]` per lane so one platform failing doesn't stop the render.
 */
export async function runLanes(lanes, { verbose = false } = {}) {
  const state = lanes.map((l) => ({
    label: l.label,
    detail: "",
    status: "run",
    start: Date.now(),
    time: "",
  }))

  const results = new Array(lanes.length)
  const settle = (i, patch) => Object.assign(state[i], patch)

  const runOne = (lane, i) => {
    const report = (line) => {
      const pretty = prettyLine(line)
      if (!pretty) return
      state[i].detail = pretty
      if (verbose) out(`    ${c.dim(`${lane.label}: ${line}`)}\n`)
    }
    return Promise.resolve()
      .then(() => lane.run(report))
      .then(
        (detail) => {
          settle(i, {
            status: "ok",
            time: elapsed(state[i].start),
            detail: detail ?? "",
          })
          results[i] = { ok: true }
        },
        (error) => {
          settle(i, {
            status: "fail",
            time: elapsed(state[i].start),
            detail: "",
          })
          results[i] = { ok: false, error }
        },
      )
  }

  // the settled right-hand side: "<detail> · <time>" on success, else just the time.
  const settledRight = (s) =>
    s.status === "ok" && s.detail ? `${s.detail} · ${s.time}` : s.time

  // verbose / non-TTY: no in-place animation, just start + settle lines.
  if (verbose || !isTTY) {
    for (const s of state) out(`  ${c.dim("·")} ${s.label}\n`)
    await Promise.all(lanes.map(runOne))
    for (const s of state) {
      const glyph = s.status === "ok" ? c.green("✓") : c.red("✖")
      out(`  ${glyph} ${s.label}  ${c.dim(settledRight(s))}\n`)
    }
    return results
  }

  let frame = 0
  let drawn = 0
  const draw = () => {
    if (drawn > 0) out(`\x1b[${drawn}A`)
    for (const s of state) {
      const glyph =
        s.status === "ok"
          ? c.green("✓")
          : s.status === "fail"
            ? c.red("✖")
            : c.cyan(FRAMES[frame % FRAMES.length])
      const right = s.status === "run" ? s.detail : settledRight(s)
      out(`\x1b[2K${compose(glyph, s.label, right)}\n`)
    }
    drawn = state.length
    frame++
  }

  draw()
  const timer = setInterval(draw, 80)
  await Promise.all(lanes.map(runOne))
  clearInterval(timer)
  draw() // final frame with all statuses settled
  return results
}
