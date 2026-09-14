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
 * @typedef {{
 *   native: Record<string, string> | null,
 *   config: string | null,
 *   cli: string,
 *   restart: boolean,
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
  return { native: null, config: null, cli, restart: false }
}

/**
 * The installed app now matches what the dev wrote: a launch or a `b` rebuild re-applied the
 * native project and the config. Only those two re-arm — a rebuild runs with the modules this
 * process already loaded, so it applies nothing of adaptv's own source.
 * @param {Staleness} state
 * @param {{ native: Record<string, string>, config: string }} armed
 * @returns {Staleness}
 */
export function armStale(state, { native, config }) {
  return { ...state, native, config }
}

/**
 * One poll. `notice` is the row to draw, or `null` when nothing moved since the last poll and
 * the row stays as it is. Each fingerprint re-arms, so one edit notices once.
 * @param {Staleness} state
 * @param {{ native: Record<string, string>, config: string, cli: string }} now
 * @param {string[]} platforms
 * @returns {{ state: Staleness, notice: Notice | null }}
 */
export function pollStale(state, now, platforms) {
  const changed = platforms.filter(
    (p) => now.native[p] !== state.native?.[p],
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
  }
  // ONE row, one line (R31) — so config and native MERGE rather than one winning the slot
  // (R40). adaptv's own source is the exception and WINS the row: a restart re-reads the
  // config and re-syncs native too, so naming that superset action is the honest line.
  if (next.restart) return { state: next, notice: RESTART_NOTICE }
  return {
    state: next,
    notice: {
      text:
        configChanged && changed.length > 0
          ? `config + native change · ${changed.join(", ")}`
          : configChanged
            ? "config change"
            : `native change · ${changed.join(", ")}`,
      restart: false,
    },
  }
}

/**
 * The row a FRESH watch block opens with — after a `b` rebuild, an `r` reload, or a rebuild
 * that failed. Every one of them mounts a new block, and a new block starts empty, so without
 * this the restart row came down with the first `b` and nothing raised it again. Only the
 * restart comes back. After `b` that is right, because `b` re-armed config and native; after `r`
 * or a failed rebuild a pending config or native row is still lost, as it was before (R41).
 * @param {Staleness} state
 * @returns {Notice | null}
 */
export function standingNotice(state) {
  return state.restart ? RESTART_NOTICE : null
}
