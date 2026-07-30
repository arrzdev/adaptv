// @vitest-environment node
import { createServer } from "node:http"
import { afterEach, describe, expect, it } from "vitest"
import { SAW_OPTIMIZE, warmDevServer } from "./dev-server.mjs"

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

/** A stand-in dev server that answers with a document big enough to look ready. */
function serving() {
  return new Promise((resolve) => {
    server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" })
      res.end(
        `<!doctype html><html><body>${"x".repeat(600)}</body></html>`,
      )
    })
    server.listen(0, "127.0.0.1", () =>
      resolve(`http://127.0.0.1:${server.address().port}`),
    )
  })
}

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
    expect(await warmDevServer(url, { sawOptimize: () => true })).toBe(
      true,
    )
    //Two good reads with a 900ms gap, then the full 1000ms settle.
    expect(Date.now() - t).toBeGreaterThanOrEqual(1800)
  }, 20000)

  it("settles briefly when it did NOT — the common warm start", async () => {
    const url = await serving()
    const t = Date.now()
    expect(await warmDevServer(url, { sawOptimize: () => false })).toBe(
      true,
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
    ).toBe(false)
    expect(Date.now() - t).toBeLessThan(6000)
  })
})
