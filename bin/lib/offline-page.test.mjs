import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  CAPACITOR_WEB_DIR,
  MIN_ANDROID_WEBVIEW as CONFIG_MIN_WEBVIEW,
} from "#adaptv/vite/capacitor-config"
import { CAP_WEB_DIR } from "./native.mjs"
import {
  contrastRatio,
  installOfflinePage,
  MIN_ANDROID_WEBVIEW,
  offlinePalette,
} from "./offline-page.mjs"

// One page, two unrelated failures — Capacitor routes a failed main-frame load AND a
// too-old WebView through the SAME `server.errorPath`. Telling a dev on WebView 113 that
// the dev server is unreachable is the bug these tests exist to prevent.

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

/** The playground's own pair, and the palette the page used to hardcode. */
const DARK_CONFIG = { themeColor: { light: "#eeeeec", dark: "#0a0a0c" } }
/** A single-colour LIGHT app — the case the hardcoded page had no answer for. */
const LIGHT_CONFIG = { themeColor: { light: "#ffffff" } }

async function render({ url = null, config = DARK_CONFIG } = {}) {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-errpage-"))
  dirs.push(appRoot)
  mkdirSync(path.join(appRoot, CAP_WEB_DIR), { recursive: true })
  await installOfflinePage(appRoot, { url, config })
  return readFileSync(
    path.join(appRoot, CAP_WEB_DIR, "adaptv-offline.html"),
    "utf8",
  )
}

const rgb = (hex) => ({
  r: Number.parseInt(hex.slice(1, 3), 16),
  g: Number.parseInt(hex.slice(3, 5), 16),
  b: Number.parseInt(hex.slice(5, 7), 16),
})

/** The `--name:#rrggbb` declarations in one `:root` block, by position in the file. */
function paletteAt(html, index) {
  const blocks = [...html.matchAll(/:root \{([^}]*)\}/g)]
  const found = {}
  for (const [, name, value] of blocks[index][1].matchAll(
    /--([a-z]+):(#[0-9a-f]{6})/g,
  ))
    found[name] = value
  return found
}

describe("the errorPath page", () => {
  // src/vite/capacitor-config.ts sets android.minWebViewVersion; this page tells the user
  // which version they need. Drift means the screen names a version nobody is enforcing.
  it("reports the same floor the config enforces", () => {
    expect(MIN_ANDROID_WEBVIEW).toBe(CONFIG_MIN_WEBVIEW)
    expect(MIN_ANDROID_WEBVIEW).toBe(111)
  })

  // The CLI writes this page into the web dir, and the generated Capacitor config points
  // the WebView at that same dir. They are two constants because the CLI must not import
  // framework source; drift means the CLI writes the offline page somewhere nothing loads
  // it from, and `server.errorPath` resolves to a 404 — a blank screen, not a message.
  it("writes into the directory the generated config points the WebView at", () => {
    expect(CAP_WEB_DIR).toBe(CAPACITOR_WEB_DIR)
    expect(CAP_WEB_DIR).toBe(".adaptv/web")
  })

  it("bakes the floor into the page, so the screen can name it", async () => {
    expect(await render()).toContain(
      `var MIN_WEBVIEW = ${MIN_ANDROID_WEBVIEW};`,
    )
  })

  // The version branch has to be terminal and FIRST. If it ran after the dev-server
  // branch, a dev build on an old WebView would show "couldn't reach dev server".
  it("checks the WebView floor before anything about the dev server", async () => {
    const html = await render({ url: "http://localhost:41730" })
    expect(html.indexOf("showOutdatedWebView")).toBeLessThan(
      html.indexOf("if (!DEV_URL)"),
    )
    expect(html).toContain("if (major > 0 && major < MIN_WEBVIEW)")
  })

  // iOS has no Chrome token in its user-agent and no updatable WebView — WebKit ships with
  // the OS. `major > 0` is what keeps the floor from ever firing there.
  it("never applies the floor on iOS", async () => {
    expect(await render()).toContain("major > 0 &&")
  })

  // production has no dev server, so there is nothing to reconnect to; a spinner there
  // would promise a recovery that cannot happen.
  it("drops the reconnect UI when there is no dev server", async () => {
    const prod = await render()
    expect(prod).toContain("var DEV_URL = null;")
    expect(prod).toContain("Couldn't load the app")
  })

  it("keeps the dev reconnect loop when there IS one", async () => {
    const dev = await render({ url: "http://localhost:41730" })
    expect(dev).toContain('var DEV_URL = "http://localhost:41730";')
    expect(dev).toContain("setInterval(probe, 2000)")
  })
})

