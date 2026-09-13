// @vitest-environment node
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { dedupeTargets, versionHint } from "./devices.mjs"
import { namesPlumbing } from "./opacity.mjs"

/*
 * The device listing is a child process (`cap run <platform> --list --json` through adaptv's
 * own shim), and `capture` is the one seam every listing goes through — so the fake answers
 * there, one scripted reply per call, and counts the calls so a test can say whether a stale
 * answer was re-asked.
 */
const fake = vi.hoisted(() => ({
  /** @type {Array<{ stdout?: string, timedOut?: boolean }>} replies, oldest first */
  replies: [],
  /** @type {string[][]} every listing's argv */
  calls: [],
}))

vi.mock("./exec.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    capture: async (_cmd, args, opts) => {
      fake.calls.push([...args, `timeoutMs=${opts?.timeoutMs}`])
      const reply =
        fake.replies.length > 1 ? fake.replies.shift() : fake.replies[0]
      return {
        stdout: reply?.stdout ?? "",
        stderr: "",
        code: 0,
        timedOut: !!reply?.timedOut,
      }
    },
  }
})

/*
 * The interactive picker, for the runs where somebody IS at the keyboard. It answers with the
 * row a test scripts, and keeps the rows it was shown so a test can read their order.
 */
const picker = vi.hoisted(() => ({
  /** @type {(options: Array<{ value: string }>) => string | null} */
  answer: (options) => options[0]?.value ?? null,
  /** @type {Array<Array<{ value: string, label: string }>>} */
  shown: [],
}))

vi.mock("../ui/live.mjs", async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    inkSelect: async (_message, options) => {
      picker.shown.push(options)
      return picker.answer(options)
    },
  }
})

/*
 * R60. The hint is the only thing separating two identically-named devices, so what it says
 * has to be the same KIND of fact on both platforms. Upstream it is not: `iOS 26.1` beside
 * `API 34` puts a version next to an SDK level.
 */
describe("the picker's version hint", () => {
  it("passes iOS through, because it already reads like a version", () => {
    expect(versionHint({ api: "iOS 26.1" })).toBe("iOS 26.1")
    expect(versionHint({ api: "iOS 18.0" })).toBe("iOS 18.0")
  })

  it("says the Android version rather than the SDK level", () => {
    expect(versionHint({ api: "API 34" })).toBe("Android 14")
    expect(versionHint({ api: "API 36" })).toBe("Android 16")
    expect(versionHint({ api: "API 28" })).toBe("Android 9")
  })

  it("reads a minor SDK version as the release it belongs to", () => {
    //Google ships minor levels inside a release, so `36.1` is still Android 16. Whole-number
    //matching left a real emulator in this repo's own picker reading `· API 37.1`.
    expect(versionHint({ api: "API 36.1" })).toBe("Android 16")
    expect(versionHint({ api: "API 34.0" })).toBe("Android 14")
  })

  it("keeps the level it cannot name, instead of inventing a version", () => {
    //a release adaptv has never seen still has to tell two rows apart
    expect(versionHint({ api: "API 99" })).toBe("API 99")
    expect(versionHint({ api: "API 37.1" })).toBe("API 37.1")
  })

  it("gives no hint at all when there is nothing to disambiguate", () => {
    expect(versionHint({})).toBeUndefined()
    expect(versionHint({ api: "" })).toBeUndefined()
  })
})

/*
 * R62. Captured from this machine right after `xcodebuild -downloadPlatform iOS` put iOS 26.1
 * build 23B86 alongside 23B80: two runtimes, one identifier, and the listing walked both.
 * 59 rows for 36 devices, every 26.1 simulator twice under the same id.
 */
