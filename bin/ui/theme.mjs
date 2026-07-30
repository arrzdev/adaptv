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

// `text` is SPREAD STRAIGHT INTO an Ink `<Text>`, and that is the whole reason it exists.
// The roles used to carry `{ ink: "cyan" }` and the components spread that, which handed Ink a
// prop called `ink` — not one it has. Every live region rendered with NO COLOUR AT ALL for the
// whole port: no cyan spinner, no yellow `!`, no dim phase. It failed silently and looked
// deliberate, because `bold` and `dim` ARE real `<Text>` props and came through by accident,
// so the rows were merely flat rather than obviously broken.
//
// The prop is `dimColor`, NOT `dim` — Ink's name, and the reason `quiet` was flat too. Both
// mistakes are the same mistake: a prop Ink does not know is silently dropped, so the only
// honest check is the BYTES on a real terminal. `docs/CLI-UX.md` R49 has the pty one-liner.
//
// `quiet` maps to `dim` alone, NOT `color: "gray"` plus dim. The settled rows are written by the
// string renderer as ANSI 2 (dim), and a live row that is gray AND dim visibly changes shade the
// moment it settles into a ✓. The two halves have to agree — that is what `ansi` is here for.
export const ROLE = {
  /** The word `adaptv`, once per command. */
  brand: { ansi: 35, text: { color: "magenta", bold: true } },
  /** `✓` */
  ok: { ansi: 32, text: { color: "green" } },
  /** `✖` */
  fail: { ansi: 31, text: { color: "red" } },
  /** `!` */
  notice: { ansi: 33, text: { color: "yellow" } },
  /** The spinner — work in progress. */
  busy: { ansi: 36, text: { color: "cyan" } },
  /** Timings, detail, hints, descriptions, paths. MOST of the page. */
  quiet: { ansi: 2, text: { dimColor: true } },
  /** A heading, a device name — emphasis that is not a thing you can press. */
  strong: { ansi: 1, text: { bold: true } },
  /**
   * A KEY THE DEV CAN PRESS: `r`, `b`, `ctrl-c`, `↑↓`, `↵`.
   *
   * Its own role rather than `strong`, because it is the one thing on the page that is not a
   * statement — it is an offer. Bold alone left the keys reading as ordinary emphasis in a row
   * that is otherwise all dim label. Cyan is deliberate and not a clash: it is already "adaptv
   * is working", and a key is "adaptv can work for you" — the same actor, a different tense.
   * The spinner and the keys never share a row (the watch block renders one or the other), so
   * the two never appear at once. If that ever changes, split this off its own colour.
   */
  key: { ansi: 36, text: { color: "cyan", bold: true } },
}

/* -----------------------------------------------------------------------------
 * the phase vocabulary adaptv speaks about ITSELF
 *
 * A live row shows one of two things: a phase adaptv chose (`syncing`, `packaging`) or a line
 * of xcodebuild/gradle output mapped into one. The second kind is filtered hard — a lone verb,
 * a hex digest or a path is noise, and showing it flickers the row to a stop on nothing.
 *
 * Those two went through the same filter, and it swallowed adaptv's own words: they are single
 * verbs, so "drop a lone verb" dropped them. The row then sat on `preparing` for the entire
 * `cap sync` — a step that can run for seconds — because the phase announcing it never
 * survived. This list is how a deliberate phase is told apart from a line a build tool printed.
 *
 * EVERY entry is a present participle: what is happening RIGHT NOW, to someone watching. Two of
 * these used to be bare nouns — `sync` and `package` — which read as a command being issued
 * rather than work being done, and sat oddly beside `compiling` and `launching device` on the
 * very same row. `package` was a duplicate of `packaging` on top of that.
 * -------------------------------------------------------------------------- */

export const OWN_PHASES = new Set([
  "building app",
  "launching device",
  "linking plugins",
  "linking server",
  "packaging",
  "preparing",
  "preparing build",
  "processing resources",
  "relaunching device",
  "reloading device",
  "starting server",
  "syncing",
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

//NO idle-fallback constant here, and none wanted. A row used to drop back to a per-lane label
//after this long without output; it read as the build restarting — `building app → compiling →
//building app`. A row now holds its last phase, and silence changes nothing.

/** How long an HMR flash stays on the watch row before it settles back to the keys. */
export const HMR_FLASH_MS = 900

//NO live elapsed constant here on purpose. A running clock on a live row was tried and
//removed: the spinner already says the row is alive, and a number ticking in place is motion
//with no information in it. The duration is stated once, on the settled row.

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
