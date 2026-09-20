// What the `dev` watch block says about edits it cannot hot-reload, as pure functions.
//
// The poll that decides it used to be inline in `runLive`, three fingerprint variables and a
// notice call, which is why nothing caught the row demoting itself: a change to adaptv's OWN
// source must say `restart to apply` until the process restarts (R54), and the inline poll
// forgot it the moment a later poll saw a config edit, or a `b` opened a fresh block. Here the
// staleness is one value that `runLive` threads through, so `watch-staleness.test.mjs` can
// assert the row after any order of edits and rebuilds without a device or a dev server.

/** The row a change to adaptv's own source raises, and it wins over every other cause (R54). */
export const RESTART_NOTICE = Object.freeze({
  text: "adaptv source change",
  restart: true,
})

/**
 * The fingerprints (`native`, `config`, `cli`) are what the last poll saw, and re-arm every
 * poll so one edit notices once. What the row OWES is kept apart from them, because it outlives
 * the poll that raised it: `restart` until the process restarts, and `pending` — the config and
 * the native platforms edited since the last `b` — until a `b` applies them (R40, R41).
 * @typedef {{
 *   native: Record<string, string> | null,
 *   config: string | null,
 *   cli: string,
 *   restart: boolean,
 *   pending: { config: boolean, native: readonly string[] },
 * }} Staleness
 * @typedef {{ text: string, restart: boolean }} Notice
 */

/**
 * A run's staleness at startup: `cli` is the fingerprint of the modules this process just
 * loaded. `native` and `config` stay unarmed until the platforms are ready (`armStale`).
 * @param {string} cli
 * @returns {Staleness}
 */
export function initialStale(cli) {
  return {
    native: null,
    config: null,
    cli,
    restart: false,
    pending: { config: false, native: [] },
  }
}

/**
 * A launch or a `b` rebuild finished its platform lanes. The fingerprints re-arm to what is on
 * disk now, every one of them — the lanes' own prepare rewrote the native tree, and an edit
 * already owed must not notice a second time. What clears is only what reached a device:
 * `applied` is the platforms whose lane succeeded, so a failed lane keeps its native cause.
 * The config reaches a device only THROUGH those lanes (the prepare re-derives its assets and
 * the sync writes its plugins), never through the web bundle alone, so it clears only when
 * every platform in `native` was applied.
 *
 * `before` is what a `b` read off the tree when it began, before its preflight re-stamped
 * anything. It is folded in first, as a poll that raises no notice: an edit saved and
 * followed by `b` inside the poll interval was never recorded, and the re-arm below would
 * step past it, so a lane that failed would owe nothing for it. The fresh block the `b` opens
 * draws whatever it leaves owed. A launch has no `before`: nothing was armed to compare with,
 * and the lanes read the files as they are.
 *
 * A rebuild runs with the modules this process already loaded, so it applies nothing of
 * adaptv's own source. `r`, and a `b` whose web bundle failed before any lane ran, apply
 * nothing at all and never call this.
 * @param {Staleness} state
 * @param {{
 *   before?: { native: Record<string, string>, config: string, cli: string },
 *   native: Record<string, string>,
 *   config: string,
 *   applied: readonly string[],
 * }} armed
 * @returns {Staleness}
 */
export function armStale(state, { before, native, config, applied }) {
  const seen = before
    ? pollStale(state, before, Object.keys(native)).state
    : state
  const all = Object.keys(native).every((p) => applied.includes(p))
  return {
    ...seen,
    native,
    config,
    pending: {
      config: seen.pending.config && !all,
      native: seen.pending.native.filter((p) => !applied.includes(p)),
    },
  }
}

/**
 * One poll. `notice` is the row to draw, or `null` when nothing moved since the last poll and
 * the row stays as it is. Each fingerprint re-arms, so one edit notices once; the row it
 * draws names every cause still pending, not only the ones this poll saw.
 * @param {Staleness} state
 * @param {{ native: Record<string, string>, config: string, cli: string }} now
 * @param {string[]} platforms
 * @param {string[]} [staleInstalls] platforms whose reused install the device proved to be
 *   another build — a native change in everything that matters, whatever the fingerprint says
 * @returns {{ state: Staleness, notice: Notice | null }}
 */
export function pollStale(state, now, platforms, staleInstalls = []) {
  const changed = platforms.filter(
    (p) => now.native[p] !== state.native?.[p] || staleInstalls.includes(p),
  )
  const configChanged = now.config !== state.config
  const cliChanged = now.cli !== state.cli
  if (changed.length === 0 && !configChanged && !cliChanged)
    return { state, notice: null }
  const next = {
    native: now.native,
    config: now.config,
    cli: now.cli,
    //LATCHED. The source fingerprint re-arms so one edit notices once, but the restart it
    //raised is still owed: nothing short of a new process loads the edited modules.
    restart: state.restart || cliChanged,
    //ACCUMULATED, for the same reason: the poll that saw a config edit re-armed its
    //fingerprint, and a later poll that sees only a native edit must not forget it (R40).
    //Platforms keep the order a single poll names them in.
    pending: {
      config: state.pending.config || configChanged,
      native: platforms.filter(
        (p) => state.pending.native.includes(p) || changed.includes(p),
      ),
    },
  }
  return { state: next, notice: standingNotice(next) }
}

/**
 * The row the watch block owes, and so the row a FRESH block opens with — after a `b` rebuild,
 * an `r` reload, or a rebuild that failed. Every one of them mounts a new block, and a new block
 * starts empty, so without this the row came down with a key that applied none of it (R41).
 * After a `b` whose lanes all succeeded only the restart is left; after one with a failed lane,
 * that platform and the config it never received are left too.
 *
 * ONE row, one line (R31) — so config and native MERGE rather than one winning the slot (R40).
 * adaptv's own source is the exception and WINS the row: a restart re-reads the config and
 * re-syncs native too, so naming that superset action is the honest line.
 * @param {Staleness} state
 * @returns {Notice | null}
 */
export function standingNotice(state) {
  if (state.restart) return RESTART_NOTICE
  const { config, native } = state.pending
  if (!config && native.length === 0) return null
  return {
    text:
      config && native.length > 0
        ? `config + native change · ${native.join(", ")}`
        : config
          ? "config change"
          : `native change · ${native.join(", ")}`,
    restart: false,
  }
}
