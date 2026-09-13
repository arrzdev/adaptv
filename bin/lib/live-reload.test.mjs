// @vitest-environment node
import { spawnSync } from "node:child_process"
import { EventEmitter } from "node:events"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { buildCapacitorConfig } from "#adaptv/vite/capacitor-config"
import {
  ATS_MARKER,
  androidReverse,
  healDevAtsLeftover,
  patchIosAts,
  patchIosLocalNetwork,
  patchServerUrl,
} from "./live-reload.mjs"
import { CAP_WEB_DIR, capConfigFromEnv } from "./native.mjs"
import { installOfflinePage, OFFLINE_PAGE } from "./offline-page.mjs"

/*
 * `adb` is faked at `node:child_process`, the only seam it goes through: `adb devices` is a
 * `spawn` (native.mjs `probe`), and every `adb reverse` is a `spawnSync`. Everything that is not
 * `adb` — PlistBuddy above all — runs for real, because what the plist tests pin is what
 * PlistBuddy actually leaves in the file.
 */
const adb = vi.hoisted(() => ({
  /** what `adb devices` prints */
  devices: "",
  /** serial → what `adb -s <serial> reverse --list` prints */
  reverses: /** @type {Record<string, string>} */ ({}),
  /** @type {string[][]} every adb call, as argv */
  calls: [],
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    spawn: (command, args, opts) => {
      if (command !== "adb") return actual.spawn(command, args, opts)
      adb.calls.push(args)
      const child = new EventEmitter()
      const stdout = new EventEmitter()
      stdout.setEncoding = () => {}
      child.stdout = stdout
      queueMicrotask(() => {
        if (args[0] === "devices" && adb.devices)
          stdout.emit("data", adb.devices)
        child.emit("close", 0)
      })
      return child
    },
    spawnSync: (command, args, opts) => {
      if (command !== "adb") return actual.spawnSync(command, args, opts)
      adb.calls.push(args)
      const list = args[2] === "reverse" && args[3] === "--list"
      return {
        status: 0,
        stdout: list ? (adb.reverses[args[1]] ?? "") : "",
        stderr: "",
      }
    },
  }
})

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

/*
 * The iOS plist is patched IN PLACE and never regenerated (live-reload.mjs `patchIosAts`), so
 * two things have to hold for it: a dev session changes it once however often it asks, and
 * `healDevAtsLeftover` — run before every build — takes out what a killed session left and
 * never a key the app declared itself. PlistBuddy and plutil are macOS tools, and iOS builds
 * are macOS-only anyway.
 */
const onMac = process.platform === "darwin"

/** The scaffold's Info.plist as `dev` finds it, plus one key the app owns. */
const INFO_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>ChopChop (dev)</string>
	<key>CFBundleIdentifier</key>
	<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
	<key>NSCameraUsageDescription</key>
	<string>Scan a recipe card.</string>
	<key>UIViewControllerBasedStatusBarAppearance</key>
	<true/>