// The page carried three hardcoded near-black tones, which were one app's `themeColor.dark`
// and two greys sampled off it. On a light-themed app it was a black rectangle with nothing
// of the app in it. `themeColor` is the value every other surface that paints a background
// already answers to, and this is the screen a dev sees when the rest of them have failed.
describe("the palette, which is the app's and not adaptv's", () => {
  it("paints the background the config names, on both sides of the pair", async () => {
    const html = await render({ config: DARK_CONFIG })
    expect(paletteAt(html, 0).bg).toBe("#eeeeec")
    expect(paletteAt(html, 1).bg).toBe("#0a0a0c")
  })

  // The failing half of the fix: these three ran the page before, and a light app got them
  // anyway. Nothing may reintroduce a colour that outlives the config.
  it("carries no colour a different config did not produce", async () => {
    const html = await render({ config: LIGHT_CONFIG })
    for (const stale of ["#0a0a0c", "#141418", "#26262e"])
      expect(html).not.toContain(stale)
    expect(paletteAt(html, 0).bg).toBe("#ffffff")
  })

  // A one-sided `themeColor` is a single-colour app, and `resolveThemeColors` is the one
  // place that says so. Reimplementing that fallback here is how the page and the shell
  // would come to disagree about what a half-filled pair means.
  it("resolves a one-sided pair the way every other surface does", async () => {
    const html = await render({ config: LIGHT_CONFIG })
    expect(paletteAt(html, 0).bg).toBe("#ffffff")
    expect(paletteAt(html, 1).bg).toBe("#ffffff")
  })

  // Same shape as the app's own pre-paint script: `system` follows the device, a pinned
  // preference paints that one appearance and never consults the device at all.
  it("follows the device appearance only when the app does", async () => {
    const system = await render({ config: DARK_CONFIG })
    expect(system).toContain("@media (prefers-color-scheme: dark)")
    expect(system).toContain('content="light dark"')

    const pinned = await render({
      config: { ...DARK_CONFIG, defaultThemePreference: "light" },
    })
    expect(pinned).not.toContain("prefers-color-scheme")
    expect(pinned).toContain('content="light"')
    expect(paletteAt(pinned, 0).bg).toBe("#eeeeec")
  })

  it("declares every colour the stylesheet asks for", async () => {
    const html = await render({ config: LIGHT_CONFIG })
    const declared = Object.keys(paletteAt(html, 0))
    const used = new Set(
      [...html.matchAll(/var\(--([a-z]+)\)/g)].map((m) => m[1]),
    )
    for (const name of used) expect(declared).toContain(name)
    //and no dead ones: a variable nothing reads is a tone somebody removed by hand
    for (const name of declared) expect([...used]).toContain(name)
  })
})

