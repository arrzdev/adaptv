// @vitest-environment node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  shellIdFromUserAgent as frameworkParser,
  NATIVE_SHELL_ENDPOINT,
  NATIVE_SHELL_TOKEN,
  nativeShellVerdict,
} from "#adaptv/shell/native-shell"
import { buildCapacitorConfig } from "#adaptv/vite/capacitor-config"
import {
  NATIVE_SHELLS_ENV,
  NATIVE_SHELLS_SEEN_FILE,
  nativeShellMiddleware,
  readExpectedShells,
} from "#adaptv/vite/native-shell-plugin"
import { nativeFingerprint } from "./fingerprint.mjs"
import { patchServerUrl } from "./live-reload.mjs"
import { ADAPTV_ROOT } from "./load-ts.mjs"
import { capConfigFromEnv } from "./native.mjs"
import {
  buildNewShell,
  canReuseInstall,
  newShellId,
  openShellRegistry,
  SHELL_ENDPOINT,
  SHELL_TOKEN,
  SHELLS_ENV,
  SHELLS_SEEN_FILE,
  shellIdFromUserAgent,
  stampShellId,
  withoutShellMark,
} from "./native-shell.mjs"

/*
 * `adaptv dev` used to let the app already installed on a device reconnect the moment the dev
 * server answered, even when this run was about to rebuild that app because its native project
 * had changed. These pin the CLI's half of the fix: the id a dev build carries, where it is
 * baked, how the run cache uses it, and what the dev server is told to expect.
 */

const APP = {
  appId: "dev.arrz.projectzero",
  name: "ChopChop",
  themeColor: { light: "#eeeeec", dark: "#0a0a0c" },
}
const DEV_URL = "http://localhost:41730"

const dirs = []
let savedConfig
beforeEach(() => {
  savedConfig = process.env.ADAPTV_CAPACITOR_CONFIG
  //what `setCapacitorConfigEnv` + `patchServerUrl` leave in the env for a native dev run
  process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify(
    buildCapacitorConfig(APP),
  )
  patchServerUrl("/tmp/app", DEV_URL)
})
afterEach(() => {
  if (savedConfig === undefined) delete process.env.ADAPTV_CAPACITOR_CONFIG
  else process.env.ADAPTV_CAPACITOR_CONFIG = savedConfig
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

const tempApp = () => {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-shell-"))
  dirs.push(root)
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ dependencies: { react: "19.2.3" } }),
  )
  return root
}

describe("one contract, two sides", () => {
  it("the CLI and the framework name the same token, endpoint, env var and files", () => {
    expect(SHELL_TOKEN).toBe(NATIVE_SHELL_TOKEN)
    expect(SHELL_ENDPOINT).toBe(NATIVE_SHELL_ENDPOINT)
    expect(SHELLS_ENV).toBe(NATIVE_SHELLS_ENV)
    expect(SHELLS_SEEN_FILE).toBe(NATIVE_SHELLS_SEEN_FILE)
  })

  it("both parsers read the same id off the same user agents", () => {
    const id = newShellId("android")
    const agents = [
      `Mozilla/5.0 (iPhone; CPU iPhone OS 26_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 adaptv-shell/${newShellId("ios")}`,
      `Mozilla/5.0 (Linux; Android 16; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/137.0.0.0 Mobile Safari/537.36 adaptv-shell/${id}`,
      "Mozilla/5.0 (iPhone) Mobile/15E148",
      `Foo xadaptv-shell/${id}`,
      "",
      undefined,
    ]
    for (const ua of agents)
      expect(shellIdFromUserAgent(ua)).toBe(frameworkParser(ua))
    expect(shellIdFromUserAgent(agents[1])).toBe(id)
  })

  it("mints ids the parser reads back, one per build", () => {
    const a = newShellId("ios")
    const b = newShellId("ios")
    expect(a).toMatch(/^ios-[0-9a-f]{8}$/)
    expect(a).not.toBe(b)
    expect(shellIdFromUserAgent(`Mobile/15E148 ${SHELL_TOKEN}/${a}`)).toBe(
      a,
    )
  })
})