</dict>
</plist>
`

/** An app that genuinely needs cleartext to one host — ATS the dev wrote, not adaptv. */
const APP_ATS = INFO_PLIST.replace(
  "\t<key>UIViewControllerBasedStatusBarAppearance</key>",
  `\t<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSExceptionDomains</key>
		<dict>
			<key>legacy.example.com</key>
			<dict>
				<key>NSExceptionAllowsInsecureHTTPLoads</key>
				<true/>
			</dict>
		</dict>
	</dict>
	<key>UIViewControllerBasedStatusBarAppearance</key>`,
)

/** The app's OWN Local Network reason — a key dev must neither replace nor remove. */
const APP_LOCAL_NETWORK = INFO_PLIST.replace(
  "\t<key>UIViewControllerBasedStatusBarAppearance</key>",
  `\t<key>NSLocalNetworkUsageDescription</key>
	<string>Find printers on your network.</string>
	<key>UIViewControllerBasedStatusBarAppearance</key>`,
)

describe.runIf(onMac)("the dev plist patches", () => {
  const roots = []
  afterEach(() => {
    for (const r of roots.splice(0))
      rmSync(r, { recursive: true, force: true })
  })

  /** An app root whose generated iOS project carries `plist`; returns its path helpers. */
  function app(plist = INFO_PLIST) {
    const root = mkdtempSync(path.join(tmpdir(), "adaptv-plist-"))
    roots.push(root)
    const file = path.join(
      root,
      ".adaptv",
      "ios",
      "App",
      "App",
      "Info.plist",
    )
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, plist)
    return {
      root,
      bytes: () => readFileSync(file, "utf8"),
      parsed: () =>
        JSON.parse(
          spawnSync("plutil", ["-convert", "json", "-o", "-", file], {
            encoding: "utf8",
          }).stdout,
        ),
    }
  }
  const original = (plist = INFO_PLIST) => {
    const a = app(plist)
    return a.parsed()
  }

  describe("the ATS exception", () => {
    it("adds the exception and its marker, and nothing else", () => {
      const a = app()
      expect(typeof patchIosAts(a.root)).toBe("function")
      expect(a.parsed()).toEqual({
        ...original(),
        NSAppTransportSecurity: {
          NSAllowsArbitraryLoads: true,
          NSAllowsLocalNetworking: true,
        },
        [ATS_MARKER]: true,
      })
    })

    it("is one change however many times a session asks, and the revert restores the file", () => {
      const a = app()
      const revert = patchIosAts(a.root)
      const once = a.bytes()
      //the second ask sees the exception already there: no edit, and no second revert to run
      expect(patchIosAts(a.root)).toBeNull()
      expect(a.bytes()).toBe(once)
      revert()
      expect(a.bytes()).toBe(INFO_PLIST)
    })

    it("heals what a killed session left behind, and only that", () => {
      //SIGKILL skips teardown, so the revert never runs
      const a = app()
      patchIosAts(a.root)
      expect(healDevAtsLeftover(a.root)).toEqual({ healed: true })
      expect(a.parsed()).toEqual(original())
      //and the next session can patch — and revert — again
      const revert = patchIosAts(a.root)
      expect(typeof revert).toBe("function")
    })

    it("never edits an ATS block the app declared", () => {
      const a = app(APP_ATS)
      expect(patchIosAts(a.root)).toBeNull()
      expect(a.bytes()).toBe(APP_ATS)
      expect(healDevAtsLeftover(a.root)).toEqual({ warn: true })
      expect(a.bytes()).toBe(APP_ATS)
    })

    it("has nothing to heal in a clean plist, or when there is no iOS project", () => {
      const a = app()
      expect(healDevAtsLeftover(a.root)).toEqual({})
      expect(a.bytes()).toBe(INFO_PLIST)
      const bare = mkdtempSync(path.join(tmpdir(), "adaptv-plist-"))
      roots.push(bare)
      expect(healDevAtsLeftover(bare)).toEqual({})
      expect(patchIosAts(bare)).toBeNull()
      expect(patchIosLocalNetwork(bare)).toBeNull()
      expect(existsSync(path.join(bare, ".adaptv"))).toBe(false)
    })
  })

  describe("the Local Network usage description", () => {
    it("adds the one key, once, and the revert restores the file", () => {
      const a = app()
      const revert = patchIosLocalNetwork(a.root)
      const after = a.parsed()
      expect(Object.keys(after).sort()).toEqual(
        [
          ...Object.keys(original()),
          "NSLocalNetworkUsageDescription",
        ].sort(),
      )
      const once = a.bytes()
      expect(patchIosLocalNetwork(a.root)).toBeNull()
      expect(a.bytes()).toBe(once)
      revert()
      expect(a.bytes()).toBe(INFO_PLIST)
    })

    it("never replaces the app's own reason", () => {
      const a = app(APP_LOCAL_NETWORK)
      expect(patchIosLocalNetwork(a.root)).toBeNull()
      expect(a.bytes()).toBe(APP_LOCAL_NETWORK)
    })

    it("unwinds with the ATS exception in either session shape", () => {
      //an external run registers both, and teardown pops them last-in first-out
      const a = app()
      const revertAts = patchIosAts(a.root)
      const revertLn = patchIosLocalNetwork(a.root)
      revertLn()
      revertAts()
      expect(a.bytes()).toBe(INFO_PLIST)
    })
  })
})

/*
 * The Android half of live-reload has no plist: an emulator reaches the dev server as
 * `localhost` through `adb reverse`, which `androidReverse` sets on every attached device and
 * then keeps asserting, because any other `adaptv dev` tearing down removes the same global
 * mapping (live-reload.mjs `androidReverse`).
 */
describe("the emulator's route to the dev server", () => {
  beforeEach(() => {
    adb.devices = ""
    adb.reverses = {}
    adb.calls = []
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const reverseCalls = () =>
    adb.calls.filter((a) => a[0] === "-s" && a[2] === "reverse")

  it("maps the port on every ready device, each by serial, and skips one that is not ready", async () => {
    adb.devices = [
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "List of devices attached",
      "emulator-5554\tdevice",
      "emulator-5556\toffline",
      "R58N30ABCDE\tunauthorized",
      "1A2B3C4D5E\tdevice",
      "",
    ].join("\n")
    await androidReverse(43880, {})
    expect(reverseCalls()).toEqual([
      ["-s", "emulator-5554", "reverse", "tcp:43880", "tcp:43880"],
      ["-s", "1A2B3C4D5E", "reverse", "tcp:43880", "tcp:43880"],
    ])
  })

  it("does nothing, and fails nothing, with no device attached", async () => {
    adb.devices = "List of devices attached\n\n"
    const revert = await androidReverse(43880, {})
    vi.advanceTimersByTime(20_000)
    revert()
    expect(reverseCalls()).toEqual([])
  })

  it("re-adds only a mapping that has gone, and stops asserting after teardown", async () => {
    adb.devices =
      "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n"
    const revert = await androidReverse(43880, {}, { intervalMs: 4000 })
    adb.calls = []
    //another dev session's teardown removed the mapping on 5556 only
    adb.reverses = {
      "emulator-5554": "UsbFfs tcp:43880 tcp:43880\n",
      "emulator-5556": "",
    }
    vi.advanceTimersByTime(4000)
    expect(reverseCalls().filter((a) => a[3] !== "--list")).toEqual([
      ["-s", "emulator-5556", "reverse", "tcp:43880", "tcp:43880"],
    ])

    adb.calls = []
    revert()
    expect(reverseCalls()).toEqual([
      ["-s", "emulator-5554", "reverse", "--remove", "tcp:43880"],
      ["-s", "emulator-5556", "reverse", "--remove", "tcp:43880"],
    ])
    adb.calls = []
    vi.advanceTimersByTime(20_000)
    expect(adb.calls).toEqual([])
  })
})
