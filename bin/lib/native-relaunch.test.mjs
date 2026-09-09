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
      let out = ""
      if (command === "adb" && args[0] === "devices") out = fake.devices
      if (command === "adb" && args[2] === "emu" && args[3] === "avd")
        out = `${fake.avd[args[1]] ?? ""}\nOK\n`
      queueMicrotask(() => {
        if (out) stdout.emit("data", out)
        child.emit("close", 0)
      })
      return child
    },
  }
})

const { relaunchAndroidApp } = await import("./native.mjs")

const APP_ID = "dev.arrz.example"
const TWO_DEVICES =
  "List of devices attached\nemulator-5554\tdevice\nemulator-5556\tdevice\n"

/** What an `adb -s <serial> shell …` call DOES: `am force-stop`, `monkey`, or nothing. */
const verbOf = (call) =>
  call[0] === "adb" && call[3] === "shell"
    ? call[4] === "am"
      ? call[5]
      : call[4]
    : null

/** The adb calls that TOUCH a device — force-stop and monkey — as `[serial, verb]`. */
const touches = () =>
  fake.calls
    .filter((c) => ["force-stop", "monkey"].includes(verbOf(c)))
    .map((c) => [c[2], verbOf(c)])

let savedConfig
beforeEach(() => {
  savedConfig = process.env.ADAPTV_CAPACITOR_CONFIG
  process.env.ADAPTV_CAPACITOR_CONFIG = JSON.stringify({ appId: APP_ID })
  fake.calls.length = 0
  fake.devices = TWO_DEVICES
  fake.avd = { "emulator-5554": "Pixel_7", "emulator-5556": "Pixel_10" }
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
      ["emulator-5556", "monkey"],
    ])
    //Every adb call this made carried `-s <serial>`: with two emulators a bare adb is
    //ambiguous and fails.
    const touching = fake.calls.filter((c) =>
      ["force-stop", "monkey"].includes(verbOf(c)),
    )
    expect(touching).toHaveLength(2)
    for (const call of touching)
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
      ["emulator-5554", "monkey"],
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
      ["emulator-5554", "monkey"],
      ["emulator-5556", "force-stop"],
      ["emulator-5556", "monkey"],
    ])
  })

  it("does nothing at all without an app id to name", async () => {
    delete process.env.ADAPTV_CAPACITOR_CONFIG
    await relaunchAndroidApp("/app", process.env, "Pixel_10")
    expect(fake.calls).toEqual([])
  })
})