// This is the screen whose entire job is to be legible after everything else has failed, so
// its contrast is computed and asserted rather than eyeballed against one dark background.
describe("contrast, on whatever background the config names", () => {
  // Every text tone is measured against the command box, which is the lowest-contrast
  // surface on the page — clearing it clears the page background too.
  const FLOORS = { body: 4.5, muted: 4.5, spinner: 3, dim: 3, faint: 3 }

  // The crossover is the worst sRGB colour there is: white and black measure the SAME
  // against it, so no ink can do better. Everything else in the sweep is a real theme
  // colour shape — near-white, near-black, and saturated hues at both ends.
  const SWEEP = [
    "#ffffff",
    "#eeeeec",
    "#0a0a0c",
    "#000000",
    "#767676",
    "#3b0764",
    "#f59e0b",
    "#0a3d62",
    "#1b4332",
    "#fdf6e3",
  ]

  it.each(SWEEP)("holds the whole ramp on %s", async (background) => {
    const p = await offlinePalette(background)
    const onSurface = (hex) => contrastRatio(rgb(hex), rgb(p.surface))
    //the ink is picked FOR contrast, so it is the floor everything else stands on
    expect(onSurface(p.strong)).toBeGreaterThanOrEqual(4.5)
    for (const [tone, floor] of Object.entries(FLOORS))
      expect(onSurface(p[tone])).toBeGreaterThanOrEqual(floor)
  })

  // The proof, not a spot check: white and black cross over at a background luminance of
  // 0.179, where both measure 4.58:1, and away from that point one of them only climbs. So
  // there is no sRGB colour a config can name that leaves the strongest text under AA.
  it("never lets the ink fall under AA, for any colour at all", async () => {
    let worst = Number.POSITIVE_INFINITY
    for (let v = 0; v < 256; v += 5) {
      const p = await offlinePalette(
        `#${v.toString(16).padStart(2, "0").repeat(3)}`,
      )
      worst = Math.min(worst, contrastRatio(rgb(p.strong), rgb(p.surface)))
    }
    expect(worst).toBeGreaterThanOrEqual(4.5)
  })

  // Hue is the thing a derived tone loses first. Mixing towards the ink (which is neutral)
  // moves lightness and leaves the hue alone, so a deep indigo page gets a lighter indigo
  // command box rather than a grey one. A tone that went grey here would be the muddy
  // failure that makes derivation worse than a fixed palette.
  it("keeps the background's hue in the tones it derives from it", async () => {
    const p = await offlinePalette("#3b0764")
    for (const tone of [p.surface, p.border, p.muted, p.dim]) {
      const { r, g, b } = rgb(tone)
      expect(b).toBeGreaterThan(g)
      expect(r).toBeGreaterThan(g)
    }
  })

  // The dark theme is the one the hardcoded page was tuned on, so it is the one that must
  // come back unchanged. Within a couple of 8-bit steps of the greys it used to name.
  it("reproduces the screen it replaced on the config it was tuned for", async () => {
    const p = await offlinePalette("#0a0a0c")
    const near = (got, was) => {
      const a = rgb(got)
      const b = rgb(was)
      return Math.max(
        Math.abs(a.r - b.r),
        Math.abs(a.g - b.g),
        Math.abs(a.b - b.b),
      )
    }
    expect(near(p.surface, "#141418")).toBeLessThanOrEqual(3)
    expect(near(p.border, "#26262e")).toBeLessThanOrEqual(5)
    expect(near(p.body, "#ededf0")).toBeLessThanOrEqual(3)
    expect(near(p.muted, "#9b9ba4")).toBeLessThanOrEqual(7)
  })
})

// ---- the reconnect probe, run for real -------------------------------------------------
// The page's script is evaluated in a vm with a stub bridge, so these bite on the probe's
// logic rather than on its text: a 2xx/3xx reconnects at once, a not-ready answer (4xx/5xx
// from a server that is up but still booting) is waited out, and only a streak of them
// reconnects anyway so a genuinely failing app is not a dead end.

import { setImmediate as tick } from "node:timers/promises"
import vm from "node:vm"

const DEV_URL = "http://192.168.1.20:41730"

/**
 * Boot the page against a bridge whose HEAD answers come from `answers` (an array of
 * statuses, consumed in order; the last one repeats). Returns a `probe()` that runs one
 * scheduled tick and settles its promise chain, plus the navigations the page made.
 */
