// @vitest-environment node
import { execFileSync } from "node:child_process"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it } from "vitest"
import { listTargets } from "./devices.mjs"

/*
 * The adb server is one process for the whole machine: it owns every attached device's
 * transport and every `adb reverse` mapping, whoever made them. The device runner underneath
 * `cap run` answered any slow or failed adb call by running `adb kill-server` and
 * `adb start-server` and retrying (`dist/android/utils/adb.js` `execAdb`), so a booting
 * emulator that took more than 5 s to answer `getprop` restarted the server under every other
 * adb client on the machine. adaptv's patch (patches/native-run@2.0.3.patch) makes those calls
 * reject instead. These tests drive the patched runner and adaptv's own listing against a fake
 * `adb` that logs every argv, and read the log: `kill-server` must never appear in it.
 */

const require = createRequire(path.join(process.cwd(), "package.json"))
const runnerRequire = createRequire(
  require.resolve("@capacitor/cli/package.json"),
)
const adb = runnerRequire("native-run/dist/android/utils/adb.js")

/**
 * One fake Android SDK for the whole file, whose `platform-tools/adb` logs its argv and
 * answers per serial:
 * `emulator-5554` answers at once, `emulator-5556` never answers within the runner's 5 s,
 * `emulator-5558` is offline and exits 1. `am start -W` hangs past 5 s, a plain `am start`
 * returns, and the first `getprop dev.bootcomplete` fails before later ones answer `1`.
 * `exec sleep` so the runner's own kill on timeout reaches the sleeping process and nothing
 * outlives the test.
 *
 * One script, run once before any test: macOS scans a freshly written executable on its first
 * exec, measured at 240-940 ms here and past 2 s under load, and that latency belongs to the
 * fixture, not to the runner under test. The tests assert which error rejected, never how
 * fast.
 */
function fakeSdk() {
  const root = mkdtempSync(path.join(tmpdir(), "adaptv-fake-adb-"))
  const tools = path.join(root, "sdk", "platform-tools")
  mkdirSync(tools, { recursive: true })
  mkdirSync(path.join(root, "avd"))
  writeFileSync(
    path.join(tools, "package.xml"),
    '<repository><localPackage path="platform-tools"><revision><major>35</major></revision><display-name>Platform-Tools</display-name></localPackage></repository>',
  )
  const log = path.join(root, "adb.log")
  const script = path.join(tools, "adb")
  writeFileSync(
    script,
    `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  "devices -l") cat "${root}/devices" ;;
  "-s emulator-5554 shell getprop") printf '[ro.product.manufacturer]: [Google]\\n[ro.build.version.sdk]: [34]\\n' ;;
  "-s emulator-5556 shell getprop") exec sleep 6 ;;
  "-s emulator-5558 shell getprop") echo "adb: device offline" >&2; exit 1 ;;
  *"am start -W"*) exec sleep 6 ;;
  *"am start"*) echo "Starting: Intent" ;;
  *"getprop dev.bootcomplete")
    if [ -f "${root}/polled" ]; then echo 1; else touch "${root}/polled"; exit 1; fi ;;
esac
`,
  )
  chmodSync(script, 0o755)
  execFileSync(script, ["prime"])
  return {
    root,
    /** A clean log and this test's `adb devices -l` answer. */
    reset: (devicesOutput = "") => {
      writeFileSync(log, "")
      writeFileSync(path.join(root, "devices"), devicesOutput)
      rmSync(path.join(root, "polled"), { force: true })
    },
    sdk: {
      root: path.join(root, "sdk"),
      avdHome: path.join(root, "avd"),
      emulatorHome: root,
    },
    log: () =>
      readFileSync(log, "utf8").trim().split("\n").filter(Boolean),
  }
}

const fake = fakeSdk()
afterAll(() => rmSync(fake.root, { recursive: true, force: true }))
beforeEach(() => fake.reset())

const serverRestarts = (lines) =>
  lines.filter((l) => l === "kill-server" || l === "start-server")

const line = (serial, state, rest = "") =>
  `${serial}          ${state} ${rest}`.trimEnd()

