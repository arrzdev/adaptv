// The Vite dev server for live-reload runs. adaptv starts `vite` (so vite.config —
// port, host, plugins — all apply) and DETECTS the URL it actually bound from Vite's
// own startup banner, instead of requiring a --port. That way the port can come from
// a --port flag (passed through after `--`), vite.config's `server.port`, or Vite's
// default, and the native side is always pointed at the right place. → live-reload PR.
import { spawn } from "node:child_process"
import { localBin } from "./native.mjs"

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const strip = (s) => s.replace(ANSI, "")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
 * socket they open is stable. → live-reload PR / RENDERING.md (iOS HMR).
 *
 * Detection is version-agnostic: while Vite is (re)optimizing, `/` hangs or returns an
 * empty body; once stable it returns the full document. We require two good reads in a
 * row, then a short settle so any post-optimize reload broadcast passes with no client
 * attached. Best-effort: returns `true` if it confirmed stability, `false` on timeout
 * (the caller still proceeds — worst case is the pre-fix behavior).
 */
export async function warmDevServer(
  url,
  { timeoutMs = 30000, onLine } = {},
) {
  const start = Date.now()
  let good = 0
  while (Date.now() - start < timeoutMs) {
    let ok = false
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
      const body = await res.text()
      ok = res.ok && body.length > 500
    } catch {
      ok = false
    }
    if (ok) {
      good += 1
      if (good >= 2) {
        // let Vite's post-optimize `full-reload` broadcast fire while nothing is
        // connected, so it can't knock out a WebView's socket after launch.
        await sleep(1000)
        onLine?.("dev server stable")
        return true
      }
    } else {
      good = 0
    }
    await sleep(900)
  }
  onLine?.("dev server warm timed out — launching anyway")
  return false
}

/**
 * Start `vite` (dev) and resolve once it reports a ready URL. `args` is passed through
 * verbatim (the `-- …` passthrough). `onLine` receives every output line (so the
 * caller can stream HMR logs). Resolves `{ localUrl, networkUrl, host, port, stop() }`;
 * rejects if Vite exits before becoming ready.
 */
export function startDevServer(
  appRoot,
  { args = [], env = {}, onLine } = {},
) {
  const local = localBin(appRoot, "vite")
  const cmd = local ?? "npx"
  const pre = local ? [] : ["--yes", "vite"]
  // `--strictPort`: fail FAST if the dev port is taken instead of silently hopping to
  // the next one. A native run pins the WebViews to one detected URL, so a silent port
  // change would point them at the wrong (or a stranger's) server — better to error
  // clearly (see the EADDRINUSE message below) and let the dev free the port or pass
  // `-- --port <n>`. Appended last so it wins over anything in the passthrough.
  const viteArgs = [...pre, ...args, "--strictPort"]

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
      // Vite prints e.g. "➜  Local:   http://localhost:5173/"
      const local = text.match(/Local:\s+(https?:\/\/\S+)/)
      if (!local) return
      const network = text.match(/Network:\s+(https?:\/\/\S+)/)
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
      const errs = buffer.filter((l) =>
        /error|EADDRINUSE|in use|fail|cannot|not found/i.test(l),
      )
      // A busy port is the common case (a second `adaptv dev`, the app's own
      // `pnpm dev`, or a stale process). Name it plainly instead of a raw stack.
      // greedy up to the LAST colon so we grab the port (9220), not an IP octet (127).
      const inUse = buffer
        .join("\n")
        .match(/EADDRINUSE[^\n]*:(\d{2,5})\b/i)
      const err = new Error(
        inUse
          ? `port ${inUse[1]} is already in use — another dev server is running ` +
              "(another `adaptv dev`, the app's `pnpm dev`, or a stale process). " +
              "Stop it, then retry. Only one adaptv dev server can run at a time."
          : `vite dev exited (code ${code}) before it was ready`,
      )
      err.tail = (errs.length ? errs : buffer).slice(-15).join("\n")
      reject(err)
    })
  })
}
