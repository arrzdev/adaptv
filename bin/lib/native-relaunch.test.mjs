// @vitest-environment node
import { EventEmitter } from "node:events"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// `relaunchAndroidApp` is the cache-miss path's "force-stop + relaunch so the WebView picks up
// the re-asserted `adb reverse`". It once did that on EVERY connected emulator, so running
// against one disturbed the others (dev-loop debt §D). The fix is `androidSerialForTarget`:
// the target — an AVD name like `Pixel_10`, not a serial — is translated to the ONE serial it
// names, and only an unresolvable target falls back to the old all-devices sweep.
//
// `probe()` is a private `spawn` wrapper, so the seam is `node:child_process` itself: a fake
// `spawn` records every command and answers `adb devices` / `adb emu avd name` from a script.

const fake = vi.hoisted(() => ({
  /** @type {string[][]} every spawned command, as [command, ...args] */
  calls: [],
  /** what `adb devices` prints */
  devices: "",
  /** serial → AVD name, what `adb -s <serial> emu avd name` prints */
  avd: /** @type {Record<string, string>} */ ({}),
  /** serial → what `cmd package resolve-activity` answers there; unlisted serials find the app */
  resolves:
    /** @type {Record<string, { status: number, out: string }>} */ ({}),
  /** serial → how the call that OPENS the app answers there; unlisted serials answer "Status: ok" */
  opens:
    /** @type {Record<string, { status: number, out: string }>} */ ({}),
}))

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    spawn: (command, args) => {
      fake.calls.push([command, ...args])
      const child = new EventEmitter()
      const stdout = new EventEmitter()
      stdout.setEncoding = () => {}
      child.stdout = stdout
      let answer = { status: 0, out: "" }
      const serial = args[1]
      if (command === "adb" && args[0] === "devices")
        answer = { status: 0, out: fake.devices }
      else if (command === "adb" && args[2] === "emu" && args[3] === "avd")
        answer = { status: 0, out: `${fake.avd[serial] ?? ""}\nOK\n` }
      else if (command === "adb" && args[2] === "shell") {
        const [verb, sub] = args.slice(3)
        if (verb === "am" && sub === "force-stop")
          answer = { status: 0, out: "" }
        else if (verb === "cmd" && args.includes("resolve-activity"))
          answer = fake.resolves[serial] ?? RESOLVED
        //Whatever else a relaunch runs on the device is the call that opens the app — the test
        //scripts its ANSWER, never its spelling, so it holds for any launcher.
        else answer = fake.opens[serial] ?? OPENED
      }
      queueMicrotask(() => {
        if (answer.out) stdout.emit("data", answer.out)
        child.emit("close", answer.status)
      })
      return child
    },
  }
})

const { launchInstalledApp, relaunchAndroidApp } = await import(
  "./native.mjs"
)

const APP_ID = "dev.arrz.example"
const COMPONENT = `${APP_ID}/${APP_ID}.MainActivity`

// The answers below are the device's own words, captured from an API 35 AVD (and, for the API
// 24-25 shape, from `Am.java` at android-7.0.0_r1, where `am start -W` prints its error on
// stdout and exits 0).

/** `cmd package resolve-activity --brief -c …LAUNCHER <id>` for an installed app. */
const RESOLVED = {
  status: 0,
  out: `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=false\n${COMPONENT}\n`,
}
/** `am start -W` when the activity came up. */
const OPENED = {
  status: 0,
  out: `Starting: Intent { act=android.intent.action.MAIN cat=[android.intent.category.LAUNCHER] flg=0x10200000 cmp=${COMPONENT} }\nStatus: ok\nLaunchState: COLD\nActivity: ${COMPONENT}\nTotalTime: 1822\nWaitTime: 1824\nComplete\n`,
}
/** What `monkey` says, with exit 251, on an AVD created with `hw.keyboard=no` (avdmanager's default). */
const MONKEY_NO_KEYS = {
  status: 251,
  out: "** SYS_KEYS has no physical keys but with factor 2.0%.\n",
}
const NOT_OPENED = `Error: Activity class {${COMPONENT}} does not exist.`
const TWO_DEVICES =
  "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n"