describe("the id is baked into the generated native config", () => {
  it("as the platform's own appended user agent, next to what the platform already had", () => {
    stampShellId("ios", "ios-3f9a1c2b")
    const config = capConfigFromEnv()
    expect(config.ios.appendUserAgent).toBe("adaptv-shell/ios-3f9a1c2b")
    expect(config.ios.path).toBe(".adaptv/ios")
    //one platform's build never marks the other's: `dev all` may reuse Android while it
    //rebuilds iOS, and each runtime reads its own key before the shared one
    expect(config.android.appendUserAgent).toBeUndefined()
    expect(config.appendUserAgent).toBeUndefined()
    //the live-reload block the id travels with is untouched
    expect(config.server.url).toBe(DEV_URL)
  })

  it("lands where each native runtime reads it, and the sync copies the config whole", () => {
    //What makes the value ship: the sync writes the env config into the native project as
    //it is, and both runtimes append their own key to the WebView's user agent. Read off the
    //installed sources, so an upgrade that renames a key fails here and not on a device.
    const require = createRequire(path.join(ADAPTV_ROOT, "package.json"))
    const pkg = (name) =>
      path.dirname(require.resolve(`${name}/package.json`))
    const copy = readFileSync(
      path.join(pkg("@capacitor/cli"), "dist/tasks/copy.js"),
      "utf8",
    )
    expect(copy).toContain(
      "writeJSON)(nativeConfigFilePath, config.app.extConfig",
    )
    const ios = path.join(pkg("@capacitor/ios"), "Capacitor/Capacitor")
    expect(
      readFileSync(path.join(ios, "CAPInstanceDescriptor.swift"), "utf8"),
    ).toContain('config[keyPath: "ios.appendUserAgent"]')
    expect(
      readFileSync(
        path.join(ios, "CAPBridgeViewController.swift"),
        "utf8",
      ),
    ).toContain("applicationNameForUserAgent")
    const android = path.join(
      pkg("@capacitor/android"),
      "capacitor/src/main/java/com/getcapacitor",
    )
    expect(
      readFileSync(path.join(android, "CapConfig.java"), "utf8"),
    ).toContain('"android.appendUserAgent"')
    expect(
      readFileSync(path.join(android, "Bridge.java"), "utf8"),
    ).toContain(
      'settings.setUserAgentString(defaultUserAgent + " " + appendUserAgent)',
    )
  })

  it("never reaches a built app", () => {
    expect(JSON.stringify(buildCapacitorConfig(APP))).not.toContain(
      "appendUserAgent",
    )
  })
})

describe("the native fingerprint ignores which build it is", () => {
  it("hashes the same with and without a mark, on either platform", () => {
    const root = tempApp()
    const before = nativeFingerprint(root, "ios")
    stampShellId("ios", "ios-3f9a1c2b")
    expect(nativeFingerprint(root, "ios")).toBe(before)
    //another lane stamping its own platform mid-decision
    stampShellId("android", "android-00ff00ff")
    expect(nativeFingerprint(root, "ios")).toBe(before)
    stampShellId("ios", "ios-deadbeef")
    expect(nativeFingerprint(root, "ios")).toBe(before)
  })

  it("still moves for everything a build contains", () => {
    const root = tempApp()
    stampShellId("ios", "ios-3f9a1c2b")
    const before = nativeFingerprint(root, "ios")
    patchServerUrl("/tmp/app", "http://localhost:41731")
    stampShellId("ios", "ios-3f9a1c2b")
    expect(nativeFingerprint(root, "ios")).not.toBe(before)
  })

  it("leaves an unmarked config byte for byte as it was", () => {
    const json = process.env.ADAPTV_CAPACITOR_CONFIG
    expect(withoutShellMark(json)).toBe(json)
    expect(withoutShellMark(undefined)).toBeUndefined()
    expect(withoutShellMark("not json")).toBe("not json")
  })
})

