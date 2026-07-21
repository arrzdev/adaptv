// The Vite dev server for live-reload runs. nativ starts `vite` (so vite.config —
// port, host, plugins — all apply) and DETECTS the URL it actually bound from Vite's
// own startup banner, instead of requiring a --port. That way the port can come from
// a --port flag (passed through after `--`), vite.config's `server.port`, or Vite's
// default, and the native side is always pointed at the right place. → live-reload PR.
import { spawn } from "node:child_process"
import { localBin } from "./native.mjs"

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")
const strip = (s) => s.replace(ANSI, "")

/**
 * Start `vite` (dev) and resolve once it reports a ready URL. `args` is passed through
 * verbatim (the `-- …` passthrough). `onLine` receives every output line (so the
 * caller can stream HMR logs). Resolves `{ localUrl, networkUrl, host, port, stop() }`;
 * rejects if Vite exits before becoming ready.
 */
export function startDevServer(appRoot, { args = [], onLine } = {}) {
  const local = localBin(appRoot, "vite")
  const cmd = local ?? "npx"
  const pre = local ? [] : ["--yes", "vite"]

  return new Promise((resolve, reject) => {
    // detached → its own process group, so stop() can kill vite AND its children
    // (the cloudflare/inspector workers that otherwise survive SIGINT and hold ports).
    const child = spawn(cmd, [...pre, ...args], {
      cwd: appRoot,
      env: process.env,
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
      const err = new Error(
        `vite dev exited (code ${code}) before it was ready`,
      )
      err.tail = (errs.length ? errs : buffer).slice(-15).join("\n")
      reject(err)
    })
  })
}