describe("one row per device", () => {
  it("drops a device the listing collected twice", () => {
    const listed = [
      {
        name: "iPhone 16 Pro (simulator)",
        api: "iOS 18.0",
        id: "27DF56D5-CE71-4E64-BF48-24A586C9A64C",
      },
      {
        name: "iPhone 16 Pro (simulator)",
        api: "iOS 26.1",
        id: "76A2C5CD-BF8D-4415-B1DA-E5ADF289DD1E",
      },
      {
        name: "iPhone 16 Pro (simulator)",
        api: "iOS 26.1",
        id: "76A2C5CD-BF8D-4415-B1DA-E5ADF289DD1E",
      },
    ]
    expect(dedupeTargets(listed).map((t) => t.api)).toEqual([
      "iOS 18.0",
      "iOS 26.1",
    ])
  })

  it("keeps two devices that only LOOK the same", () => {
    //The R60 case must survive untouched: same name, same version, different device.
    const listed = [
      { name: "iPhone 16 Pro (simulator)", api: "iOS 26.1", id: "aaa" },
      { name: "iPhone 16 Pro (simulator)", api: "iOS 26.1", id: "bbb" },
    ]
    expect(dedupeTargets(listed)).toHaveLength(2)
  })

  it("keeps the first, so the listing's own order stands", () => {
    const listed = [
      { name: "booted one", id: "x" },
      { name: "the repeat", id: "x" },
      { name: "another", id: "y" },
    ]
    expect(dedupeTargets(listed).map((t) => t.name)).toEqual([
      "booted one",
      "another",
    ])
  })
})

/*
 * Listings as the shim really prints them, captured on this machine on 2026-09-13 (trimmed).
 * The listing is the ONLY device inventory adaptv reads for the picker: it never parses
 * `simctl`, `devicectl` or `adb devices -l` itself, so what adaptv owns is this JSON and
 * what it does with a reply that is empty, noisy, or carries a device with no usable id.
 */
const IOS_SIM_18 = {
  name: "iPhone 16 Pro (simulator)",
  api: "iOS 18.0",
  id: "27DF56D5-CE71-4E64-BF48-24A586C9A64C",
}
const IOS_SIM_26 = {
  name: "iPhone 17 Pro (simulator)",
  api: "iOS 26.1",
  id: "74B38563-076B-42D6-A5C3-FC96ABEB7CA8",
}
const IOS_SIM_16 = {
  name: "night-floor-ios16 (simulator)",
  api: "iOS 16.2",
  id: "81C723E1-7B23-4A31-AAAE-A5A107EE9C6D",
}
const ANDROID_LISTING = [
  {
    name: "Google sdk_gphone16k_arm64",
    api: "API 37",
    id: "emulator-5554",
  },
  { name: "Pixel 10 (emulator)", api: "API 37.1", id: "Pixel_10" },
  { name: "Pixel 7 (emulator)", api: "API 34", id: "Pixel_7" },
]
/*
 * Physical devices, as the listing names them: no `(simulator)`/`(emulator)` suffix, and an id
 * that is a hardware identifier rather than a simulator UUID, an AVD name or an emulator serial.
 * The listing puts every physical device BEFORE every virtual one.
 */
const IOS_PHONE = {
  name: "Owner's iPhone",
  api: "iOS 26.0",
  id: "00008130-001A2D3E0C38001E",
}
const ANDROID_PHONE = {
  name: "Pixel 8",
  api: "API 35",
  id: "38141FDJH000YZ",
}
const json = (rows) => ({ stdout: `${JSON.stringify(rows)}\n` })

let appRoot
let saved
beforeEach(() => {
  fake.replies = []
  fake.calls = []
  picker.answer = (options) => options[0]?.value ?? null
  picker.shown = []
  appRoot = mkdtempSync(path.join(tmpdir(), "adaptv-devices-"))
  saved = {
    stdout: Object.getOwnPropertyDescriptor(process.stdout, "isTTY"),
    stdin: Object.getOwnPropertyDescriptor(process.stdin, "isTTY"),
    ci: process.env.CI,
  }
})

