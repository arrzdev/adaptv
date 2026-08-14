// @vitest-environment node
import { createServer } from "node:http"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  SAW_OPTIMIZE,
  startDevServer,
  warmDevServer,
} from "./dev-server.mjs"

// `@vitest-environment node` at the top is load-bearing: the suite defaults to happy-dom, and
// under it a real HTTP server plus `fetch` never complete — `warmDevServer` simply hangs until
// the test times out. These tests need actual sockets.
//
// The trailing settle in `warmDevServer` exists for ONE thing: letting Vite's post-optimize
// `full-reload` broadcast fire while no WebView is attached. iOS WKWebView does not survive
// that reload if it attaches mid-optimize — it drops the HMR socket for good, silently, and
// the dev just finds that saving a file no longer does anything.
//
// So the settle is correct and must stay. What was wrong is paying it EVERY time: on a warm
// `node_modules/.vite` Vite never re-optimizes, there is no broadcast, and a flat second was
// being spent waiting for nothing on every native `dev`.

let server = null
afterEach(
  () =>
    new Promise((r) => {
      if (!server) return r()
      server.close(() => r())
      server = null
    }),
)

/** A stand-in server on a free port, answering however the test says. */
function answering(handler) {
  return new Promise((resolve) => {
    server = createServer(handler)
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    )
  })
}

/** A stand-in dev server that answers with a document big enough to look ready. */
const serving = () =>
  answering((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" })
    res.end(`<!doctype html><html><body>${"x".repeat(600)}</body></html>`)
  })

describe("SAW_OPTIMIZE — recognising that Vite re-optimized", () => {
  it.each([
    "[vite] Re-optimizing dependencies because lockfile has changed",
    "  ✨ new dependencies optimized: react-dom/client",
    "[vite] optimized dependencies changed. reloading",
    "[vite] ✨ dependencies updated, reloading page...",
  ])("matches %s", (line) => {
    expect(SAW_OPTIMIZE.test(line)).toBe(true)
  })

  it.each([
    "VITE v8.0.11  ready in 412 ms",
    "  ➜  Local:   http://localhost:41730/",
    "[vite] hmr update /src/app.tsx",
    "  ➜  press h + enter to show help",
  ])("does not match %s", (line) => {
    //A false positive costs a second on every run; it is the cheap direction to be wrong in,
    //but there is no reason to be wrong at all.
    expect(SAW_OPTIMIZE.test(line)).toBe(false)
  })
})

//These genuinely sleep ~2s each (two reads, their gap, the settle), so they carry an explicit
//timeout — vitest's 5s default is too tight for that on a loaded machine.
describe("warmDevServer — the settle is paid when it buys something", () => {
  it("waits the full second when Vite re-optimized", async () => {
    const url = await serving()
    const t = Date.now()
    expect(await warmDevServer(url, { sawOptimize: () => true })).toEqual({
      ok: true,
    })
    //Two good reads with a 900ms gap, then the full 1000ms settle.
    expect(Date.now() - t).toBeGreaterThanOrEqual(1800)
  }, 20000)

  it("settles briefly when it did NOT — the common warm start", async () => {
    const url = await serving()
    const t = Date.now()
    expect(await warmDevServer(url, { sawOptimize: () => false })).toEqual(
      { ok: true },
    )
    const took = Date.now() - t
    //Still two good reads and their gap; only the tail is short.
    expect(took).toBeGreaterThanOrEqual(900)
    expect(took).toBeLessThan(1700)
  }, 20000)

  it("defaults to the full settle, so a caller that says nothing is safe", async () => {
    //The default matters: an omitted `sawOptimize` must not silently opt into the fast path.
    const url = await serving()
    const t = Date.now()
    await warmDevServer(url)
    expect(Date.now() - t).toBeGreaterThanOrEqual(1800)
  }, 20000)

  it("reports failure rather than hanging when nothing is listening", async () => {
    const t = Date.now()
    //Port 1 is never a dev server.
    expect(
      await warmDevServer("http://127.0.0.1:1", { timeoutMs: 1200 }),
    ).toEqual({ ok: false, why: "unreachable" })
    expect(Date.now() - t).toBeLessThan(6000)
  })
})

