// The presentation layer for the adaptv CLI — one calm, quiet visual language.
//
// Deliberately NOT a task-tree framework: a single custom spinner renderer so the
// output reads like a modern build tool (Vite/Expo), not a log dump. One glyph set
// (✓ / ✖ / a braille spinner), aligned lines, dim timings. Concurrent work (`run
// all`) shows one live line per platform. The arrow-key device picker is ours too
// (see `select` below) — no third-party prompt frame, so it matches every other line.
//
//   - TTY      → animated spinner lines, redrawn in place
//   - non-TTY  → plain "· step" / "✓ step (1.2s)" lines, no cursor tricks (CI-safe)
//   - --verbose→ the raw underlying tool output is streamed through instead

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

// Truncate to `max` VISIBLE columns while preserving ANSI colour codes (zero width),
// closing with a reset if it was cut. A single-row status line redrawn with `\r\x1b[2K`
// MUST fit one physical row — otherwise it wraps and each frame stacks a new copy.
function clipAnsi(s, max) {
  let vis = 0
  let res = ""
  for (let i = 0; i < s.length; ) {
    // Pass an ANSI colour escape (ESC `[` … `m`) through untouched — it has zero width.
    if (s[i] === "\x1b" && s[i + 1] === "[") {
      let j = i + 2
      while (j < s.length && s[j] !== "m") j++
      res += s.slice(i, j + 1)
      i = j + 1
      continue
    }
    if (vis >= max) return `${res}\x1b[0m`
    const ch = String.fromCodePoint(s.codePointAt(i))
    res += ch
    i += ch.length
    vis++
  }
  return res
}

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

/** The command banner: `  adaptv  dev android`. */
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
    ? // keys bright (their own bold span), labels dim — NOT one big dim() wrapping bold
      // keys, where the bold's reset bleeds and the key ends up gray.
      `  ${c.dim("·")}  ${c.bold("r")}${c.dim(" reload js")}   ${c.bold("b")}${c.dim(" rebuild app")}   ${c.bold("ctrl-c")}${c.dim(" stop")}`
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
    let s
    if (changed && Date.now() < clearAt) {
      s = `  ${c.cyan(FRAMES[frame++ % FRAMES.length])} ${c.bold("watching")}  ${c.dim(`↻ ${changed}`)}`
    } else {
      changed = null
      // A pending native change outranks the idle hint — it's the one thing the dev has to
      // act on, and it stays put until they do.
      s = notice
        ? `  ${c.yellow("!")} ${c.bold(notice)}  ${c.dim("·")}  ${c.dim("press ")}${c.bold("b")}${c.dim(" to rebuild")}`
        : idleLine
    }
    // Clip to the terminal width so this stays ONE physical row — a wrapped status line
    // redrawn in place stacks a copy every frame (the cascade).
    out(`\r\x1b[2K${clipAnsi(s, Math.max(10, width()))}`)
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

