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
import { afterAll, describe, it } from "vitest"
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
const list = runnerRequire("native-run/dist/android/utils/list.js")
const run = runnerRequire("native-run/dist/android/utils/run.js")

/**
 * One fake Android SDK for the whole file. Its `platform-tools/adb` logs its argv and answers
 * `adb devices -l` with the same three devices every time:
 *
 * - `emulator-5554` is online and answers `getprop` at once;
 * - `emulator-5556` is online and never answers `getprop` (the sleep outlasts the runner's
 *   hardcoded 5 s by far, so load cannot eat the margin; the runner's own kill ends it);
 * - `emulator-5558` is offline, and `getprop` on it exits 1.
 *
 * `am start -W` hangs, a plain `am start` returns. `getprop dev.bootcomplete` answers `1` on
 * `emulator-5554`, fails every time on `emulator-5560`, and fails three times on
 * `emulator-5562` before answering `1`. Every behaviour hangs off a serial rather than off
 * per-test state, so the tests run concurrently and the 5 s waits overlap instead of adding up.
 *
 * The script runs once before any test: macOS scans a freshly written executable on its first
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
  writeFileSync(
    path.join(root, "devices"),
    [
      "List of devices attached",
      "emulator-5554          device model:Answers device:emu64a transport_id:1",
      "emulator-5556          device model:Silent device:emu64a transport_id:2",
      "emulator-5558          offline transport_id:3",
      "",
    ].join("\n"),
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
  "-s emulator-5556 shell getprop") exec sleep 30 ;;
  "-s emulator-5558 shell getprop") echo "adb: device offline" >&2; exit 1 ;;
  *"am start -W"*) exec sleep 30 ;;
  *"am start"*) echo "Starting: Intent" ;;
  "-s emulator-5554 shell getprop dev.bootcomplete") echo 1 ;;
  "-s emulator-5560 shell getprop dev.bootcomplete") exit 1 ;;
  "-s emulator-5562 shell getprop dev.bootcomplete")
    n=$(cat "${root}/polls-5562" 2>/dev/null || echo 0); n=$((n + 1)); echo $n > "${root}/polls-5562"
    if [ $n -gt 3 ]; then echo 1; else exit 1; fi ;;
esac
`,
  )
  chmodSync(script, 0o755)
  execFileSync(script, ["prime"])
  return {
    root,
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

/** Every server restart any test caused. One is a failure of every test. */
const serverRestarts = () =>
  fake.log().filter((l) => l === "kill-server" || l === "start-server")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

describe.concurrent(
  "the device runner never restarts the machine's adb server",
  () => {
    it("rejects a call that outlives its timeout, and restarts nothing", async ({
      expect,
    }) => {
      await expect(
        adb.execAdb(
          fake.sdk,
          ["-s", "emulator-5556", "shell", "getprop"],
          {
            timeout: 300,
          },
        ),
      ).rejects.toThrow(/did not answer within 300ms/)
      expect(serverRestarts()).toEqual([])
    }, 20_000)

    it("rejects a failed call with adb's own failure, not a retry after the timer", async ({
      expect,
    }) => {
      //Upstream swallowed this exit 1 and let the timer restart the server; the rejection it
      //finally delivered came from the retry. Now the first failure is the answer.
      await expect(
        adb.execAdb(
          fake.sdk,
          ["-s", "emulator-5558", "shell", "getprop"],
          {
            timeout: 2000,
          },
        ),
      ).rejects.toMatchObject({ code: 1, killed: false })
      expect(serverRestarts()).toEqual([])
    }, 20_000)

    it("keeps a silent device for the run, and offers only the answering one as a target", async ({
      expect,
    }) => {
      //Two calls, two jobs. The run side (`selectDeviceByTarget`, `runEmulator`) must still find
      //an emulator by serial when it is too slow to answer getprop, and must still count its port
      //as taken, or a second emulator boots onto it. The listing the picker reads must offer only
      //devices that are online and answered.
      const [devices, targets] = await Promise.all([
        adb.getDevices(fake.sdk),
        list.getDeviceTargets(fake.sdk),
      ])
      expect(
        devices.map((d) => [d.serial, d.state, d.sdkVersion]),
      ).toEqual([
        ["emulator-5554", "device", "34"],
        ["emulator-5556", "device", ""],
        ["emulator-5558", "offline", ""],
      ])
      expect(await run.findAvailableEmulatorPort(devices)).toBe(5560)
      expect(targets.map((t) => [t.id, t.sdkVersion])).toEqual([
        ["emulator-5554", "34"],
      ])
      expect(serverRestarts()).toEqual([])
    }, 20_000)

    it("launches without waiting for the activity to finish drawing", async ({
      expect,
    }) => {
      //`am start -W` waits for the first frame, which a cold emulator can take longer than
      //5 s to draw. With the timeout now a rejection, waiting would fail a launch that is
      //already happening; nothing reads what -W reports.
      await adb.startActivity(
        fake.sdk,
        { serial: "emulator-5554" },
        "dev.arrz.example",
        "dev.arrz.example.MainActivity",
      )
      expect(fake.log().filter((l) => l.includes("am start"))).toEqual([
        "-s emulator-5554 shell am start -n dev.arrz.example/dev.arrz.example.MainActivity",
      ])
      expect(serverRestarts()).toEqual([])
    }, 20_000)

    it("waits out failed boot checks without a rejection or a restart, even 5 s later", async ({
      expect,
    }) => {
      //Upstream swallowed each failed poll and armed a 5 s timer for it that restarted the
      //server, after waitForBoot had long resolved. So the check has to outlast those timers.
      const rejections = []
      const onRejection = (reason) => rejections.push(reason)
      process.on("unhandledRejection", onRejection)
      try {
        const started = Date.now()
        await adb.waitForBoot(fake.sdk, { serial: "emulator-5562" })
        await sleep(Math.max(0, 6500 - (Date.now() - started)))
        const polls = fake
          .log()
          .filter((l) => l.startsWith("-s emulator-5562 "))
        expect(serverRestarts()).toEqual([])
        expect(rejections).toEqual([])
        //three failures and the answer, one poll at a time
        expect(polls.length).toBe(4)
      } finally {
        process.off("unhandledRejection", onRejection)
      }
    }, 20_000)

    it("gives up on a device that fails 50 boot checks in a row", async ({
      expect,
    }) => {
      //A device that went away mid-boot used to be polled every 100 ms forever.
      await expect(
        adb.waitForBoot(fake.sdk, { serial: "emulator-5560" }),
      ).rejects.toThrow(
        /emulator-5560 stopped answering: 50 boot checks in a row failed/,
      )
      const polls = fake
        .log()
        .filter((l) => l.startsWith("-s emulator-5560 "))
      expect(polls.length).toBe(50)
      expect(serverRestarts()).toEqual([])
    }, 30_000)

    it("adaptv's listing offers the answering device next to an offline and a silent one", async ({
      expect,
    }) => {
      //The shape the swarm hit: another session's emulator still booting next to the one the
      //dev wants. Upstream waited 5 s, restarted the server, and dropped every attached device.
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
      expect(serverRestarts()).toEqual([])
    }, 20_000)
  },
)