/** What an `adb -s <serial> shell …` call DOES: `force-stop`, `start`, `cmd`, or nothing. */
const verbOf = (call) =>
  call[0] === "adb" && call[3] === "shell"
    ? call[4] === "am"
      ? call[5]
      : call[4]
    : null

/** The adb calls that CHANGE a device — force-stop and start — as `[serial, verb]`. */
const touches = () =>
  fake.calls
    .filter((c) => ["force-stop", "start"].includes(verbOf(c)))
    .map((c) => [c[2], verbOf(c)])

let savedConfig
beforeEach(() => {
  savedConfig = process.env.ADAPTV_CAPACITOR_CONFIG
  process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify({ appId: APP_ID })
  fake.calls.length = 0
  fake.devices = TWO_DEVICES
  fake.avd = { "emulator-5554": "Pixel_7", "emulator-5556": "Pixel_10" }
  fake.resolves = {}
  fake.opens = {}
})
afterEach(() => {
  if (savedConfig === undefined) delete process.env.ADAPTV_CAPACITOR_CONFIG
  else process.env.ADAPTV_CAPACITOR_CONFIG = savedConfig
})

describe("relaunchAndroidApp touches only the device the run targets", () => {
  it("force-stops and relaunches on the ONE serial the AVD name resolves to", async () => {
    await relaunchAndroidApp("/app", process.env, "Pixel_10")

    //Exactly one device, exactly the two verbs, in that order — and it is the one the
    //name resolved to, not the first in the list.
    expect(touches()).toEqual([
      ["emulator-5556", "force-stop"],
      ["emulator-5556", "start"],
    ])
    //Every adb shell call this made carried `-s <serial>`: with two emulators a bare adb is
    //ambiguous and fails.
    const shell = fake.calls.filter((c) => verbOf(c) !== null)
    expect(shell).toHaveLength(3)
    for (const call of shell)
      expect(call.slice(0, 3)).toEqual(["adb", "-s", "emulator-5556"])
    //The idle emulator was asked its name and nothing else.
    expect(
      fake.calls.filter(([, , serial]) => serial === "emulator-5554"),
    ).toEqual([["adb", "-s", "emulator-5554", "emu", "avd", "name"]])
    //And the app id is the one the run's config carries.
    expect(fake.calls.find((c) => verbOf(c) === "force-stop")).toEqual([
      "adb",
      "-s",
      "emulator-5556",
      "shell",
      "am",
      "force-stop",
      APP_ID,
    ])
  })

  it("takes a serial as-is, without asking any emulator its name", async () => {
    await relaunchAndroidApp("/app", process.env, "emulator-5554")
    expect(touches()).toEqual([
      ["emulator-5554", "force-stop"],
      ["emulator-5554", "start"],
    ])
    expect(fake.calls.some(([, , , verb]) => verb === "emu")).toBe(false)
  })

  //The prior best-effort behaviour, kept ONLY for the case the target cannot be resolved
  //(a name no running emulator answers to). It is the fallback, not the default: the first
  //test fails if this sweep ever becomes the path a resolvable target takes.
  it("falls back to every connected device only when the target is unresolvable", async () => {
    await relaunchAndroidApp("/app", process.env, "Not_A_Running_AVD")
    expect(touches()).toEqual([
      ["emulator-5554", "force-stop"],
      ["emulator-5554", "start"],
      ["emulator-5556", "force-stop"],
      ["emulator-5556", "start"],
    ])
  })

  it("does nothing at all without an app id to name", async () => {
    delete process.env.ADAPTV_CAPACITOR_CONFIG
    await relaunchAndroidApp("/app", process.env, "Pixel_10")
    expect(fake.calls).toEqual([])
  })
})

