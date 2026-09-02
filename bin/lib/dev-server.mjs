// The Vite dev server for live-reload runs. adaptv starts `vite` (so vite.config —
// port, host, plugins — all apply) and DETECTS the URL it actually bound from Vite's
// own startup banner, instead of requiring a --port. That way the port can come from
// a --port flag (passed through after `--`), vite.config's `server.port`, or Vite's
// default, and the native side is always pointed at the right place. → live-reload PR.
import { spawn } from "node:child_process"
import { localBin } from "./native.mjs"

/** @typedef {import("./exec.mjs").CliError} CliError */

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const strip = (s) => s.replace(ANSI, "")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * What the warm reads the time from and waits by.
 *
 * Real time by default. A test hands in a virtual one so it can assert on the settle
 * `warmDevServer` CHOSE — the exact milliseconds — instead of sleeping through the real
 * thing and reading a wall clock afterwards, which is how the unit suite came to spend
 * thirteen seconds proving that one branch picks 1000 and the other 150.
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} Clock
 */

/** @type {Clock} */
export const realClock = { now: () => Date.now(), sleep }

/**
 * Warm the dev server until it is STABLE, before any native WebView attaches.
 *
 * Vite re-optimizes its dependency graph on the first real request ("Re-optimizing
 * dependencies because vite config has changed"); when that finishes it broadcasts a
 * `full-reload` to every connected client. Android's Chromium WebView survives that
 * reload and reconnects its HMR socket — but iOS WKWebView does NOT: it drops the
 * socket and never recovers, so the app freezes at its first paint and ignores every
 * later edit. The failure only happens because `cap run` launches the WebView DURING
 * this window. So we trigger the optimize ourselves and wait for the server to go
 * quiet FIRST — by the time the native apps launch, the graph is optimized and the
 * socket they open is stable. → live-reload PR / docs/design/rendering.md (iOS HMR).
 *
 * Detection is version-agnostic: while Vite is (re)optimizing, `/` hangs or returns an
 * empty body; once stable it returns the full document. We require two good reads in a
 * row, then a short settle so any post-optimize reload broadcast passes with no client
 * attached.
 *
 * Returns a VERDICT, not a boolean — `{ ok: true }`, or `{ ok: false, why, status }` naming
 * what the last unhealthy read actually saw:
 *
 *   `unreachable` — nothing answered at all (connection refused, or the read timed out).
 *   `error`       — the server answered, with a 4xx/5xx. The port is OURS and the APP is
 *                   broken; its own output already says how.
 *   `thin`        — a 2xx, but too small to be the document. Something else is on the port.
 *
 * A boolean could not tell those apart, so the caller worded all three as "another process
 * is likely using that port" — which is wrong for `error`, the common case, and sent the
 * dev hunting a port collision that never happened. See `devServerUnhealthy` in adaptv.mjs.
 */
/**
 * Did Vite say it was re-optimizing? The trailing settle exists ONLY for the reload that
 * follows an optimize, so this is the question that decides whether it is needed.
 *
 * Version-agnostic on purpose: Vite has reworded these over releases, so match the stems it
 * has always used rather than a whole sentence.
 */
export const SAW_OPTIMIZE =
  /(re-?optimiz|new dependencies optimized|optimized dependencies changed|dependencies updated)/i

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, onLine?: (line: string) => void, sawOptimize?: () => boolean, clock?: Clock }} [opts]
 */
export async function warmDevServer(
  url,
  {
    timeoutMs = 30000,
    onLine,
    sawOptimize = () => true,
    clock = realClock,
  } = {},
) {
  const start = clock.now()
  let good = 0
  // What the most recent UNHEALTHY read saw. Overwritten only on a bad read, so a warm that
  // goes good→bad→timeout reports the failure and not the last read of all. Seeded with the
  // pessimistic case so the verdict is always worded, even if the loop never gets a read in.
  let last = { why: "unreachable" }
  while (clock.now() - start < timeoutMs) {
    let ok = false
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const body = await res.text()
      ok = res.ok && body.length > 500
      if (!ok)
        last = { why: res.ok ? "thin" : "error", status: res.status }
    } catch {
      ok = false
      last = { why: "unreachable" }
    }
    if (ok) {
      good += 1
      if (good >= 2) {
        // Let Vite's post-optimize `full-reload` broadcast fire while nothing is connected,
        // so it can't knock out a WebView's socket after launch.
        //
        // ONLY when there was an optimize. That broadcast is the entire reason for the wait,
        // and on a warm `node_modules/.vite` — the overwhelmingly common case — Vite never
        // re-optimizes and there is no broadcast to miss. A flat second on every native `dev`
        // was paying the cold-start price on every warm start. A short settle still covers the
        // scheduling gap between the last good read and the launch.
        await clock.sleep(sawOptimize() ? 1000 : 150)
        onLine?.("dev server stable")
        return { ok: true }
      }
    } else {
      good = 0
    }
    await clock.sleep(900)
  }
  //NOT "launching anyway" any more: the caller aborts the run on this verdict, and a line
  //promising the opposite is the kind of thing a dev reads once under `--verbose` and
  //believes for a year.
  onLine?.("dev server warm timed out")
  return { ok: false, ...last }
}

/** How long a `Local:` line waits for the `Network:` line under it. See `handle`. */
const NETWORK_GRACE_MS = 250
/** Re-entry into `handle` with nothing to add — it re-reads what has been seen so far. */
const EMPTY = Buffer.alloc(0)

