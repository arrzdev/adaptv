// The keys of a `dev` session, and the one way they end it.
//
// Its own module, and not three lines inside `runLive`, because `bin/adaptv.mjs` runs the CLI
// on import and nothing in it can be tested. Both halves of this have been wrong there:
//
// WHO LISTENS. The keys used to be the Ink watch block's own `useInput`, and `r` and `b` take
// that block off the screen for as long as they run. Ink hands the terminal back to cooked mode
// when it unmounts, so a `q` pressed during a reload was echoed as a literal `q`, never read,
// and the session ran on until a SIGINT (R73). The listener is the SESSION's now, whichever
// renderer draws the block; the block only draws the keys row.
//
// WHAT A QUIT STOPS. Raw mode turns ctrl-c into a byte, not the SIGINT a cooked terminal sends
// the whole foreground process group — and that SIGINT is what used to stop the tools a step
// was running. So a quit stops the step's children first (`stopChildren`: each leads its own
// process group, so what they started stops with them), then tears down. Not a signal to
// adaptv's own process group: that also reaches whoever launched adaptv (the package manager's
// wrapper, which then reports the run as interrupted), and on Windows a pid of 0 is adaptv
// itself, killed before its teardown could run.
import { stopChildren as stopEveryChild } from "./exec.mjs"
import { onKeys } from "./render.mjs"

/**
 * The quit every key takes: stop whatever a step still has running, then `onSigint`. In that
 * order, and with nothing awaited between them — `onSigint` exits, so a step that rejects
 * because its tool was stopped never gets an event-loop turn in which to print its `✖`.
 *
 * `onSigint` stops the children too, first thing, because a real signal reaches it without
 * passing through here. The stop is repeated here anyway, and the second call finds nothing
 * left to stop: `onSigint` lives in `bin/adaptv.mjs`, which no test can import, so this is the
 * one place the key path's order is pinned by a test rather than by a comment.
 * @param {() => void} onSigint the session's teardown-and-exit
 * @param {() => void} [stopChildren]
 */
export function quitSession(onSigint, stopChildren = stopEveryChild) {
  return () => {
    stopChildren()
    onSigint()
  }
}

/**
 * Listen for `r` / `b` / `q` / ctrl-c for the whole session. Returns the disposer.
 * @param {{ onReload: () => unknown, onRebuild: () => unknown, onSigint: () => void,
 *   stopChildren?: () => void, listen?: typeof onKeys }} opts
 */
export function sessionKeys({
  onReload,
  onRebuild,
  onSigint,
  stopChildren = stopEveryChild,
  listen = onKeys,
}) {
  return listen({
    onReload,
    onRebuild,
    onQuit: quitSession(onSigint, stopChildren),
  })
}
