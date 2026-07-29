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
import {
  DEFAULT_COLUMNS,
  GLYPH,
  PHASE_DWELL_MS as THEME_DWELL_MS,
  FRAMES as THEME_FRAMES,
  IDLE_MS as THEME_IDLE_MS,
} from "../ui/theme.mjs"
import { isRawToolNoise, phaseLabel } from "./tool-log.mjs"

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
//From the theme, not restated here: the spinner, the glyphs, the widths and the timings are
//the design system (docs/CLI-VISUAL.md), and a second copy in the renderer is a second design
//system waiting to drift.
const FRAMES = THEME_FRAMES
/**
 * The two streams, each with its own memory of the last two bytes it wrote.
 *
 * The memory is what makes `spacer()` idempotent: blank lines separate blocks (banner,
 * notices, steps) and every block asks for one on each side of itself, so without it the seam
 * between two blocks is two blank lines and one run looks like two.
 *
 * PER-STREAM, because a failure goes to stderr and everything else to stdout. With one shared
 * memory, a stdout write would satisfy a stderr `spacer()` and the `✖` block would lose its
 * breathing room the moment stdout was redirected to a file — which is exactly when the dev is
 * relying on stderr to still read properly.
 */
const streams = {
  out: { w: process.stdout, tail: "" },
  err: { w: process.stderr, tail: "" },
}
/**
 * Where a failure goes.
 *
 * Errors used to be written to stdout like everything else, so `adaptv build ios > out.json`
 * captured the failure INTO the file it was supposed to be producing. Failures — `log.error`,
 * `fail`, `usageFail`, and the dim detail hanging under them — go to stderr; the banner, the
 * steps, the notices and the addresses stay on stdout, because they are what the dev asked
 * for. A notice is not a failure: it stays on stdout with the rest of the story.
 */
let sink = "out"
const toStderr = (fn) => {
  sink = "err"
  try {
    fn()
  } finally {
    sink = "out"
  }
}
const out = (s) => {
  const st = streams[sink]
  st.tail = `${st.tail}${s}`.slice(-2)
  st.w.write(s)
}
/** `spacer()` asks the stream it is CURRENTLY writing to whether it already has a blank line. */
const currentTail = () => streams[sink].tail
const width = () => process.stdout.columns || DEFAULT_COLUMNS

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