afterEach(() => {
  rmSync(appRoot, { recursive: true, force: true })
  for (const [stream, desc] of [
    [process.stdout, saved.stdout],
    [process.stdin, saved.stdin],
  ]) {
    if (desc) Object.defineProperty(stream, "isTTY", desc)
    else delete stream.isTTY
  }
  if (saved.ci === undefined) delete process.env.CI
  else process.env.CI = saved.ci
  vi.resetModules()
})

/**
 * A fresh copy of `devices.mjs` (and the `render.mjs` it prompts through) loaded under the given
 * terminal. `render.mjs` decides whether it can prompt when it LOADS, so the terminal has to be
 * in place before the import, and each test gets its own.
 */
async function devicesUnder({ stdout = false, stdin = false, ci } = {}) {
  vi.resetModules()
  Object.defineProperty(process.stdout, "isTTY", {
    value: stdout,
    configurable: true,
  })
  Object.defineProperty(process.stdin, "isTTY", {
    value: stdin,
    configurable: true,
  })
  if (ci === undefined) delete process.env.CI
  else process.env.CI = ci
  return await import("./devices.mjs")
}

const stateFile = () => path.join(appRoot, ".adaptv", "state.json")
const state = () => JSON.parse(readFileSync(stateFile(), "utf8"))
function remember(devices, extra = {}) {
  mkdirSync(path.dirname(stateFile()), { recursive: true })
  writeFileSync(stateFile(), JSON.stringify({ ...extra, devices }))
}

/** Settle within `ms`, or fail — a picker that waits on stdin must not hang the suite. */
function promptly(promise, ms = 2000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () => reject(new Error(`still waiting after ${ms}ms`)),
        ms,
      ).unref?.(),
    ),
  ])
}

describe("reading the device listing", () => {
  it("asks for the platform's JSON listing, with a ceiling on how long it waits (R59)", async () => {
    const { listTargets } = await devicesUnder()
    fake.replies = [json([IOS_SIM_26])]
    await listTargets(appRoot, "ios", {})
    expect(fake.calls[0]).toEqual([
      expect.stringMatching(/cap\.mjs$/),
      "run",
      "ios",
      "--list",
      "--json",
      "timeoutMs=30000",
    ])
  })

  it("returns every row of a real listing, once per device", async () => {
    const { listTargets } = await devicesUnder()
    fake.replies = [json([IOS_SIM_16, IOS_SIM_18, IOS_SIM_26, IOS_SIM_26])]
    expect(await listTargets(appRoot, "ios", {})).toEqual([
      IOS_SIM_16,
      IOS_SIM_18,
      IOS_SIM_26,
    ])
    fake.replies = [json(ANDROID_LISTING)]
    expect(await listTargets(appRoot, "android", {})).toEqual(
      ANDROID_LISTING,
    )
  })

  it("drops a device the listing could not identify", async () => {
    //The listing spells a missing id `?`. That is a paired phone it reached but could not name
    //(a network-paired iPhone whose lockdown record has no UniqueDeviceID) — a row the dev
    //could pick and adaptv could never launch on.
    const { listTargets } = await devicesUnder()
    fake.replies = [
      json([
        { name: "Owner's iPhone", api: "iOS 26.0", id: "?" },
        { name: "No id at all", api: "iOS 26.0" },
        IOS_SIM_26,
      ]),
    ]
    expect(await listTargets(appRoot, "ios", {})).toEqual([IOS_SIM_26])
  })

  it("reads an empty or failed listing as no devices, not as an error", async () => {
    //A listing that failed outright (a paired phone that will not answer and nothing else to
    //list) writes its reason to stderr and nothing to stdout.
    const { listTargets } = await devicesUnder()
    for (const stdout of ["", "[]\n", "not json at all\n"]) {
      fake.replies = [{ stdout }]
      expect(await listTargets(appRoot, "ios", {})).toEqual([])
    }
  })

  it("finds the listing behind a line of noise", async () => {
    const { listTargets } = await devicesUnder()
    fake.replies = [
      { stdout: `No devices found.\n${JSON.stringify([IOS_SIM_18])}\n` },
    ]
    expect(await listTargets(appRoot, "ios", {})).toEqual([IOS_SIM_18])
  })

  it("names the one command that fixes a platform service that stopped answering", async () => {
    const { listTargets } = await devicesUnder()
    fake.replies = [{ timedOut: true }]
    const ios = await listTargets(appRoot, "ios", {}).catch((e) => e)
    expect(ios.message).toMatch(/iOS simulator service stopped responding/)
    expect(ios.message).toContain("'sudo launchctl kickstart -k")
    const android = await listTargets(appRoot, "android", {}).catch(
      (e) => e,
    )
    expect(android.message).toMatch(
      /Android device bridge stopped responding/,
    )
    expect(android.message).toContain("'adb kill-server'")
    for (const e of [ios, android])
      expect(namesPlumbing(e.message)).toBe(false)
  })
})