/**
 * Start `vite` (dev) and resolve once it reports a ready URL. `args` is passed through
 * verbatim (the `-- …` passthrough). `onLine` receives every output line (so the
 * caller can stream HMR logs). Resolves `{ localUrl, networkUrl, host, port, stop() }`;
 * rejects if Vite exits before becoming ready.
 * @param {string} appRoot
 * @param {{ args?: string[], env?: NodeJS.ProcessEnv, onLine?: (line: string) => void, host?: boolean }} [opts]
 */
export function startDevServer(
  appRoot,
  { args = [], env = {}, onLine, host = false } = {},
) {
  const local = localBin(appRoot, "vite")
  const cmd = local ?? "npx"
  const pre = local ? [] : ["--yes", "vite"]
  // `--host` (external mode): bind every interface (0.0.0.0) so a physical device on the
  // same Wi-Fi can reach the dev server on this machine's LAN IP. Off by default — the
  // sim/emulator path uses localhost + `adb reverse`, which needs no LAN exposure.
  const hostArgs = host ? ["--host"] : []
  // `--strictPort`: fail FAST if the dev port is taken instead of silently hopping to
  // the next one. A native run pins the WebViews to one detected URL, so a silent port
  // change would point them at the wrong (or a stranger's) server — better to error
  // clearly (see the EADDRINUSE message below) and let the dev free the port or pass
  // `-- --port <n>`. Appended last so it wins over anything in the passthrough.
  const viteArgs = [...pre, ...args, ...hostArgs, "--strictPort"]

  return new Promise((resolve, reject) => {
    // detached → its own process group, so stop() can kill vite AND its children
    // (the cloudflare/inspector workers that otherwise survive SIGINT and hold ports).
    const child = spawn(cmd, viteArgs, {
      cwd: appRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    })
    const stop = () => {
      try {
        process.kill(-child.pid, "SIGINT")
      } catch {
        try {
          child.kill("SIGINT")
        } catch {}
      }
    }

    let ready = false
    let grace = null // the one beat given to a `Network:` line that hasn't landed yet
    const buffer = []
    const handle = (buf) => {
      const text = strip(buf.toString())
      for (const line of text.split("\n")) {
        const l = line.trim()
        if (!l) continue
        buffer.push(l)
        if (buffer.length > 200) buffer.shift()
        onLine?.(l)
      }
      if (ready) return
      // Vite prints e.g. "➜  Local:   http://localhost:5173/", then `Network:` under it.
      // Matched against everything seen SO FAR rather than this chunk: the two lines are
      // one write from Vite and were read as one, until the pipe split them and the URL
      // block arrived across two 'data' events.
      const seen = buffer.join("\n")
      const local = seen.match(/Local:\s+(https?:\/\/\S+)/)
      if (!local) return
      const network = seen.match(/Network:\s+(https?:\/\/\S+)/)
      // `Network:` comes AFTER `Local:`, so a split leaves it unseen at the moment the
      // promise would resolve — and `networkUrl` is then null forever, on a server that IS
      // bound to the LAN. The address block silently loses its `network` row and a phone on
      // the same Wi-Fi has no URL to type. So when we asked to bind every interface, give
      // the second line one beat before settling for what we have. Costs nothing in the
      // normal case (both lines are already here) and cannot hang: the timer resolves.
      if (host && !network && !grace) {
        grace = setTimeout(() => handle(EMPTY), NETWORK_GRACE_MS)
        grace.unref?.()
        return
      }
      clearTimeout(grace)
      const url = new URL(local[1])
      ready = true
      resolve({
        localUrl: local[1].replace(/\/$/, ""),
        networkUrl: network?.[1]?.replace(/\/$/, "") ?? null,
        host: url.hostname,
        port: url.port || (url.protocol === "https:" ? "443" : "80"),
        child,
        stop,
      })
    }

    child.stdout.on("data", handle)
    child.stderr.on("data", handle)
    child.on("error", reject)
    child.on("exit", (code) => {
      if (ready) return
      // surface WHY vite couldn't start (e.g. a port already in use), preferring the
      // error lines from its output over the generic exit message.
      //
      // Anchored on the FIRST error line and kept as a BLOCK, not filtered
      // line-by-line: a multi-line error carries its actionable half on
      // continuation lines that match none of these keywords. adaptv's own
      // removed-config-key guard is the case in point — a per-line filter kept
      // "sets 1 key that adaptv no longer reads:" and dropped every line telling
      // you which key and what to do instead, i.e. the only part worth printing.
      const firstErr = buffer.findIndex((l) =>
        /error|EADDRINUSE|in use|fail|cannot|not found/i.test(l),
      )
      const errs =
        firstErr === -1 ? [] : buffer.slice(firstErr, firstErr + 20)
      // A busy port is the common case (a second `adaptv dev`, the app's own `pnpm dev`,
      // a stale worker). It is NOT worded here: `explainFailure` says it, once, for the
      // dev server and the preview server and a build that dies the same way — three
      // copies of one sentence is how the ✖ for one cause ends up reading three ways
      // (R26). The EADDRINUSE line is in the tail below, which is what it reads.
      /** @type {CliError} */
      const err = new Error(
        `vite dev exited (code ${code}) before it was ready`,
      )
      //an error block is kept from its START (the headline plus what follows);
      //the generic fallback still shows the tail, where a crash usually lands.
      err.tail = (errs.length ? errs : buffer.slice(-15)).join("\n")
      reject(err)
    })
  })
}