async function boot({ answers, origin = "capacitor:", bridge = true }) {
  const html = await render({ url: DEV_URL })
  const src = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  expect(src).toBeTruthy()
  const replaced = []
  const scheduled = []
  const element = () => ({
    textContent: "",
    innerHTML: "",
    appendChild() {},
    remove() {},
  })
  const requests = []
  let i = 0
  const next = () => answers[Math.min(i++, answers.length - 1)]
  const sandbox = {
    navigator: {
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0) AppleWebKit",
    },
    document: {
      title: "",
      getElementById: element,
      createTextNode: (t) => t,
    },
    location: {
      protocol: origin,
      hostname: "localhost",
      href: "",
      replace(u) {
        replaced.push(u)
      },
    },
    setInterval(fn) {
      scheduled.push(fn)
    },
    setTimeout(fn) {
      scheduled.push(fn)
    },
    fetch(url) {
      requests.push(url)
      return Promise.resolve({ type: "opaque", status: 0 })
    },
  }
  sandbox.window = {
    Capacitor: {
      getPlatform: () => "ios",
      Plugins: {
        SplashScreen: { hide() {} },
        ...(bridge
          ? {
              CapacitorHttp: {
                request(req) {
                  requests.push(req.url)
                  return Promise.resolve({ status: next() })
                },
              },
            }
          : {}),
      },
    },
  }
  if (!bridge) sandbox.window.Capacitor = undefined
  vm.runInNewContext(src, sandbox)
  expect(scheduled).toHaveLength(2) // the interval and the first early tick
  return {
    replaced,
    requests,
    async probe(times = 1) {
      for (let n = 0; n < times; n++) {
        scheduled[0]()
        await tick()
        await tick()
      }
    },
  }
}

describe("the reconnect probe", () => {
  it("asks the dev server with a HEAD and reconnects on a 2xx at once", async () => {
    const page = await boot({ answers: [200] })
    await page.probe()
    expect(page.requests).toEqual([DEV_URL])
    expect(page.replaced).toEqual([DEV_URL])
  })

  it("a 3xx is the server serving too", async () => {
    const page = await boot({ answers: [302] })
    await page.probe()
    expect(page.replaced).toEqual([DEV_URL])
  })

  it("navigates once, however many ticks follow", async () => {
    const page = await boot({ answers: [200] })
    await page.probe(4)
    expect(page.replaced).toEqual([DEV_URL])
  })

  it("waits out a server that answers but is not ready", async () => {
    const page = await boot({ answers: [500, 500, 500, 500, 200] })
    await page.probe(4)
    expect(page.replaced).toEqual([])
    await page.probe()
    expect(page.replaced).toEqual([DEV_URL])
  })

  it("reconnects anyway after five not-ready answers in a row, so a failing app is not a dead end", async () => {
    const page = await boot({ answers: [503] })
    await page.probe(4)
    expect(page.replaced).toEqual([])
    await page.probe()
    expect(page.replaced).toEqual([DEV_URL])
    expect(page.requests).toHaveLength(5)
  })

  it("a 4xx counts as not ready, not as reachable", async () => {
    const page = await boot({ answers: [404] })
    await page.probe(4)
    expect(page.replaced).toEqual([])
  })

  it("an unreachable server (no status) is neither ready nor a strike", async () => {
    const page = await boot({ answers: [0, 0, 0, 0, 0, 0, 0, 0] })
    await page.probe(8)
    expect(page.replaced).toEqual([])
  })

  it("without the bridge on a cleartext origin, any answered fetch reconnects (an opaque response has no status to read)", async () => {
    const page = await boot({
      answers: [],
      origin: "http:",
      bridge: false,
    })
    await page.probe()
    expect(page.requests).toEqual([DEV_URL])
    expect(page.replaced).toEqual([DEV_URL])
  })

  it("without the bridge on a native origin there is nothing to probe with", async () => {
    const page = await boot({
      answers: [],
      origin: "capacitor:",
      bridge: false,
    })
    await page.probe(3)
    expect(page.requests).toEqual([])
    expect(page.replaced).toEqual([])
  })
})