describe("--target", () => {
  it("uses a listed device and remembers it for --latest, keeping the rest of the state", async () => {
    const { resolveTarget } = await devicesUnder()
    remember({}, { build: { web: "fp" } })
    fake.replies = [json([IOS_SIM_18, IOS_SIM_26])]
    const got = await resolveTarget(
      appRoot,
      "ios",
      {},
      { target: IOS_SIM_26.id },
    )
    expect(got).toEqual({
      id: IOS_SIM_26.id,
      name: IOS_SIM_26.name,
      source: "target",
    })
    expect(state().devices.ios).toEqual({
      id: IOS_SIM_26.id,
      name: IOS_SIM_26.name,
    })
    expect(state().build).toEqual({ web: "fp" })
  })

  it("re-lists before refusing an id the earlier listing did not have", async () => {
    //the prefetch is up to two seconds old; a simulator booted in between is still a real target
    const { resolveTarget } = await devicesUnder()
    fake.replies = [json([IOS_SIM_18, IOS_SIM_26])]
    const got = await resolveTarget(
      appRoot,
      "ios",
      {},
      {
        target: IOS_SIM_26.id,
        prefetch: Promise.resolve([IOS_SIM_18]),
      },
    )
    expect(got.source).toBe("target")
    expect(fake.calls).toHaveLength(1)
  })

  it("refuses an unknown id with a clear sentence, and remembers nothing", async () => {
    const { resolveTarget } = await devicesUnder()
    remember({ ios: { id: IOS_SIM_18.id, name: IOS_SIM_18.name } })
    fake.replies = [json([IOS_SIM_18, IOS_SIM_26])]
    const err = await resolveTarget(
      appRoot,
      "ios",
      {},
      {
        target: "iPhone-typo",
        prefetch: Promise.resolve([IOS_SIM_18, IOS_SIM_26]),
      },
    ).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe(
      `unknown ios device "iPhone-typo". Run 'adaptv dev ios' to pick from the current list.`,
    )
    expect(namesPlumbing(err.message)).toBe(false)
    //the stale prefetch was not trusted with a negative: one fresh listing was asked first
    expect(fake.calls).toHaveLength(1)
    //a typo must never become the device every later --latest reaches for
    expect(state().devices.ios.id).toBe(IOS_SIM_18.id)
  })
})

