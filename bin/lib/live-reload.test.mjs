import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildCapacitorConfig } from "#adaptv/vite/capacitor-config"
import { patchServerUrl } from "./live-reload.mjs"
import { CAP_WEB_DIR, capConfigFromEnv } from "./native.mjs"
import { installOfflinePage, OFFLINE_PAGE } from "./offline-page.mjs"

/*
 * The dev session serves the app's LOCAL origin over cleartext http, which is
 * not what Capacitor does by default and is not what a built app does. The
 * reason it is safe has always been a comment: live-reload means the app itself
 * runs from the dev-server origin, so the local origin only ever serves the
 * offline page, and that page touches nothing a secure context is needed for.
 *
 * These are that reasoning as tests. `dev-loop-debt` §G asked for exactly this,
 * because a comment cannot fail when someone adds a `localStorage` read to the
 * offline screen or leaves `androidScheme` set in a built config.
 */

const DEV_URL = "http://192.168.1.20:41730"
const APP = {
  appId: "dev.arrz.projectzero",
  name: "ChopChop",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
}

let saved
beforeEach(() => {
  saved = process.env.ADAPTV_CAPACITOR_CONFIG
  process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify({
    appId: APP.appId,
    server: { errorPath: OFFLINE_PAGE },
    plugins: { SplashScreen: { launchAutoHide: false } },
  })
})

afterEach(() => {
  if (saved === undefined) delete process.env.ADAPTV_CAPACITOR_CONFIG
  else process.env.ADAPTV_CAPACITOR_CONFIG = saved
})

describe("the dev origin, and what it is allowed to serve", () => {
  it("points the app at the dev server and the local origin at one page", () => {
    patchServerUrl("/tmp/app", DEV_URL)
    const { server } = capConfigFromEnv()
    //the app runs from the dev server; the local origin's only document is the
    //offline page, which is the whole reason cleartext there is not a hole
    expect(server.url).toBe(DEV_URL)
    expect(server.errorPath).toBe(OFFLINE_PAGE)
    expect(server.androidScheme).toBe("http")
    expect(server.cleartext).toBe(true)
  })

  it("takes the cleartext origin away again on teardown", () => {
    const revert = patchServerUrl("/tmp/app", DEV_URL)
    revert()
    //the whole server block goes, which is the clean baseline: every command
    //regenerates it from `adaptv.config.ts` before it runs, so the production
    //`errorPath` comes back and the dev session's scheme does not
    const config = capConfigFromEnv()
    expect(config.server).toBeUndefined()
    expect(JSON.stringify(config)).not.toContain("androidScheme")
    expect(JSON.stringify(config)).not.toContain("cleartext")
    expect(buildCapacitorConfig(APP).server).toEqual({
      errorPath: OFFLINE_PAGE,
    })
  })

  it("a built app never carries the dev session's scheme", () => {
    const built = buildCapacitorConfig(APP)
    expect(built.server).toEqual({ errorPath: OFFLINE_PAGE })
    expect(JSON.stringify(built)).not.toContain("androidScheme")
    expect(JSON.stringify(built)).not.toContain("cleartext")
  })
})

/** Every API that either needs a secure context or reads persistent state. */
const FORBIDDEN = [
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "openDatabase",
  "document.cookie",
  "crypto.subtle",
  "navigator.credentials",
  "navigator.storage",
  "getUserMedia",
  "geolocation",
  "serviceWorker",
  "Notification",
  "PushManager",
  "requestPermission",
]

describe("the offline page reads nothing the cleartext origin would weaken", () => {
  const dirs = []
  afterEach(() => {
    for (const d of dirs.splice(0))
      rmSync(d, { recursive: true, force: true })
  })

  async function render(url) {
    const appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-dev-origin-"))
    dirs.push(appRoot)
    mkdirSync(path.join(appRoot, CAP_WEB_DIR), { recursive: true })
    await installOfflinePage(appRoot, { url, config: APP })
    return readFileSync(
      path.join(appRoot, CAP_WEB_DIR, "adaptv-offline.html"),
      "utf8",
    )
  }

  it("touches no storage and no secure-context API", async () => {
    const html = await render(DEV_URL)
    for (const api of FORBIDDEN) expect(html).not.toContain(api)
  })

  it("reaches the dev server by a plain fetch and nothing else", async () => {
    const html = await render(DEV_URL)
    //the reachability probe is the ONE network call this page makes, and it is
    //the reason the origin is cleartext in the first place
    expect(html).toContain("fetch(")
    expect(html).not.toContain("XMLHttpRequest")
    expect(html).not.toContain("WebSocket")
  })

  it("is the same page when there is no dev server to name", async () => {
    const html = await render(null)
    for (const api of FORBIDDEN) expect(html).not.toContain(api)
  })
})