describe("the run cache reuses an install only when it knows its build", () => {
  const prev = { url: DEV_URL, fp: "abc", shell: "ios-3f9a1c2b" }
  const now = (installed = true) => ({
    url: DEV_URL,
    fp: "abc",
    installed: vi.fn(async () => installed),
  })

  it("reuses an unchanged, installed build it holds the id for", async () => {
    expect(await canReuseInstall(prev, now())).toBe(true)
  })

  it("rebuilds an install it holds no id for, without asking the device", async () => {
    const n = now()
    expect(await canReuseInstall({ url: DEV_URL, fp: "abc" }, n)).toBe(
      false,
    )
    expect(n.installed).not.toHaveBeenCalled()
  })

  it("rebuilds on a native change, a new dev URL, a missing install, or no entry", async () => {
    expect(await canReuseInstall({ ...prev, fp: "xyz" }, now())).toBe(
      false,
    )
    expect(
      await canReuseInstall({ ...prev, url: "http://localhost:1" }, now()),
    ).toBe(false)
    expect(await canReuseInstall(prev, now(false))).toBe(false)
    expect(await canReuseInstall(undefined, now())).toBe(false)
  })
})

describe("what the dev server is told to expect", () => {
  it("starts every platform of the run undecided, so an app already on the device waits", () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios", "android"])
    expect(shells.file).toBe(path.join(root, ".adaptv", "dev-shells.json"))
    expect(readExpectedShells(shells.file)).toEqual({
      ios: null,
      android: null,
    })
  })

  it("walks one old app through the whole run: pending, stale during the rebuild, then only the new build matches", () => {
    const root = tempApp()
    mkdirSync(path.join(root, ".adaptv"), { recursive: true })
    const shells = openShellRegistry(root, ["ios"])
    const server = nativeShellMiddleware(shells.file)
    const verdict = (id) => {
      let body = ""
      server(
        { url: `${SHELL_ENDPOINT}?id=${id}` },
        {
          setHeader() {},
          end(chunk) {
            body = chunk
          },
        },
        () => {},
      )
      return JSON.parse(body).verdict
    }
    const old = "ios-0a0a0a0a"
    //the dev server is up, the native project is still being prepared
    expect(verdict(old)).toBe("pending")
    //the run decided to rebuild: a new id before the sync starts
    const fresh = newShellId("ios")
    stampShellId("ios", fresh)
    shells.expect("ios", fresh)
    expect(verdict(old)).toBe("stale")
    //the rebuilt app launches with the id baked into its config
    expect(
      verdict(
        shellIdFromUserAgent(
          `Mobile/15E148 ${capConfigFromEnv().ios.appendUserAgent}`,
        ),
      ),
    ).toBe("match")
    shells.remove()
    expect(existsSync(shells.file)).toBe(false)
  })
})

describe("a reused install that is not the build the run cache named", () => {
  //Worktree B installs its own build over worktree A's under the same bundle id; back in A every
  //check the cache makes passes, so A reuses the install and expects the build it recorded.
  const ask = (shells, id) => {
    let body = ""
    nativeShellMiddleware(shells.file)(
      { url: `${SHELL_ENDPOINT}?id=${id}` },
      {
        setHeader() {},
        end(chunk) {
          body = chunk
        },
      },
      () => {},
    )
    return JSON.parse(body).verdict
  }

  it("is reported once, as soon as the device asks with its real id", () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios"])
    shells.expect("ios", "ios-0a0a0a0a", { cached: true })
    expect(shells.staleInstalls()).toEqual([])
    expect(ask(shells, "ios-0b0b0b0b")).toBe("stale")
    expect(shells.staleInstalls()).toEqual(["ios"])
    //the notice fires once; the next poll has nothing new to say
    expect(ask(shells, "ios-0b0b0b0b")).toBe("stale")
    expect(shells.staleInstalls()).toEqual([])
  })

  it("is not confused with the old app waiting through a rebuild this run started", () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios"])
    shells.expect("ios", newShellId("ios"))
    expect(ask(shells, "ios-0b0b0b0b")).toBe("stale")
    expect(shells.staleInstalls()).toEqual([])
  })

  it("counts only a stale answer given against the build that was reused", () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios", "android"])
    //seen stale while another build was expected, before this one was reused
    shells.expect("ios", "ios-0c0c0c0c")
    ask(shells, "ios-0b0b0b0b")
    shells.expect("ios", "ios-0a0a0a0a", { cached: true })
    expect(shells.staleInstalls()).toEqual([])
    //and the reused install on the other platform is the one it claims to be
    shells.expect("android", "android-0d0d0d0d", { cached: true })
    expect(ask(shells, "android-0d0d0d0d")).toBe("match")
    expect(shells.staleInstalls()).toEqual([])
  })

  it("leaves nothing of an earlier run behind to be reported", () => {
    const root = tempApp()
    const first = openShellRegistry(root, ["ios"])
    first.expect("ios", "ios-0a0a0a0a", { cached: true })
    ask(first, "ios-0b0b0b0b")
    //killed without its teardown: the next run opens over what it left
    const next = openShellRegistry(root, ["ios"])
    next.expect("ios", "ios-0a0a0a0a", { cached: true })
    expect(next.staleInstalls()).toEqual([])
    ask(next, "ios-0b0b0b0b")
    next.remove()
    expect(existsSync(path.join(root, ".adaptv", SHELLS_SEEN_FILE))).toBe(
      false,
    )
  })
})