// `offset` adds work that was done for this step BEFORE its line existed — the native
// scaffolding, which runs ahead of the dev server (the device list needs the project) but
// belongs to the platform's own line. Without it a first run would report only the launch
// and quietly lose the seconds the dev actually waited.
const elapsed = (start, offset = 0) => {
  const ms = Date.now() - start + offset
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

/** Silence (ms) after which a live line falls back to its present-tense `idle` label — the
 *  native build streams nothing, so past this the last finished phase is stale. */
const IDLE_MS = THEME_IDLE_MS
// A phase must hold the line this long before another may replace it.
//
// The native toolchains change phase several times a second — an iOS build rewrote the live
// line 105 times in 13s, alternating compiling↔processing resources as it walked the pods.
// Each individual line was correct and the effect was a strobe, unreadable and stressful to
// watch. So the line SAMPLES the stream rather than following it: whatever phase is current
// when the window opens gets the row and keeps it. Nothing is hidden — a phase that lasts
// less than a blink was never information, and `--verbose` still streams every line.
const PHASE_DWELL_MS = THEME_DWELL_MS

/**
 * The row's next phase: adopt `pending` only once the current one has had its dwell.
 * Pure so the sampling rule is testable — both renderers call it from their draw loop.
 */
export function nextPhase({ detail, pending, shownAt }, now) {
  if (!pending || pending === detail) return { detail, shownAt }
  //An empty row shows its first phase AT ONCE — the dwell governs replacing a phase, not
  //arriving at one. (Leaving this to `now - 0 >= dwell` only worked by accident of epoch
  //arithmetic, and would have stalled the first phase under any other clock.)
  if (!detail || now - shownAt >= PHASE_DWELL_MS)
    return { detail: pending, shownAt: now }
  return { detail, shownAt }
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
  //`adaptv · build ios` — the separator reads as one phrase where two spaces read as a
  //gap the eye has to bridge.
  out(`\n  ${c.bold(c.magenta("adaptv"))} ${c.dim(`· ${title}`)}\n\n`)
}

export const log = {
  info: (m) => out(`  ${c.dim(m)}\n`),
  warn: (m) => out(`  ${c.yellow(GLYPH.notice)} ${c.dim(m)}\n`),
  success: (m) => out(`  ${c.green(GLYPH.ok)} ${m}\n`),
  error: (m) => toStderr(() => out(`  ${c.red(GLYPH.fail)} ${m}\n`)),
}

/**
 * Print collected notices once each, then empty the list.
 *
 * EVERY notice carries the `!` (R5). There is no second, glyphless severity: a line with no
 * glyph reads as stray output rather than something the CLI meant to say, and the dev is
 * left deciding whether an unmarked sentence is a problem. The question a notice must pass
 * is not "how bad is this" but "does the dev need to know" — if the answer is no, it is not
 * printed at all (R4).
 *
 * Entries are strings; `{ note }` is still accepted so callers can be migrated, and renders
 * identically.
 *
 * Deduped, because the same app-level fact (an icon source, a config key) is
 * discovered once per platform: printing it per platform reads as several separate
 * problems when it is one. Shared by every command so they cannot drift apart.
 *
 * Notices are a BLOCK, not loose lines: they close with a blank line so the `!`s read as one
 * thing adaptv had to say and the steps below start clean (R33). The gap belongs here rather
 * than at the call sites because every command flushes and every one of them wants it — and
 * `spacer()` collapses it into a neighbouring blank line, so a flush next to a banner or a
 * finished command never opens a second gap.
 */
export function flushNotices(notices) {
  const seen = new Set()
  for (const n of notices) {
    const text = typeof n === "string" ? n : n.note
    if (seen.has(text)) continue
    seen.add(text)
    log.warn(text)
  }
  notices.length = 0
  if (seen.size > 0) spacer()
}

/**
 * The ONE sanctioned way to put unformatted bytes on stdout: `--verbose`, whose entire
 * purpose is raw passthrough (R12). Everything else in the CLI goes through the primitives
 * above, so the visual language lives in one file rather than being re-invented per command.
 */
export function rawOut(text) {
  out(text)
}

/** A group heading inside a report (`doctor`): breathing room, then the title. */
export function section(title) {
  out(`\n  ${c.bold(title)}\n`)
}

/**
 * One checked item in a report — the SAME glyph set as every other line in the CLI.
 * `doctor` used to draw its own rows with `✔` (a different check mark) and `○`, so the one
 * command a dev runs when something is wrong was also the one that looked like a different
 * program. `optional` marks a thing whose absence is fine: dim, not red.
 *
 * The note is this row's metadata and opens with the same `·` every other row uses (R31) —
 * `✓ node  · v26.0.0`, not `✓ node  v26.0.0`. It was the last shape still setting its
 * right-hand side one column left of the rest of the CLI.
 */
export function check(ok, label, note = "", { optional = false } = {}) {
  const glyph = ok
    ? c.green(GLYPH.ok)
    : optional
      ? c.dim(GLYPH.absent)
      : c.red(GLYPH.fail)
  out(`  ${glyph} ${label}${note ? c.dim(`  · ${note}`) : ""}\n`)
}

/**
 * Pre-composed multi-line text: the `--help` screen. It is a page, not a step, so it is the
 * one thing that arrives already laid out — but it still goes through the renderer so that
 * NOTHING in the CLI writes to stdout on its own.
 */
export function helpText(text) {
  out(text.endsWith("\n") ? text : `${text}\n`)
}

/** A step that was skipped because its inputs are unchanged (build cache hit). */
export function skip(label, note = "cached") {
  out(`  ${c.green(GLYPH.ok)} ${label}  ${c.dim(`· ${note}`)}\n`)
}

/**
 * A failure that has no live line of its own to settle (a transient step, or a crash
 * before any step started): the SAME one-line shape a settled ✖ uses, so every failure in
 * the CLI reads identically — `✖ <label>  · <reason>` plus dim detail underneath.
 *
 * The leading `·` is the same one `settled()`/`skip()` open with when nothing precedes the
 * metadata (`✓ web  · 3.9s`, `✓ ios  · cached`). Without it this row started one column to
 * the left of every other row's right-hand side, and a run that settled a surface and then
 * failed it read ragged:
 *     ✓ web  · 3.9s
 *     ✖ web  listen EADDRINUSE: address already in use 127.0.0.1:41720
 * A timed ✖ (`✖ ios  gradle said X · 12.0s`) keeps its reason in the content column — the
 * `·` there already separates that content from the elapsed time, and a second one would
 * put two dots on one row.
 */
export function fail(label, reason, detail = []) {
  toStderr(() => {
    out(`${compose(c.red(GLYPH.fail), label, `· ${reason}`)}\n`)
    detailBlock(detail)
  })
  noteFailurePrinted()
}

/** The blank line that used to come from the closing footer — kept so a finished command
 * still ends with breathing room instead of the shell prompt hugging the last step. */
export function spacer() {
  //Idempotent: asking for breathing room where there already is some is not a request for
  //twice as much. Several blocks each end with one (the banner, a notice block, a finished
  //command) and they meet — `preview all` with nothing to warn about put the gap after the
  //banner AND before the first step, and the run started two lines lower than every other.
  if (currentTail() !== "\n\n") out("\n")
}

/** One dim, indented line hanging under a settled step — the same shape failure detail
 * uses, so an extra address reads as part of that step rather than a new event. */
export function detail(line) {
  out(`    ${c.dim(line)}\n`)
}

/**
 * The addresses a served app answers on, as aligned dim rows under its settled line:
 *
 *     ✓ web  · 2.0s
 *         local    http://localhost:41710
 *         network  http://192.168.1.25:41710
 *
 * The URL used to sit ON the settled line with the network address hanging under it, which
 * gave one address a label and the other none, and made the row grow with the port. A served
 * app has a LIST of addresses; this renders it as one, the way every dev server does.
 *
 * `network` is printed only when the server reports one (R19) — adaptv binds the LAN only
 * when a physical device needs it, so a computed address would often point at nothing.
 */
export function addresses({ local, network } = {}) {
  const rows = [
    ["local", local],
    ["network", network],
  ].filter(([, url]) => url)
  const pad = Math.max(...rows.map(([k]) => k.length))
  for (const [k, url] of rows)
    out(`    ${c.dim(k.padEnd(pad))}  ${c.dim(url)}\n`)
}

/** The dim, indented lines that expand on a `✖` line (a fix hint or a captured tail). */
function detailBlock(detail) {
  for (const d of detail ?? []) out(`    ${c.dim(d)}\n`)
}

/* -----------------------------------------------------------------------------
 * static pages — help, and the failure of an invocation
 *
 * R10 keeps a LIVE row to one physical line, because a row redrawn with `\r\x1b[2K` must
 * occupy exactly one. A help page and an invocation error are printed once and never
 * redrawn, so the same rule would only cost them their tail — and R15 says never truncate an
 * error whose remaining words carry the instructions. So these WRAP (R44). `clipAnsi` stays
 * for rows; `wrap` and `table` serve pages.
 * -------------------------------------------------------------------------- */

/** Visible width, ignoring colour escapes (built without a literal control char in source). */
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const visibleLength = (s) => s.replace(ANSI_RE, "").length

/**
 * Word-wrap to `max` visible columns. `hang` indents every line after the first, so a wrapped
 * synopsis or description stays visually attached to the thing it belongs to.
 */
export function wrap(text, { max = 80, hang = 0 } = {}) {
  const words = String(text).split(/\s+/).filter(Boolean)
  if (words.length === 0) return [""]
  const pad = " ".repeat(hang)
  const lines = []
  let line = ""
  for (const w of words) {
    const width = lines.length === 0 ? max : max - hang
    if (line && visibleLength(line) + 1 + visibleLength(w) > width) {
      lines.push(line)
      line = w
    } else line = line ? `${line} ${w}` : w
  }
  lines.push(line)
  return lines.map((l, i) => (i === 0 ? l : pad + l))
}

/**
 * The aligned two-column layout every list in the CLI wants: a flag and what it is for, a
 * surface and what it runs, a command and what it does.
 *
 * Below `minRight` columns of room it stacks instead — the right cell on its own indented
 * line — because a description wrapped into a four-character gutter is not a table, it is a
 * column of syllables. `addresses()` is the same shape and goes through here.
 */
export function table(rows, { indent = 4, gap = 2, minRight = 28 } = {}) {
  const cols = Math.max(20, width())
  const left = Math.max(...rows.map((r) => visibleLength(r.left)))
  const start = indent + left + gap
  const stacked = cols - start < minRight
  const pad = " ".repeat(indent)
  for (const r of rows) {
    if (!r.right) {
      out(`${pad}${r.left}\n`)
      continue
    }
    if (stacked) {
      out(`${pad}${r.left}\n`)
      for (const l of wrap(r.right, { max: cols - indent - 2 }))
        out(`${pad}  ${c.dim(l)}\n`)
      continue
    }
    const spaces = " ".repeat(left - visibleLength(r.left) + gap)
    const [first, ...more] = wrap(r.right, { max: cols - start })
    out(`${pad}${r.left}${spaces}${c.dim(first)}\n`)
    for (const l of more) out(`${" ".repeat(start)}${c.dim(l)}\n`)
  }
}

/** A titled block of two-column rows — the body of a help page. */
export function section2(title, rows) {
  if (!rows?.length) return
  spacer()
  out(`  ${c.bold(title)}\n`)
  table(rows)
}

/**
 * A titled block of pre-composed lines — a synopsis, a list of examples. Each WRAPS with a
 * hanging indent rather than clipping, so a long synopsis on a narrow terminal folds under
 * itself instead of losing the flags at the end of it (R44).
 */
export function lineBlock(title, lines) {
  if (!lines?.length) return
  spacer()
  if (title) out(`  ${c.bold(title)}\n`)
  const max = Math.max(20, width()) - 4
  for (const l of lines)
    for (const w of wrap(l, { max, hang: 2 })) out(`    ${w}\n`)
}

/** Free prose inside a help page: dim, wrapped, indented like the body. */
export function paragraph(text) {
  //`spacer()` rather than a raw newline: it is idempotent, so a paragraph directly under the
  //banner (which already ends in a blank line) does not open a second gap.
  spacer()
  for (const l of wrap(text, { max: Math.max(20, width()) - 4 }))
    out(`  ${c.dim(l)}\n`)
}

/**
 * An invocation that cannot run: the dev typed something wrong, so nothing has started and
 * there is nothing to tear down. ONE `✖` naming what was wrong, then the fix — never the whole
 * help page, which answers a question they did not ask (R6/R36).
 *
 * The `✖` line WRAPS rather than clipping, with a hanging indent that lines its continuation
 * up under the first word rather than under the glyph.
 */
export function usageFail(reason, fix = []) {
  const cols = Math.max(20, width())
  //The whole block on stderr — the glyph line, its wrapped tail, and the fix — with the blank
  //lines around it, so a redirected stdout still leaves a readable error on the terminal.
  toStderr(() => {
    spacer()
    const [first, ...more] = wrap(reason, { max: cols - 4 })
    out(`  ${c.red(GLYPH.fail)} ${first}\n`)
    for (const l of more) out(`    ${l}\n`)
    for (const f of fix)
      for (const l of wrap(f, { max: cols - 6, hang: 2 }))
        out(`    ${c.dim(l)}\n`)
    spacer()
  })
  noteFailurePrinted()
}

/**
 * Normalise whatever a step threw into the two things a failed line renders: a `reason`
 * shown INLINE on the ✖ line, and `detail` lines under it. `explain` is the CLI's
 * error interpreter (recognised causes → an actionable hint); without one we fall back to
 * the error's first line, which is at least never empty.
 */
function explained(explain, err) {
  const e = explain?.(err)
  const reason = String(e?.reason ?? err?.message ?? err)
    .split("\n")[0]
    .trim()
  return { reason, detail: e?.detail ?? [] }
}

/** The closing line — a single outcome + total. Per-platform detail rides on the
 * step/lane lines above, so there's no redundant summary block. */
export function footer(hint) {
  out(`\n  ${hint}\n\n`)
}

/** Has ANY ✖ already been rendered this run?
 *
 * Deliberately a run-scoped flag, not a mark on the error: one failure can surface as two
 * DIFFERENT error objects — the dev server rejects with a friendly "port 41720 is already
 * in use", while Node separately emits a raw `EADDRINUSE` on the socket — and an outer
 * catch receiving the second one would print a duplicate ✖ with the ugly text. The CLI
 * exits on its first failure, so "something already reported" is the honest question. */
let failuresPrinted = 0
export const noteFailurePrinted = () => {
  failuresPrinted++
}
export const anyFailurePrinted = () => failuresPrinted > 0
/** Kept for call sites that mark an error directly; both feed the same question. */
export function markReported(err) {
  if (err && typeof err === "object") err.adaptvReported = true
  noteFailurePrinted()
  return err
}
export const wasReported = (err) =>
  Boolean(err?.adaptvReported) || anyFailurePrinted()

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
  // Offer a key ONLY when pressing it would do something. Two ways this lied before:
  //   - `r`/`b` are NATIVE actions (relaunch the app on the device, reinstall the binary).
  //     On `dev web` their handlers return immediately, yet the hint still offered them —
  //     so the dev pressed them, nothing happened, and the CLI looked wedged. On web the
  //     browser reloads itself; there is no binary to rebuild.
  //   - raw mode may be unavailable (stdin isn't a TTY), in which case NO key arrives.
  // ctrl-c always works, so it is always worth saying.
  const stop = `${c.bold("ctrl-c")}${c.dim(" stop")}`
  //no leading separator: this row IS the hints now, not a suffix on `✓ watching`
  const dot = "  "
  const hint = !keys
    ? `${dot}${stop}` //web: nothing to reload or rebuild from here
    : keysAvailable()
      ? // keys bright (their own bold span), labels dim — NOT one big dim() wrapping bold
        // keys, where the bold's reset bleeds and the key ends up gray.
        `${dot}${c.bold("r")}${c.dim(" reload js")}   ${c.bold("b")}${c.dim(" rebuild app")}   ${stop}`
      : `${dot}${c.dim("keys unavailable (stdin is not a TTY) — run adaptv directly for r/b")}`
  // Just the keys. `✓ watching` restated an outcome the settled step lines already gave,
  // and the row still animates on HMR — the spinner is what says "working", not a word.
  const idleLine = hint.trimEnd() || `  ${c.dim("ctrl-c stop")}`
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
    // The activity row: a spinner while HMR applies, otherwise the keys. The keys are ALWAYS
    // the last row now — a notice used to REPLACE them, so the moment adaptv had something to
    // say the dev lost sight of `r`/`b`/`ctrl-c` entirely, which is the one row that is never
    // not relevant. Reported by the owner as the actions being swapped out.
    const busy = changed && Date.now() < clearAt
    const activity = busy
      ? `  ${c.cyan(FRAMES[frame++ % FRAMES.length])} ${c.bold("watching")}  ${c.dim(`↻ ${changed}`)}`
      : idleLine
    if (!busy) changed = null
    // A pending change gets its OWN row above, and stays until the dev acts on it.
    //`  · ` — two spaces before the dot, ONE after, the same as every settled row
    //(`✓ web  · 3.9s`). It used to pad both sides, which is the sort of drift that comes
    //from a row hand-spacing its own separator (R31).
    const rows = notice
      ? [
          `  ${c.yellow(GLYPH.notice)} ${c.bold(notice)}  ${c.dim("· ")}${c.dim("press ")}${c.bold("b")}${c.dim(" to rebuild and see the changes")}`,
          "",
          activity,
        ]
      : [activity]
    // Every draw ENDS with the cursor parked back at the top of the block, so a draw begins
    // by simply wiping from where it stands — no rewind first. (Rewinding as well walked the
    // block one row up the screen per frame, and `stop()` then erased the settled platform
    // lines above it.) Clipping keeps each row ONE physical line: a wrapped status row redrawn
    // in place stacks a copy every frame, and a block does it several rows at a time.
    out("\r\x1b[0J")
    out(rows.map((r) => clipAnsi(r, Math.max(10, width()))).join("\n"))
    if (rows.length > 1) out(`\x1b[${rows.length - 1}A`)
    out("\r")
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
      // The cursor is parked at the top of the block, so this erases the whole thing however
      // many rows it grew to — and leaves the cursor exactly where the block began, which is
      // what `rewindLines` counts back from.
      out("\r\x1b[0J")
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

/** Can this process read single keypresses? Raw mode needs a real TTY on stdin — under a
 * runner that pipes stdin (turbo without `"interactive": true` on the task, a CI job, an
 * editor's task pane) there is nothing to put in raw mode. Exported so the watcher can say
 * so instead of advertising keys that will never arrive. */
export const keysAvailable = () =>
  Boolean(process.stdin.isTTY) &&
  typeof process.stdin.setRawMode === "function"

export function onKeys({ onReload, onRebuild, onQuit }) {
  const stdin = process.stdin
  if (!keysAvailable()) return () => {}
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
        // The caller registers a process 'exit' hook that tears down anything already
        // started (e.g. the dev server running behind this picker), so exiting here is safe.
        done(() => {
          // SAY so. The picker erases itself on the way out (that is the point of it), so
          // aborting used to leave the banner, whatever notices preceded it, and then a bare
          // shell prompt — reported as *"quando a pessoa cancela algo deve aparecer… isto está
          // muito vazio"*. Erasing the prompt is right; erasing the fact that it was answered
          // is not, and the dev is left unsure whether the command did anything.
          log.warn("cancelled")
          spacer()
          process.exit(130)
        })
      }
    }
    stdin.on("data", onData)
  })
}

