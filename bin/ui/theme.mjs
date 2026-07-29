// The executable half of `docs/CLI-VISUAL.md`.
//
// Every visual constant the CLI has lives here — the indents, the glyph set, the colour roles,
// the spinner. Components import these rather than writing `"  "` or `"✓"` inline, so the
// design system is a thing the code depends on rather than a thing the code is supposed to
// remember. If this file and the document disagree, the document wins and this is a bug.
//
// Deliberately data, with no imports: it is the one module both the Ink components and the
// string renderer can share while the port is in progress, so the two cannot drift apart on
// the way.

/* -----------------------------------------------------------------------------
 * the grid
 * -------------------------------------------------------------------------- */

/** Every top-level row. Two spaces, always. */
export const INDENT = 2
/** Detail hanging under a row: dim, and one level deeper. */
export const DETAIL_INDENT = 4
/** The fallback width when stdout is not a terminal (a pipe, a CI log). */
export const DEFAULT_COLUMNS = 80
/** ` · ` — two spaces before, one after. Opens the right-hand metadata column. */
export const META = " · "

/* -----------------------------------------------------------------------------
 * the glyph set — CLOSED
 *
 * These four and no others. The heavy check mark, the ballot X and the warning sign are all
 * banned: a second vocabulary is how `doctor` once came to look like a different program, and
 * `bin/lib/engine.test.mjs` fails the build on those three characters — including, as this
 * comment discovered, when they appear in a comment explaining that they are banned.
 * -------------------------------------------------------------------------- */

export const GLYPH = {
  ok: "✓",
  fail: "✖",
  /** Something the dev may need to act on. There is no glyphless second severity. */
  notice: "!",
  /** `doctor` only: an optional tool that is absent, which is not a failure. */
  absent: "○",
}

/** The braille spinner. One set, one speed. */
export const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
/** Frame interval. Fast enough to read as motion, slow enough not to strobe. */
export const FRAME_MS = 80

/* -----------------------------------------------------------------------------
 * colour, as ROLE
 *
 * Never decoration. The test for whether you have used it as decoration is `NO_COLOR=1`: if
 * the output loses meaning rather than just colour, the colour was carrying something it
 * should have said in words.
 *
 * Ink takes colour names; the string renderer takes ANSI codes. Both are here so the ROLES are
 * defined once and each renderer reads its own dialect.
 * -------------------------------------------------------------------------- */

export const ROLE = {
  /** The word `adaptv`, once per command. */
  brand: { ink: "magenta", bold: true, ansi: 35 },
  /** `✓` */
  ok: { ink: "green", ansi: 32 },
  /** `✖` */
  fail: { ink: "red", ansi: 31 },
  /** `!` */
  notice: { ink: "yellow", ansi: 33 },
  /** The spinner — work in progress. */
  busy: { ink: "cyan", ansi: 36 },
  /** Timings, detail, hints, descriptions, paths. MOST of the page. */
  quiet: { ink: "gray", dim: true, ansi: 2 },
  /** A heading, a key to press, a device name. */
  strong: { ink: undefined, bold: true, ansi: 1 },
}

/* -----------------------------------------------------------------------------
 * the phase vocabulary adaptv speaks about ITSELF
 *
 * A live row shows one of two things: a phase adaptv chose (`sync`, `packaging`) or a line of
 * xcodebuild/gradle output mapped into one. The second kind is filtered hard — a lone verb, a
 * hex digest or a path is noise, and showing it flickers the row to a stop on nothing.
 *
 * Those two went through the same filter, and it swallowed adaptv's own words: `sync`,
 * `package` and `packaging` are single verbs, so "drop a lone verb" dropped them. The row then
 * sat on `preparing` for the entire `cap sync` — a step that can run for seconds — because the
 * phase announcing it never survived. This list is how a deliberate phase is told apart from a
 * line a build tool happened to print.
 * -------------------------------------------------------------------------- */

export const OWN_PHASES = new Set([
  "building app",
  "launching device",
  "linking plugins",
  "linking server",
  "package",
  "packaging",
  "preparing",
  "preparing build",
  "processing resources",
  "relaunching device",
  "reloading device",
  "starting server",
  "sync",
])

/* -----------------------------------------------------------------------------
 * timing
 * -------------------------------------------------------------------------- */

/**
 * How long a phase must hold a row before another may replace it.
 *
 * The native toolchains change phase several times a second — one iOS build rewrote its row
 * 105 times in 13s, alternating compiling↔processing resources as it walked the pods. Each
 * line was individually true and the effect was an unreadable strobe. So a row SAMPLES the
 * stream rather than following it.
 */
export const PHASE_DWELL_MS = 700

/** Silence after which a live row falls back to its present-tense idle label. */
export const IDLE_MS = 1200

/** How long an HMR flash stays on the watch row before it settles back to the keys. */
export const HMR_FLASH_MS = 900

/** A row runs longer than this before it starts showing how long it has been running. */
export const ELAPSED_AFTER_MS = 10_000

/* -----------------------------------------------------------------------------
 * layout rules with a number in them
 * -------------------------------------------------------------------------- */

/**
 * Below this many columns of room, a two-column table stacks instead of aligning — the
 * description goes on its own indented line under the name. A description wrapped into a
 * four-character gutter is not a table, it is a column of syllables.
 */
export const MIN_RIGHT_COLUMN = 28

/** Gap between the two columns of a table. */
export const COLUMN_GAP = 2

/** How much captured tool output a failed row expands into before it becomes `--verbose`. */
export const DETAIL_LINES = 10