describe("--latest", () => {
  it("reuses the remembered device while it is still listed, without asking", async () => {
    const { resolveTarget } = await devicesUnder()
    remember({ ios: { id: IOS_SIM_26.id, name: IOS_SIM_26.name } })
    fake.replies = [json([IOS_SIM_18, IOS_SIM_26])]
    expect(
      await resolveTarget(appRoot, "ios", {}, { latest: true }),
    ).toEqual({
      id: IOS_SIM_26.id,
      name: IOS_SIM_26.name,
      source: "latest",
    })
  })

  it("re-lists before deciding the remembered device is gone", async () => {
    const { resolveTarget } = await devicesUnder()
    remember({ ios: { id: IOS_SIM_26.id, name: IOS_SIM_26.name } })
    fake.replies = [json([IOS_SIM_18, IOS_SIM_26])]
    const got = await resolveTarget(
      appRoot,
      "ios",
      {},
      {
        latest: true,
        prefetch: Promise.resolve([IOS_SIM_18]),
      },
    )
    expect(got.source).toBe("latest")
  })

  it("falls through to the picker when the remembered device is gone, and remembers the new pick", async () => {
    //`--latest` means "don't ask me again", not "fail if my last choice is gone"
    const { resolveTarget } = await devicesUnder({
      stdout: true,
      stdin: true,
    })
    remember({
      ios: {
        id: "0DEAD000-0000-0000-0000-000000000000",
        name: "deleted sim",
      },
      android: { id: "Pixel_7", name: "Pixel 7 (emulator)" },
    })
    fake.replies = [json([IOS_SIM_18, IOS_SIM_26])]
    const got = await promptly(
      resolveTarget(appRoot, "ios", {}, { latest: true }),
    )
    expect(got).toEqual({
      id: IOS_SIM_18.id,
      name: IOS_SIM_18.name,
      source: "picked",
    })
    expect(state().devices).toEqual({
      ios: { id: IOS_SIM_18.id, name: IOS_SIM_18.name },
      android: { id: "Pixel_7", name: "Pixel 7 (emulator)" },
    })
  })

  it("asks when nothing is remembered, or the remembered state is unreadable", async () => {
    const { resolveTarget } = await devicesUnder({
      stdout: true,
      stdin: true,
    })
    fake.replies = [json([IOS_SIM_26])]
    expect(
      (await promptly(resolveTarget(appRoot, "ios", {}, { latest: true })))
        .source,
    ).toBe("picked")
    writeFileSync(stateFile(), "{ half-writ")
    expect(
      (await promptly(resolveTarget(appRoot, "ios", {}, { latest: true })))
        .source,
    ).toBe("picked")
    expect(picker.shown).toHaveLength(2)
  })
})

/*
 * `docs/design/cli-contract.md` R34 and `select` in render.mjs: off a TTY nobody can press a key,
 * so a device picker answers for itself rather than waiting — "any simulator will do". The memory
 * `preview-ios-headless-needs-target` is what waiting costs — 11 minutes on `which ios device?`.
 */
