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
  installOfflinePage,
  MIN_ANDROID_WEBVIEW,
} from "./offline-page.mjs"

// One page, two unrelated failures — Capacitor routes a failed main-frame load AND a
// too-old WebView through the SAME `server.errorPath`. Telling a dev on WebView 113 that
// the dev server is unreachable is the bug these tests exist to prevent.

const dirs = []
afterEach(() => {
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

function render({ url = null } = {}) {
  const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-errpage-"))
  dirs.push(appRoot)
  mkdirSync(path.join(appRoot, CAP_WEB_DIR), { recursive: true })
  installOfflinePage(appRoot, { url })
  return readFileSync(
    path.join(appRoot, CAP_WEB_DIR, "adaptv-offline.html"),
    "utf8",
  )
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

  it("bakes the floor into the page, so the screen can name it", () => {
    expect(render()).toContain(`var MIN_WEBVIEW = ${MIN_ANDROID_WEBVIEW};`)
  })

  // The version branch has to be terminal and FIRST. If it ran after the dev-server
  // branch, a dev build on an old WebView would show "couldn't reach dev server".
  it("checks the WebView floor before anything about the dev server", () => {
    const html = render({ url: "http://localhost:41730" })
    expect(html.indexOf("showOutdatedWebView")).toBeLessThan(
      html.indexOf("if (!DEV_URL)"),
    )
    expect(html).toContain("if (major > 0 && major < MIN_WEBVIEW)")
  })

  // iOS has no Chrome token in its user-agent and no updatable WebView — WebKit ships with
  // the OS. `major > 0` is what keeps the floor from ever firing there.
  it("never applies the floor on iOS", () => {
    expect(render()).toContain("major > 0 &&")
  })

  // production has no dev server, so there is nothing to reconnect to; a spinner there
  // would promise a recovery that cannot happen.
  it("drops the reconnect UI when there is no dev server", () => {
    const prod = render()
    expect(prod).toContain("var DEV_URL = null;")
    expect(prod).toContain("Couldn't load the app")
  })

  it("keeps the dev reconnect loop when there IS one", () => {
    const dev = render({ url: "http://localhost:41730" })
    expect(dev).toContain('var DEV_URL = "http://localhost:41730";')
    expect(dev).toContain("setInterval(probe, 2000)")
  })
})