//The relaunch force-stops the app FIRST, so a launch that fails leaves it closed — and the dev
//loop printed ✓ over it. Measured on an API 35 AVD made by `avdmanager create avd` (whose
//default is `hw.keyboard=no`): monkey refuses to run at all, exits 251, and the app that was
//just force-stopped stays stopped.
describe("relaunchAndroidApp does not call a launch that failed a success", () => {
  it("rejects when the device refuses to open the app", async () => {
    fake.opens = { "emulator-5556": MONKEY_NO_KEYS }
    await expect(
      relaunchAndroidApp("/app", process.env, "Pixel_10"),
    ).rejects.toThrow()
  })

  it("opens the app with the launcher activity it resolved, the way a launcher tap does", async () => {
    await relaunchAndroidApp("/app", process.env, "Pixel_10")
    const start = fake.calls.find((c) => verbOf(c) === "start")
    //Explicit, because an implicit MAIN/LAUNCHER intent cannot start an activity whose filter
    //lacks `category.DEFAULT` — which the app's launcher activity does lack.
    expect(start?.slice(start.indexOf("-n"))).toEqual(["-n", COMPONENT])
    //Waits for the launch, and sends a launcher's intent: an app already running is fronted.
    expect(start).toEqual(
      expect.arrayContaining([
        "-W",
        "android.intent.action.MAIN",
        "android.intent.category.LAUNCHER",
        "0x10200000",
      ]),
    )
  })

  //API 24-25: `am` exits 0 when it started nothing, and says so only in what it printed.
  it("reads the device's answer, not just the exit code", async () => {
    fake.opens = {
      "emulator-5556": { status: 0, out: `Error type 3\n${NOT_OPENED}\n` },
    }
    const failure = await relaunchAndroidApp(
      "/app",
      process.env,
      "Pixel_10",
    ).catch((err) => err)
    expect(failure).toBeInstanceOf(Error)
    //Its own sentence on the ✖ — the build and the install worked — and the device's words
    //under it: the real line, not the `Error type 3` preamble, and without an `Error:` that
    //only restates the ✖.
    expect(failure.message).toBe("installed, but the app did not open")
    expect(failure.fix).toEqual([
      `Activity class {${COMPONENT}} does not exist.`,
    ])
  })

  it("rejects without starting anything when the app has no launcher activity", async () => {
    fake.resolves = {
      "emulator-5556": { status: 0, out: "No activity found\n" },
    }
    await expect(
      relaunchAndroidApp("/app", process.env, "Pixel_10"),
    ).rejects.toThrow("installed, but the app did not open")
    expect(touches()).toEqual([["emulator-5556", "force-stop"]])
  })

  //The sweep exists because the run could not tell which device got the install, so an idle
  //emulator that never had the app says nothing about the one that did.
  it("in the fallback sweep, succeeds when the app opened on a device", async () => {
    fake.resolves = {
      "emulator-5554": { status: 0, out: "No activity found\n" },
    }
    await expect(
      relaunchAndroidApp("/app", process.env, "Not_A_Running_AVD"),
    ).resolves.toBeUndefined()
  })

  it("in the fallback sweep, rejects when it opened on none", async () => {
    fake.opens = {
      "emulator-5554": MONKEY_NO_KEYS,
      "emulator-5556": MONKEY_NO_KEYS,
    }
    await expect(
      relaunchAndroidApp("/app", process.env, "Not_A_Running_AVD"),
    ).rejects.toThrow("installed, but the app did not open")
  })
})

//The cached path and `r` open the app through the same launch, so they get the same honest
//verdict: `false` sends the cached path to a rebuild and `r` to its own ✖.
describe("launchInstalledApp on Android", () => {
  it("is true when the app opened", async () => {
    expect(
      await launchInstalledApp("/app", "android", "Pixel_10", process.env),
    ).toBe(true)
  })

  it("is false when the device did not open it", async () => {
    fake.opens = { "emulator-5556": MONKEY_NO_KEYS }
    expect(
      await launchInstalledApp(
        "/app",
        "android",
        "Pixel_10",
        process.env,
        {
          restart: true,
        },
      ),
    ).toBe(false)
    expect(touches()).toEqual([
      ["emulator-5556", "force-stop"],
      ["emulator-5556", "start"],
    ])
  })
})