describe("with nobody at the keyboard", () => {
  const SEVERAL = [IOS_SIM_16, IOS_SIM_18, IOS_SIM_26]
  const UNANSWERED = [
    ["output piped", { stdout: false, stdin: true }],
    ["input from /dev/null", { stdout: true, stdin: false }],
    ["under CI", { stdout: true, stdin: true, ci: "1" }],
  ]

  for (const [why, terminal] of UNANSWERED) {
    it(`takes the first of several simulators instead of prompting (${why})`, async () => {
      const { resolveTarget } = await devicesUnder(terminal)
      fake.replies = [json(SEVERAL)]
      const got = await promptly(resolveTarget(appRoot, "ios", {}, {}))
      expect(got).toEqual({
        id: IOS_SIM_16.id,
        name: IOS_SIM_16.name,
        source: "picked",
      })
      expect(picker.shown).toHaveLength(0)
    })

    it(`takes a simulator over the phone the listing puts first (${why})`, async () => {
      //Installing on somebody's phone, in a run nobody is watching, is not "any simulator will
      //do". The listing puts physical devices first, so the first row was the phone.
      const { resolveTarget } = await devicesUnder(terminal)
      fake.replies = [json([IOS_PHONE, ...SEVERAL])]
      expect(
        (await promptly(resolveTarget(appRoot, "ios", {}, {}))).id,
      ).toBe(IOS_SIM_16.id)
    })
  }

  it("takes an emulator over an Android phone, a running one before an AVD", async () => {
    //A running emulator is listed as a serial with no `(emulator)` suffix, beside the phones —
    //it is still an emulator, and the one already booted.
    const { resolveTarget } = await devicesUnder()
    fake.replies = [json([ANDROID_PHONE, ...ANDROID_LISTING])]
    expect(
      (await promptly(resolveTarget(appRoot, "android", {}, {}))).id,
    ).toBe("emulator-5554")
    fake.replies = [json([ANDROID_PHONE, ...ANDROID_LISTING.slice(1)])]
    expect(
      (await promptly(resolveTarget(appRoot, "android", {}, {}))).id,
    ).toBe("Pixel_10")
  })

  it("still takes the phone when it is the only device there is", async () => {
    const { resolveTarget } = await devicesUnder()
    fake.replies = [json([IOS_PHONE])]
    expect(
      (await promptly(resolveTarget(appRoot, "ios", {}, {}))).id,
    ).toBe(IOS_PHONE.id)
    fake.replies = [json([ANDROID_PHONE])]
    expect(
      (await promptly(resolveTarget(appRoot, "android", {}, {}))).id,
    ).toBe(ANDROID_PHONE.id)
  })

  it("remembers nothing, so the device the dev picked is still the one --latest reaches for", async () => {
    //'--latest' is "the last device you picked". A run that answered for itself picked nothing.
    const { resolveTarget } = await devicesUnder()
    remember({ ios: { id: IOS_SIM_26.id, name: IOS_SIM_26.name } })
    fake.replies = [json([IOS_PHONE, ...SEVERAL])]
    expect(
      (await promptly(resolveTarget(appRoot, "ios", {}, {}))).id,
    ).toBe(IOS_SIM_16.id)
    expect(state().devices.ios.id).toBe(IOS_SIM_26.id)
    expect(
      (await promptly(resolveTarget(appRoot, "ios", {}, { latest: true })))
        .id,
    ).toBe(IOS_SIM_26.id)
  })

  it("refuses at once when there is no device at all", async () => {
    const { resolveTarget } = await devicesUnder()
    fake.replies = [json([])]
    const err = await promptly(
      resolveTarget(appRoot, "ios", {}, { prefetch: Promise.resolve([]) }),
    ).catch((e) => e)
    expect(err.message).toBe(
      "no ios devices or simulators found. Boot a simulator/emulator (or connect a device) and try again.",
    )
    expect(namesPlumbing(err.message)).toBe(false)
    //an empty prefetch is the one answer never trusted: it was listed again before refusing
    expect(fake.calls).toHaveLength(1)
  })

  it("does not trust an empty or failed earlier listing", async () => {
    const { resolveTarget } = await devicesUnder()
    fake.replies = [json([IOS_SIM_26])]
    expect(
      (
        await resolveTarget(
          appRoot,
          "ios",
          {},
          { prefetch: Promise.resolve([]) },
        )
      ).id,
    ).toBe(IOS_SIM_26.id)
    expect(
      (
        await resolveTarget(
          appRoot,
          "ios",
          {},
          {
            prefetch: Promise.reject(new Error("listing died")),
          },
        )
      ).id,
    ).toBe(IOS_SIM_26.id)
  })
})

describe("with somebody at the keyboard", () => {
  it("shows every device in the listing's own order, phones included, and remembers the pick", async () => {
    //A person reads the list, so it is not reordered for them; only a run nobody can answer
    //has to choose, and only that choice prefers a simulator.
    const { resolveTarget } = await devicesUnder({
      stdout: true,
      stdin: true,
    })
    fake.replies = [json([IOS_PHONE, IOS_SIM_18, IOS_SIM_26])]
    picker.answer = (options) => options[2].value
    const got = await promptly(resolveTarget(appRoot, "ios", {}, {}))
    expect(picker.shown[0].map((o) => o.value)).toEqual([
      IOS_PHONE.id,
      IOS_SIM_18.id,
      IOS_SIM_26.id,
    ])
    expect(got).toEqual({
      id: IOS_SIM_26.id,
      name: IOS_SIM_26.name,
      source: "picked",
    })
    expect(state().devices.ios).toEqual({
      id: IOS_SIM_26.id,
      name: IOS_SIM_26.name,
    })
  })
})