describe("the device runner never restarts the machine's adb server", () => {
  it("rejects a call that outlives its timeout, and restarts nothing", async () => {
    await expect(
      adb.execAdb(fake.sdk, ["-s", "emulator-5556", "shell", "getprop"], {
        timeout: 300,
      }),
    ).rejects.toThrow(/did not answer within 300ms/)
    expect(serverRestarts(fake.log())).toEqual([])
  }, 15_000)

  it("rejects a failed call with adb's own failure, not a retry after the timer", async () => {
    //Upstream swallowed this exit 1 and let the timer restart the server; the rejection it
    //finally delivered came from the retry. Now the first failure is the answer.
    await expect(
      adb.execAdb(fake.sdk, ["-s", "emulator-5558", "shell", "getprop"], {
        timeout: 2000,
      }),
    ).rejects.toMatchObject({ code: 1, killed: false })
    expect(fake.log()).toEqual(["-s emulator-5558 shell getprop"])
    expect(serverRestarts(fake.log())).toEqual([])
  }, 15_000)

  it("lists the devices that answer when one of them does not", async () => {
    //Two emulators attached, one too slow to answer getprop within the runner's hardcoded
    //5 s. Rejecting that call must not take the whole listing with it: the answering device
    //stays, the silent one is left out of this listing, and the server keeps running.
    fake.reset(
      [
        "List of devices attached",
        line("emulator-5554", "device", "model:Answers device:emu64a"),
        line("emulator-5556", "device", "model:Silent device:emu64a"),
        "",
      ].join("\n"),
    )
    const devices = await adb.getDevices(fake.sdk)
    expect(devices.map((d) => [d.serial, d.sdkVersion])).toEqual([
      ["emulator-5554", "34"],
    ])
    expect(serverRestarts(fake.log())).toEqual([])
  }, 15_000)

  it("launches without waiting for the activity to finish drawing", async () => {
    //`am start -W` waits for the first frame, which a cold emulator can take longer than
    //5 s to draw. With the timeout now a rejection, waiting would fail a launch that is
    //already happening; nothing reads what -W reports.
    await adb.startActivity(
      fake.sdk,
      { serial: "emulator-5554" },
      "dev.arrz.example",
      "dev.arrz.example.MainActivity",
    )
    expect(fake.log()).toEqual([
      "-s emulator-5554 shell am start -n dev.arrz.example/dev.arrz.example.MainActivity",
    ])
  }, 15_000)

  it("treats a boot poll that fails as a device that has not booted yet", async () => {
    await adb.waitForBoot(fake.sdk, { serial: "emulator-5554" })
    //a rejected poll would surface as an unhandled rejection after resolve; give it a beat
    await new Promise((r) => setTimeout(r, 300))
    const polls = fake.log()
    expect(polls.length).toBeGreaterThanOrEqual(2)
    expect(serverRestarts(polls)).toEqual([])
  }, 15_000)
})

describe("adaptv's device listing with an offline device attached", () => {
  it("still offers the device that answers, without restarting the adb server", async () => {
    //The shape the swarm hit: another session's emulator still booting (`offline`) next to
    //the one the dev wants. Upstream swallowed the failed getprop, waited 5 s, restarted the
    //server, failed again, and dropped EVERY attached device from the listing.
    fake.reset(
      [
        "List of devices attached",
        line("emulator-5554", "device", "model:Answers device:emu64a"),
        line("emulator-5558", "offline"),
        "",
      ].join("\n"),
    )
    const app = mkdtempSync(path.join(fake.root, "app-"))
    mkdirSync(path.join(app, "android"))
    const targets = await listTargets(app, "android", {
      ...process.env,
      ANDROID_HOME: fake.sdk.root,
      ANDROID_AVD_HOME: fake.sdk.avdHome,
      ANDROID_EMULATOR_HOME: fake.root,
      ADAPTV_CAPACITOR_CONFIG: JSON.stringify({
        appId: "dev.arrz.probe",
        appName: "probe",
        webDir: "www",
      }),
    })
    expect(targets.map((t) => t.id)).toEqual(["emulator-5554"])
    expect(serverRestarts(fake.log())).toEqual([])
  }, 20_000)
})