/**
 * The verdict has to tell an APP that is throwing apart from a STRANGER on the port, because
 * the two want opposite advice and for a long time both got the stranger's: "Another process
 * is likely using that port." A dev whose TanStack SSR entry was failing to resolve a module
 * spent the run looking for a process that did not exist, while the server sat there
 * answering 500 and printing the real cause to a stream nothing was reading.
 */
describe("warmDevServer — naming WHICH way it failed", () => {
  it("says `error` with the status when the app itself is throwing", async () => {
    const url = await answering((_req, res) => {
      res.writeHead(500, { "content-type": "application/json" })
      res.end('{"status":500,"unhandled":true,"message":"HTTPError"}')
    })
    expect(await warmDevServer(url, { timeoutMs: 1200 })).toEqual({
      ok: false,
      why: "error",
      status: 500,
    })
  }, 20000)

  it("says `thin` when something answers 200 but it is not the app", async () => {
    //A 2xx too small to be a document: the port IS held by a stranger. This is the only
    //verdict the port-collision advice belongs to.
    const url = await answering((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" })
      res.end("ok")
    })
    expect(await warmDevServer(url, { timeoutMs: 1200 })).toEqual({
      ok: false,
      why: "thin",
      status: 200,
    })
  }, 20000)

  it("reports the LAST failure, not the last read", async () => {
    //Good, then broken, then the budget runs out. The verdict must describe the fault that
    //stopped it — a lone healthy read early on cannot leave the failure unworded.
    let n = 0
    const url = await answering((_req, res) => {
      if (n++ === 0) {
        res.writeHead(200, { "content-type": "text/html" })
        return res.end(`<!doctype html>${"x".repeat(600)}`)
      }
      res.writeHead(503)
      res.end("nope")
    })
    expect(await warmDevServer(url, { timeoutMs: 2500 })).toEqual({
      ok: false,
      why: "error",
      status: 503,
    })
  }, 20000)
})

/* -------------------------------------------------------------------------- */
/* startDevServer — reading the URLs out of Vite's banner                      */
/* -------------------------------------------------------------------------- */

/**
 * A fake `node_modules/.bin/vite` that prints the ready banner in a controlled number of
 * writes, so a SPLIT between `Local:` and `Network:` can be reproduced on demand.
 *
 * That split is the whole point. The two lines are one write from Vite and were read as
 * one, so the parser took `Network:` only if it happened to be in the same 'data' event.
 * When the pipe split them, `networkUrl` stayed null on a server that WAS bound to the
 * LAN — the address block quietly lost its `network` row, and a phone on the same Wi-Fi
 * had no URL to type.
 */
async function fakeVite(gapMs) {
  const { mkdtempSync, mkdirSync, writeFileSync, chmodSync } =
    await import("node:fs")
  const { tmpdir } = await import("node:os")
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-devserver-"))
  const bin = path.join(root, "node_modules", ".bin")
  mkdirSync(bin, { recursive: true })
  const script = path.join(bin, "vite")
  writeFileSync(
    script,
    `#!/usr/bin/env node
process.stdout.write("\\n  VITE v8.0.11  ready in 300 ms\\n\\n")
process.stdout.write("  \\u279c  Local:   http://localhost:41730/\\n")
setTimeout(() => {
  process.stdout.write("  \\u279c  Network: http://192.168.1.25:41730/\\n")
}, ${gapMs})
setInterval(() => {}, 1000)
`,
  )
  chmodSync(script, 0o755)
  return root
}

describe("startDevServer — the Network line arriving in its own chunk", () => {
  it("still reports networkUrl when the banner is split across writes", async () => {
    const root = await fakeVite(60)
    const s = await startDevServer(root, { host: true })
    try {
      expect(s.localUrl).toBe("http://localhost:41730")
      expect(s.networkUrl).toBe("http://192.168.1.25:41730")
    } finally {
      s.stop()
    }
  })

  it("does not wait for a Network line it never asked for", async () => {
    //`host: false` means localhost-only, so there is no second line coming and the grace
    //would be a flat delay on every `dev web`.
    const root = await fakeVite(5000)
    const started = Date.now()
    const s = await startDevServer(root, { host: false })
    try {
      expect(s.localUrl).toBe("http://localhost:41730")
      expect(s.networkUrl).toBe(null)
      expect(Date.now() - started).toBeLessThan(1000)
    } finally {
      s.stop()
    }
  })
})