export function onKeys({ onReload, onRebuild, onQuit }) {
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
    // Two distinct lowercase keys (NOT r/R — a shift typo shouldn't swap a 0.4s reload
    // for a 15s reinstall): `r` = reload the JS (refresh the running app), `b` = rebuild
    // the native app (reinstall the binary — for a plugin / native change).
    if (key === "r") {
      void onReload?.()
      return
    }
    if (key === "b") void onRebuild?.()
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
/* device picker (house style — matches the renderer, no third-party frame)    */
/* -------------------------------------------------------------------------- */

/**
 * A single-select arrow-key picker, drawn in the SAME visual language as the rest of the
 * CLI (2-space indent, a `›` cursor, dim hints) instead of a third-party prompt frame with
 * its own gutter and bullets. Two things matter here:
 *
 *  - it aligns with the surrounding `✓ step` / `! warn` lines, and
 *  - it ERASES itself the instant you choose, leaving NO prompt residue — the picked
 *    device only ever appears in the caller's own line (e.g. `✓ ios  iPhone 16 Pro`).
 *
 * `options` is `[{ value, label, hint? }]`. Long lists scroll in a fixed window so the
 * cursor-rewind maths stays inside one screenful. Non-TTY (CI, piped): can't prompt, so
 * take the first option — callers pass `--target`/`--latest` for a deterministic
 * non-interactive choice. Ctrl-C / q / Esc cancels (exit 130), same as before.
 */
export async function select(message, options) {
  if (!options?.length) return undefined
  const stdin = process.stdin
  if (!isTTY || !stdin.isTTY || typeof stdin.setRawMode !== "function")
    return options[0].value

  const WINDOW = 8
  const windowed = options.length > WINDOW
  const visible = Math.min(WINDOW, options.length)
  // Fixed line count per frame: header + visible rows (+ a "N of M" footer when scrolling).
  const rows = 1 + visible + (windowed ? 1 : 0)

  let idx = 0
  let top = 0

  // Clip a plain string to `max` VISIBLE chars. EVERY emitted row must fit the terminal
  // width — a line that wraps takes two physical rows, which breaks the fixed-row cursor
  // rewind below and cascades the whole menu on each keypress on a narrow terminal.
  const clip = (s, max) => {
    const a = [...s]
    return a.length > max
      ? `${a.slice(0, Math.max(0, max - 1)).join("")}…`
      : s
  }
  const paint = () => {
    if (idx < top) top = idx
    else if (idx >= top + visible) top = idx - visible + 1
    const w = Math.max(24, width())
    const nav = "   ↑↓ move · ↵ select"
    out(
      message.length + nav.length <= w - 2
        ? `  ${c.bold(message)}${c.dim(nav)}\n`
        : `  ${c.bold(clip(message, w - 2))}\n`,
    )
    const end = top + visible
    for (let i = top; i < end; i++) {
      const o = options[i]
      const on = i === idx
      const cursor = on ? c.cyan("›") : " "
      const text = clip(`${o.label}${o.hint ? `  ${o.hint}` : ""}`, w - 4)
      out(`  ${cursor} ${on ? text : c.dim(text)}\n`)
    }
    if (windowed)
      out(
        `  ${c.dim(clip(`  ${top + 1}–${end} of ${options.length}`, w - 2))}\n`,
      )
  }
  // `\r` first so the cursor is at column 0 before moving up: a terminal that doesn't
  // reset the column on `\n` would otherwise leave the cursor mid-line, and `\x1b[0J`
  // would only clear from there — leaving the start of the header behind.
  const erase = () => out(`\r\x1b[${rows}A\x1b[0J`)

  paint()
  return await new Promise((resolve) => {
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding("utf8")
    const done = (fn) => {
      stdin.off("data", onData)
      try {
        stdin.setRawMode(false)
      } catch {}
      stdin.pause()
      erase()
      fn()
    }
    const onData = (key) => {
      if (key === "\x1b[A" || key === "\x1bOA" || key === "k") {
        idx = (idx - 1 + options.length) % options.length
        erase()
        paint()
      } else if (key === "\x1b[B" || key === "\x1bOB" || key === "j") {
        idx = (idx + 1) % options.length
        erase()
        paint()
      } else if (key === "\r" || key === "\n") {
        done(() => resolve(options[idx].value))
      } else if (key === "\x03" || key === "q") {
        // NOT bare Esc: an arrow key can arrive as Esc then `[A` in two chunks, and
        // treating a lone Esc as cancel would misfire on that split. Ctrl-C / q cancel.
        done(() => process.exit(130))
      }
    }
    stdin.on("data", onData)
  })
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
// Gerund → past tense: cap prints "✔ Updating … in Nms" once the sub-op is DONE, so the
// honest voice is "updated … · Nms". Unknown verbs pass through unchanged (still readable).
const PAST_TENSE = {
  updating: "updated",
  copying: "copied",
  building: "built",
  running: "ran",
  syncing: "synced",
  generating: "generated",
  installing: "installed",
  creating: "created",
  finding: "found",
  deploying: "deployed",
  cleaning: "cleaned",
  downloading: "downloaded",
  resolving: "resolved",
  writing: "wrote",
  adding: "added",
  launching: "launched",
}

// Normalise a streamed tool line (Capacitor/xcodebuild/gradle) to the house voice: no
// status emoji, the platform word dropped (the lane already says it), "in 2.52ms" →
// "· 2.52ms", the verb put in past tense (the line is a completed sub-op), and the first
// letter lowercased (proper nouns like iPhone/Xcode/Gradle are left alone). Returns "" for
// a line with no useful content — e.g. a bare phase header like "update ios" collapses to
// a lone verb and is dropped rather than shown as a meaningless "update".
export function prettyLine(line) {
  const m = line.match(/(\d{1,3})%\s+([A-Z]+)/)
  if (m) {
    const pct = Math.min(100, Number(m[1]))
    return `${bar(pct)} ${pct}%`
  }
  let s = line
    .replace(/^\s*\[(capacitor|info|debug)\]\s*/i, "") // tool log prefix
    .replace(/^[\s>•·✓✔✅✗✘❌⚠–—-]+/u, "") // leading status glyphs / emoji
    .replace(/\bin\s+([\d.]+\s*(?:[µμ]s|ms|us|s|m))\b/i, "· $1") // "in 2.52ms" → "· 2.52ms"
    .replace(/\s+from\s+\S+\s+to\s+\S+/i, "") // "from <path> to <path>" — noise
    .replace(/\s+to\s+\S.*$/i, "") // trailing "to <device>" — the device settles on the ✓ line
    .replace(/\s+in\s+\S*\/\S+/i, "") // "in <a/path>" — noise (paths, not the time above)
    .replace(/(^|\s)(?:ios|android)(?=\s|$)/gi, "$1") // standalone platform word (NOT in a path)
    .replace(/\bApp(\.app)?\b/g, "app") // Capacitor's generic "App" target → plain "app"
    .replace(/\s{2,}/g, " ")
    .trim()
  if (!s) return ""
  if (/^@?[\w-]+\/[\w.-]+@[\w.-]+$/.test(s)) return "" // a bare `pkg@version` line
  const first = s.match(/^(\w+)/)?.[1]
  if (first) {
    const past = PAST_TENSE[first.toLowerCase()]
    if (past) s = past + s.slice(first.length)
  }
  s = s[0].toLowerCase() + s.slice(1)
  // Drop lines that carry no real action — a lone verb with no object ("update",
  // "run", "sync"), even when it has a `· time`. Nothing useful to show.
  if (/^\w+(\s+·.*)?$/.test(s)) return ""
  return s
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