describe("a platform this run is not serving", () => {
  const verdict = (shells, id) =>
    nativeShellVerdict(id, readExpectedShells(shells.file))

  it("is named as such to an app from an earlier run polling the same port", () => {
    const root = tempApp()
    //`dev ios`, with last run's Android app still on its offline screen
    const shells = openShellRegistry(root, ["ios"])
    expect(verdict(shells, "android-0b0b0b0b")).toBe("unserved")
    expect(verdict(shells, "ios-0a0a0a0a")).toBe("pending")
  })

  it("includes one the run dropped when its native project could not be prepared", () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios", "android"])
    //iOS failed to prepare; Android goes on to the device
    shells.serveOnly(["android"])
    expect(verdict(shells, "ios-0a0a0a0a")).toBe("unserved")
    expect(verdict(shells, "android-0b0b0b0b")).toBe("pending")
  })
})

describe("a native build that fails", () => {
  const verdict = (shells, id) =>
    nativeShellVerdict(id, readExpectedShells(shells.file))
  //signing, gradle or pods: the build never produced an install
  const signing = () => Promise.reject(new Error("no signing identity"))

  it("names the new build before it starts, and returns it once it lands", async () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios"])
    let during = null
    const shell = await buildNewShell(
      shells,
      "ios",
      { url: DEV_URL, fp: nativeFingerprint(root, "ios") },
      () => {
        during = readExpectedShells(shells.file).ios
        return Promise.resolve()
      },
    )
    expect(during).toBe(shell)
    expect(capConfigFromEnv().ios.appendUserAgent).toBe(
      `${SHELL_TOKEN}/${shell}`,
    )
  })

  it("with nothing native changed, lets the install still on the device reconnect", async () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios"])
    const fp = nativeFingerprint(root, "ios")
    const prev = { url: DEV_URL, fp, shell: "ios-0a0a0a0a" }
    //reused at startup, then `b`
    shells.expect("ios", prev.shell)
    await expect(
      buildNewShell(shells, "ios", { prev, url: DEV_URL, fp }, signing),
    ).rejects.toThrow("no signing identity")
    expect(verdict(shells, prev.shell)).toBe("match")
  })

  it("after a native change, keeps the install waiting: it really is out of date", async () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios"])
    const prev = {
      url: DEV_URL,
      fp: "before-the-change",
      shell: "ios-0a0a0a0a",
    }
    shells.expect("ios", prev.shell)
    await expect(
      buildNewShell(
        shells,
        "ios",
        { prev, url: DEV_URL, fp: nativeFingerprint(root, "ios") },
        signing,
      ),
    ).rejects.toThrow("no signing identity")
    expect(verdict(shells, prev.shell)).toBe("stale")
  })

  it("in one lane of `dev all`, gives back only that platform's install", async () => {
    const root = tempApp()
    const shells = openShellRegistry(root, ["ios", "android"])
    const fp = nativeFingerprint(root, "android")
    const prev = { url: DEV_URL, fp, shell: "android-0b0b0b0b" }
    shells.expect("android", prev.shell)
    const ios = await buildNewShell(
      shells,
      "ios",
      { url: DEV_URL, fp: nativeFingerprint(root, "ios") },
      () => Promise.resolve(),
    )
    await expect(
      buildNewShell(
        shells,
        "android",
        { prev, url: DEV_URL, fp },
        signing,
      ),
    ).rejects.toThrow("no signing identity")
    expect(verdict(shells, prev.shell)).toBe("match")
    expect(verdict(shells, ios)).toBe("match")
  })
})