/**
 * A yes/no the dev has to answer before adaptv does something it can't undo — `true`, `false`,
 * or **`null` when nothing could be asked** (no TTY: CI, a pipe, an editor task runner).
 *
 * Built on `select` rather than beside it, so the two share one look and one erase (R26). The
 * `null` is the part that isn't `select`'s behaviour and is the point: `select` takes the first
 * option when it can't prompt, which is right for a device picker (any simulator will do) and
 * catastrophic for "may I overwrite these files?" — it would answer yes on the dev's behalf,
 * silently, in the one situation where nobody is watching. The caller turns `null` into a terse
 * error naming the flag that decides it non-interactively (R7).
 *
 * `message` carries the fact, so there is no `!` line above it saying the same thing (R6).
 */
export async function confirm(message, { yes, no } = {}) {
  if (!isTTY || !process.stdin.isTTY) return null
  return await select(message, [
    { value: true, label: yes ?? "yes" },
    { value: false, label: no ?? "cancel" },
  ])
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
// Product/device nouns kept capitalised after the whole line is lowercased. Everything else
// goes lowercase — the rule is: uppercase only where it genuinely means something.
const PROPER = [
  [/\biphone\b/gi, "iPhone"],
  [/\bipad\b/gi, "iPad"],
  [/\bipod\b/gi, "iPod"],
  [/\bios\b/gi, "iOS"],
  [/\bmacos\b/gi, "macOS"],
]

// Normalise a streamed tool line (Capacitor/xcodebuild/gradle) into the house voice: strip
// status emoji, drop the platform word (the lane already says it), "in 2.52ms" → "· 2.52ms",
// cut path/target clauses ("from … to …", "-> …", "to <device>", "in <path>"), lowercase
// (keeping iOS/iPhone/…), and LEAVE the verb in the present ("building", "installing") so
// the live line reads as what's happening right now — the settled ✓ line is the retrospective.
// Returns "" for anything with no real content — a lone phase-header verb ("update ios") or
// a bare `pkg@version` dump — so it's shown as nothing rather than noise.
// R24 — the phase vocabulary is CLOSED. A line tool-log didn't recognise is shown only when
// it ALREADY reads like one of its phrases: a short, lowercase, human clause. Everything else
// is the tool talking about itself, and two kinds reached the live line before this gate —
// a bundle listing (`dist/client/assets/preload-helper-rov5cbgt.js 1.19 kb │ gzip: 0.68 kb`)
// and a line of the dev's OWN SOURCE quoted by a compiler warning (`self?.tmpwindow = nil`).
// Both are identifiers wearing a phase's clothes; `--verbose` is where they belong.
const HUMAN_PHRASE = /^[a-z][a-z0-9 .·'-]{0,38}$/

export function prettyLine(line) {
  const m = line.match(/(\d{1,3})%\s+([A-Z]+)/)
  if (m) {
    const pct = Math.min(100, Number(m[1]))
    return `${bar(pct)} ${pct}%`
  }
  // xcodebuild/gradle/CocoaPods narrate in build-system vocabulary — a verb plus two
  // absolute paths, several a second. Say what the step MEANS instead; `null` = not a line
  // tool-log knows, so fall through to the generic cleanup below.
  const phase = phaseLabel(line)
  if (phase !== null) return phase
  // …and an unrecognised line still carrying an absolute path is tool-internal by
  // construction. Showing a clipped slice of somebody's home directory is worse than
  // showing nothing: "" keeps the live line on its last real phase. `--verbose` has it all.
  if (isRawToolNoise(line)) return ""
  let s = line
    .replace(/^\s*\[(capacitor|info|debug)\]\s*/i, "") // tool log prefix
    .replace(/^[\s>•·✓✔✅✗✘❌⚠–—-]+/u, "") // leading status glyphs / emoji
    .replace(/\bin\s+[\d.]+\s*(?:[µμ]s|ms|us|s|m)\b/i, "") // drop "in 2.52ms" — the duration belongs on the settled ✓ line, not the live one
    .replace(/\s*->\s*\S.*$/, "") // "-> <rest>" arrow clause
    .replace(/\s+from\s+\S+\s+to\s+\S+/i, "") // "from <path> to <path>"
    .replace(/\s+to\s+\S.*$/i, "") // trailing "to <device/path>"
    .replace(/\s+in\s+\S*\/\S+/i, "") // "in <a/path>" (a path, not the time above)
    .replace(/(^|[\s(])(?:ios|android)(?=[\s:.,)]|$)/gi, "$1") // platform word, even before punctuation
    .replace(/\bApp(\.app)?\b/g, "app") // Capacitor's generic "App" target → "app"
    .replace(/[\s:;,.]+$/, "") // trailing punctuation
    .replace(/\s+(?:for|to|from|of|on|in|with|the|a|an)$/i, "") // dangling word left behind
    .replace(/\s{2,}/g, " ")
    .trim()
  if (!s) return ""
  if (/^@?[\w-]+\/[\w.-]+@[\w.-]+$/.test(s)) return "" // a bare `pkg@version` line
  s = s.toLowerCase()
  for (const [re, rep] of PROPER) s = s.replace(re, rep)
  // Drop lines with no real action — a lone verb ("building", "running"), even with a `· time`.
  if (/^[a-z]+(\s+·.*)?$/i.test(s)) return ""
  if (!HUMAN_PHRASE.test(s)) return ""
  return s
}

/* -------------------------------------------------------------------------- */
/* the spinner renderer                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Compose one aligned line, clipping the dim right-hand detail to the width. `keep` is a
 * suffix that must survive that clip — the elapsed time, which is fixed-width and would
 * otherwise be the first thing an over-long artifact path or failure reason ate.
 */
function compose(glyph, label, right, keep = "") {
  const base = 2 + 1 + 1 + stripLen(label) + 2 // indent + glyph + gap + label + gap
  const budget = Math.max(6, width() - base - 1)
  const room = Math.max(6, budget - keep.length)
  const clipped =
    right && right.length > room ? `${right.slice(0, room - 1)}…` : right
  const detail = `${clipped}${keep}`
  return `  ${glyph} ${label}${detail ? `  ${c.dim(detail)}` : ""}`
}

/** A settled line's right-hand side, split so `compose` never clips the time away. */
// The elapsed time always arrives as `· 2.0s` — the `·` separates a row from its metadata
// (R25), and that reading shouldn't depend on whether the row happens to carry a detail.
// A step whose detail moved into an address block (`✓ web`) was rendering `✓ web  1.8s`
// while its neighbours read `✓ ios  …ipa · 5.0s`.
const settled = (left, time) =>
  left
    ? { right: left, keep: ` · ${time}` }
    : { right: "", keep: `· ${time}` }

// ANSI escape (ESC = char 27), built without a literal control char in the source.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const stripLen = (s) => s.replace(ANSI, "").length

/**
 * Run one step as a single spinner line. `fn(report)` does the work; `report(line)`
 * updates the live detail. Resolves to `fn`'s return; rejects (after marking the line
 * ✖) if it throws. In `verbose`, streams the raw lines instead of animating.
 *
 * `transient` runs the step as live feedback ONLY: the row is erased instead of settling
 * into a ✓. It's for work that the dev should watch happen but that is not a step of its
 * own — the native scaffolding, whose cost is folded (via `offsetMs`) into the platform
 * line printed further down under the SAME label. One label, one settled line.
 *
 * A failure settles as `✖ <label>  <reason> · <time>`: the ✖ line CARRIES its own reason,
 * so the caller only has to swallow the rejection — printing a second `✖ … failed — …`
 * afterwards is what used to double every glyph. `explain(err)` supplies that reason.
 */
export async function runLine(
  label,
  fn,
  {
    verbose = false,
    idle = "",
    transient = false,
    offsetMs = 0,
    explain,
  } = {},
) {
  const start = Date.now()
  let detail = "" // what the row currently SHOWS (updated at most once per dwell)
  let pending = "" // the newest phase the stream has reported
  let shownAt = 0
  let lastAt = start // when the live detail last changed — drives the idle fallback
  const report = (line) => {
    const pretty = prettyLine(line)
    if (!pretty) return
    pending = pretty
    lastAt = Date.now()
    if (verbose) out(`    ${c.dim(line)}\n`)
    //Paint the FIRST phase the moment it is announced, rather than waiting for the next
    //timer tick. The tick may never come: the launch and reload paths are `spawnSync` all
    //the way down (`simctl launch`, `open -a Simulator`, `adb`), and synchronous work blocks
    //the event loop, so `setInterval` cannot fire. The row would sit frozen on the frame
    //drawn BEFORE the work began — which is the `!detail` fallback, `preparing` — while the
    //app was already open on the device. Reported as a reload that stalls on "preparing".
    //
    //Only the first: `nextPhase` already says an empty row shows its phase at once and the
    //dwell governs REPLACING one, so this is that rule finally getting a chance to apply.
    //Later phases stay on the sampled loop, which is what stops a chatty tool strobing.
    if (!detail) repaint?.()
  }
  // Promote the newest phase only when the current one has had its turn. Called from the
  // draw loop, so the row adopts whatever is current at the window boundary.
  const tick = (now) => {
    ;({ detail, shownAt } = nextPhase({ detail, pending, shownAt }, now))
  }
  //Set to `draw` once the live row exists. Stays null off a TTY and under `--verbose`, where
  //there is no row being redrawn in place and nothing to repaint. (Named `repaint`, not
  //`paint`: that one is the module's colour helper.)
  let repaint = null

  // a step's return value, when it's a string, is its final detail (e.g. an artifact
  // path) — shown before the elapsed time on the ✓ line.
  const doneRight = (r) =>
    settled(typeof r === "string" ? r : "", elapsed(start, offsetMs))
  const failRight = (reason) => settled(reason, elapsed(start, offsetMs))
  const flat = ({ right, keep }) => `${right}${keep}`

  if (verbose || !isTTY) {
    // A transient step prints NOTHING here: there's no cursor to erase a line with off a
    // TTY, and a start/settle pair is exactly the extra step this mode exists to avoid.
    // `--verbose` still streams the raw tool output through `report` — that's its contract.
    if (!transient) out(`  ${c.dim("·")} ${label}\n`)
    try {
      const r = await fn(report)
      if (!transient)
        out(
          `  ${c.green(GLYPH.ok)} ${label}  ${c.dim(flat(doneRight(r)))}\n`,
        )
      return r
    } catch (err) {
      if (!transient) {
        const { reason, detail: why } = explained(explain, err)
        out(
          `  ${c.red(GLYPH.fail)} ${label}  ${c.dim(flat(failRight(reason)))}\n`,
        )
        detailBlock(why)
        // This failure now OWNS a ✖ on screen. An outer catch that reports again would
        // print a second glyph for one failure — and, for a rethrow that reaches the
        // top level, a raw Node message beside the calm one we just wrote
        // (`✖ server port 41720 …` followed by `✖ dev listen EADDRINUSE …`).
        markReported(err)
      }
      throw err
    }
  }

  let frame = 0
  const draw = () => {
    // Live line = just the current phase (no per-step timer — the total lands on the ✓
    // line). Nothing yet → "preparing". Once there's been output and the stream goes quiet
    // for a beat — the long opaque native build, which cap emits nothing during — fall back
    // to the caller's present-tense `idle` label instead of freezing on the last phase.
    const now = Date.now()
    tick(now)
    const phase = !detail
      ? "preparing"
      : idle && now - lastAt > IDLE_MS
        ? idle
        : detail
    out(
      `\r\x1b[2K${compose(c.cyan(FRAMES[frame++ % FRAMES.length]), label, phase)}`,
    )
  }
  repaint = draw
  draw()
  const timer = setInterval(draw, 80)
  try {
    const r = await fn(report)
    clearInterval(timer)
    // transient → erase the row (no ✓). `\r\x1b[2K` leaves the cursor at column 0 of a
    // now-blank row, so whatever prints next simply takes it over: the live line is
    // replaced by the next real step rather than pushing it down a row.
    const done = doneRight(r)
    out(
      transient
        ? "\r\x1b[2K"
        : `\r\x1b[2K${compose(c.green(GLYPH.ok), label, done.right, done.keep)}\n`,
    )
    return r
  } catch (err) {
    clearInterval(timer)
    // A failed transient step is still reported — by the caller, via `fail()`, which owns
    // the label. Marking the row too would just double the ✖.
    if (transient) {
      out("\r\x1b[2K")
      throw err
    }
    const { reason, detail: why } = explained(explain, err)
    const bad = failRight(reason)
    out(
      `\r\x1b[2K${compose(c.red(GLYPH.fail), label, bad.right, bad.keep)}\n`,
    )
    detailBlock(why)
    // This row IS the report (R2) — the same claim the non-TTY branch above makes, and it
    // has to be made on BOTH paths. Only the non-TTY one did, so on a real terminal a dev
    // server that failed to bind printed `✖ web  port 7171 …` and then, from the command's
    // outer catch, `✖ dev  port 7171 …` with the same two fix lines under it.
    markReported(err)
    throw err
  }
}

/**
 * Run several lanes concurrently, each as ONE live line (used for `run all`). A lane
 * is `{ label, run: async (report) => detailString, offsetMs?, explain? }`; `report(line)`
 * updates that lane's live detail, and the resolved string becomes its final detail. Never
 * rejects — returns `[{ ok, error }]` per lane so one platform failing doesn't stop the render.
 *
 * A lane OWNS its outcome: on failure its line settles to `✖ <label>  <reason> · <time>`
 * (from `lane.explain(err)`), so exactly one line per platform carries everything about
 * that platform. Nothing may print a per-platform failure afterwards — that's what made
 * the old output interleave two platforms and show two ✖ for one failure.
 */
export async function runLanes(lanes, { verbose = false } = {}) {
  const state = lanes.map((l) => ({
    label: l.label,
    detail: "",
    status: "run",
    start: Date.now(),
    pending: "", // newest phase reported (promoted to `detail` once per dwell)
    shownAt: 0,
    lastAt: Date.now(), // when this lane's detail last changed (idle fallback)
    idle: l.idle ?? "", // present-tense label shown once the lane's stream goes quiet
    offsetMs: l.offsetMs ?? 0, // work done for this lane before it had a line (scaffolding)
    time: "",
    reason: "", // inline failure cause, shown on this lane's own ✖ line
    why: [], // the dim lines printed under it (a fix hint / captured tail)
  }))

  const results = new Array(lanes.length)
  const settle = (i, patch) => Object.assign(state[i], patch)

  const runOne = (lane, i) => {
    const report = (line) => {
      const pretty = prettyLine(line)
      if (!pretty) return
      state[i].pending = pretty
      state[i].lastAt = Date.now()
      if (verbose) out(`    ${c.dim(`${lane.label}: ${line}`)}\n`)
      //Paint the lane's FIRST phase at once — see the same note in `runLine`. The launch and
      //reload paths are `spawnSync` throughout, so the draw timer cannot fire while they run
      //and the rows would sit frozen on `preparing` until every lane had finished.
      if (!state[i].detail) repaint?.()
    }
    return Promise.resolve()
      .then(() => lane.run(report))
      .then(
        (detail) => {
          settle(i, {
            status: "ok",
            time: elapsed(state[i].start, state[i].offsetMs),
            detail: detail ?? "",
          })
          results[i] = { ok: true }
        },
        (error) => {
          const { reason, detail } = explained(lane.explain, error)
          settle(i, {
            status: "fail",
            time: elapsed(state[i].start, state[i].offsetMs),
            detail: "",
            reason,
            why: detail,
          })
          results[i] = { ok: false, error }
          noteFailurePrinted() //this lane will render a ✖ row
        },
      )
  }

  // the settled right-hand side: "<detail|reason> · <time>" — a lane's line states its own
  // outcome, success or failure, so nothing downstream has to add a line to explain it.
  const settledRight = (s) =>
    settled(s.status === "ok" ? s.detail : s.reason, s.time)

  // Settled order: successes first, failures last (stable within each group). A failing
  // lane may print dim detail lines under itself, and those have to sit under THEIR OWN
  // platform — which is only possible if the failures are the bottom rows. Applied to the
  // final frame only; reshuffling live rows mid-run would be noise.
  const settledOrder = () =>
    state
      .map((_, i) => i)
      .sort(
        (a, b) =>
          (state[a].status === "fail" ? 1 : 0) -
          (state[b].status === "fail" ? 1 : 0),
      )

  //Set to the frame renderer once the block exists; null off a TTY, where nothing repaints.
  let repaint = null

  // verbose / non-TTY: no in-place animation, just start + settle lines.
  if (verbose || !isTTY) {
    for (const s of state) out(`  ${c.dim("·")} ${s.label}\n`)
    await Promise.all(lanes.map(runOne))
    for (const i of settledOrder()) {
      const s = state[i]
      const glyph =
        s.status === "ok" ? c.green(GLYPH.ok) : c.red(GLYPH.fail)
      const r = settledRight(s)
      out(`  ${glyph} ${s.label}  ${c.dim(`${r.right}${r.keep}`)}\n`)
      if (s.status === "fail") detailBlock(s.why)
    }
    return results
  }

  let frame = 0
  let drawn = 0
  let order = state.map((_, i) => i)
  const draw = () => {
    const now = Date.now()
    if (drawn > 0) out(`\x1b[${drawn}A`)
    for (const i of order) {
      const s = state[i]
      const glyph =
        s.status === "ok"
          ? c.green(GLYPH.ok)
          : s.status === "fail"
            ? c.red(GLYPH.fail)
            : c.cyan(FRAMES[frame % FRAMES.length])
      //Same dwell as runLine — a lane samples its stream rather than following it.
      if (s.status === "run") Object.assign(s, nextPhase(s, now))
      // live: just the current phase (nothing yet → "preparing"; idle fallback for the
      // silent build); the total lands on the settled line.
      const right =
        s.status === "run"
          ? {
              right: !s.detail
                ? "preparing"
                : s.idle && now - s.lastAt > IDLE_MS
                  ? s.idle
                  : s.detail,
              keep: "",
            }
          : settledRight(s)
      out(`\x1b[2K${compose(glyph, s.label, right.right, right.keep)}\n`)
    }
    drawn = state.length
    frame++
  }

  repaint = draw
  draw()
  const timer = setInterval(draw, 80)
  await Promise.all(lanes.map(runOne))
  clearInterval(timer)
  order = settledOrder() // failures sink to the bottom rows, so their detail can follow
  draw() // final frame with all statuses settled
  for (const i of order) {
    if (state[i].status === "fail") detailBlock(state[i].why)
  }
  return results
}
