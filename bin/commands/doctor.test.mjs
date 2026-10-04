// @vitest-environment node
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { loadAdaptvModule } from "../lib/load-ts.mjs"
import { namesPlumbing } from "../lib/opacity.mjs"

/**
 * `adaptv doctor` is the command a dev runs when something is already wrong, so what each row
 * says for each outcome is the whole product of it. `cli-process.test.mjs` spawns it once, on
 * whatever machine runs the suite, and can only ever see the outcomes that machine has.
 *
 * Here the machine is scripted. The seam is where doctor meets it: `spawnSync` answers every
 * tool it asks for a version (nothing real runs, not even the native CLI's `--version`),
 * `existsSync` decides whether Android Studio's bundled JDK is installed, and `homedir` is a
 * scratch directory. Everything else is real: the renderer, adaptv's own install, the
 * framework's project checks, and an app root on disk. Each case renders the page through the
 * engine and reads BOTH streams, and every page is held to the opacity boundary.
 */

const ROOT = process.cwd()
const SHIM = path.join(ROOT, "bin/lib/cap.mjs")
const JBR_JAVA =
  "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java"
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

const machine = vi.hoisted(() => ({
  /** @type {(cmd: string, args: string[]) => { status: number | null, stdout?: string }} */
  answer: () => ({ status: null }),
  /** @type {string[][]} every tool doctor asked */
  calls: [],
  /** Android Studio's bundled JDK is installed. */
  studio: false,
  home: "/nonexistent-home",
}))

vi.mock("node:child_process", async (importOriginal) => {
  /** @type {typeof import("node:child_process")} */
  const actual = await importOriginal()
  /** @type {any} */
  const spawnSync = (cmd, args = []) => {
    machine.calls.push([cmd, ...args])
    const { status, stdout = "", stderr = "" } = machine.answer(cmd, args)
    //A binary that is not there comes back the way node reports it: no status, an error.
    return status === null
      ? {
          status: null,
          stdout: null,
          stderr: null,
          error: Object.assign(new Error(`spawnSync ${cmd} ENOENT`), {
            code: "ENOENT",
          }),
        }
      : { status, stdout, stderr }
  }
  return { ...actual, spawnSync, default: { ...actual, spawnSync } }
})

vi.mock("node:fs", async (importOriginal) => {
  /** @type {typeof import("node:fs")} */
  const actual = await importOriginal()
  /** @param {import("node:fs").PathLike} p */
  const existsSync = (p) =>
    String(p).startsWith("/Applications/Android Studio.app/")
      ? machine.studio && String(p) === JBR_JAVA
      : actual.existsSync(p)
  return { ...actual, existsSync, default: { ...actual, existsSync } }
})

vi.mock("node:os", async (importOriginal) => {
  /** @type {typeof import("node:os")} */
  const actual = await importOriginal()
  const homedir = () => machine.home
  return { ...actual, homedir, default: { ...actual, homedir } }
})

/** The tools a fully set-up Mac answers with. */
const HEALTHY = {
  node: "v26.0.0\n",
  cap: "8.4.3\n",
  adb: "Android Debug Bridge version 1.0.41\nVersion 36.0.0\n",
  xcodebuild: "Xcode 26.1.1\nBuild version 17B100\n",
  pod: "1.17.0\n",
  podOnPath: true,
  podResolved: "1.16.2\n",
}

/**
 * Script the machine. A tool set to `null` is not installed.
 * @param {Record<string, string | boolean | null | { stdout?: string, stderr?: string }>} overrides
 */
function tools(overrides = {}) {
  const t = { ...HEALTHY, ...overrides }
  //A string is what the tool prints on stdout; an object says which stream it used.
  const ok = (said) =>
    said === null
      ? { status: null }
      : typeof said === "string"
        ? { status: 0, stdout: said }
        : { status: 0, ...said }
  machine.answer = (cmd, args) => {
    if (cmd === process.execPath && args[0] === SHIM) return ok(t.cap)
    if (cmd === "node") return ok(t.node)
    if (cmd.endsWith("/platform-tools/adb")) return ok(t.adb)
    if (cmd === "xcodebuild") return ok(t.xcodebuild)
    if (cmd === "pod") return ok(t.pod)
    if (cmd === "sh") return { status: t.podOnPath ? 0 : 1 }
    if (cmd === "bash") return ok(t.podResolved)
    return { status: null }
  }
}

const dirs = []
const scratch = (name) => {
  const d = mkdtempSync(path.join(tmpdir(), `adaptv-doctor-${name}-`))
  dirs.push(d)
  return d
}

/** A JDK the way `JAVA_HOME` points at one. */
function jdk() {
  const home = scratch("jdk")
  mkdirSync(path.join(home, "bin"))
  writeFileSync(path.join(home, "bin/java"), "")
  return home
}

let app = ""
let sdk = ""

beforeEach(() => {
  machine.calls = []
  machine.studio = false
  machine.home = scratch("home")
  tools()
  app = scratch("app")
  sdk = scratch("sdk")
  vi.stubEnv("ANDROID_HOME", sdk)
  vi.stubEnv("ANDROID_SDK_ROOT", undefined)
  vi.stubEnv("JAVA_HOME", jdk())
  vi.stubEnv("ADAPTV_VERBOSE", undefined)
  vi.stubEnv("ADAPTV_CAPACITOR_CONFIG", undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  for (const d of dirs.splice(0))
    rmSync(d, { recursive: true, force: true })
})

/**
 * Run `doctor` in a fresh process's worth of modules: the renderer's journal and the output
 * mode are per process, so a case must not inherit the last one's rows.
 * @param {{ json?: boolean, quiet?: boolean }} [opts]
 */
async function runDoctor({ json = false, quiet = false } = {}) {
  vi.resetModules()
  //Each fresh copy of the modules hooks the process's exit again (exec.mjs stops its
  //children there). A real adaptv loads them once; here a copy's hooks go with the copy,
  //or past ten of them Node prints a leak warning into whichever page is being read.
  const exitHooks = process.listeners("exit")
  const render = await import("../lib/render.mjs")
  const { doctor } = await import("./doctor.mjs")
  const out = []
  const err = []
  const take = (into) => (s) => {
    into.push(String(s))
    return true
  }
  vi.spyOn(process.stdout, "write").mockImplementation(take(out))
  vi.spyOn(process.stderr, "write").mockImplementation(take(err))
  //The exit code is per process too, and a case that let one through would hide it from
  //every case after it.
  const before = process.exitCode
  process.exitCode = undefined
  let exitCode
  try {
    render.setOutputMode({ json, quiet })
    await doctor(app)
    render.emitJson({ command: "doctor" })
  } finally {
    exitCode = process.exitCode
    process.exitCode = before
    vi.restoreAllMocks()
    for (const hook of process.listeners("exit"))
      if (!exitHooks.includes(hook)) process.off("exit", hook)
  }
  const stdout = out.join("").replace(ANSI, "")
  const stderr = err.join("").replace(ANSI, "")
  //Held on every page, so no case can forget it: doctor never names the engines (R8, R71)
  //outside '--verbose', never draws a second glyph set (R26), and quotes with ' (R43). On
  //BOTH streams: under '--json' a failure speaks on stderr.
  const both = `${stdout}\n${stderr}`.split("\n")
  if (process.env.ADAPTV_VERBOSE !== "1")
    expect(
      both.filter((l) => namesPlumbing(l)),
      "doctor named the engines",
    ).toEqual([])
  expect(
    both.filter((l) => /[✔✗⚠`]/.test(l)),
    "doctor spoke a second visual language",
  ).toEqual([])
  return {
    lines: stdout.split("\n"),
    stdout,
    stderr,
    doc: json ? JSON.parse(stdout) : null,
    exitCode,
  }
}

/** The row a label settles on, or undefined. */
const row = (lines, label) =>
  lines.find((l) => /^ {2}[✓✖○] /.test(l) && l.slice(4).startsWith(label))

/** The dim lines hanging under a row, up to the next blank. */
function under(lines, label) {
  const at = lines.indexOf(row(lines, label) ?? "\0")
  if (at < 0) return []
  const rest = []
  for (const l of lines.slice(at + 1)) {
    if (!l.startsWith("    ")) break
    rest.push(l.slice(4))
  }
  return rest
}

describe("a machine with everything installed", () => {
  it("renders the whole report, every row passing", async () => {
    const { stdout, stderr, exitCode } = await runDoctor()
    expect(
      stdout
        .replaceAll(sdk, "<sdk>")
        .replaceAll(process.env.JAVA_HOME, "<jdk>"),
    ).toBe(
      [
        "",
        "  adaptv · doctor",
        "",
        "  toolchain for building native iOS / Android from this app",
        "",
        "  Core",
        "  ✓ node  · v26.0.0",
        "  ✓ adaptv's own install  · complete",
        "",
        "  Android",
        "  ✓ Android SDK  · <sdk>",
        "  ✓ JDK  · <jdk>",
        "  ✓ adb  · Android Debug Bridge version 1.0.41",
        "",
        "  iOS (macOS only)",
        "  ✓ xcodebuild  · Xcode 26.1.1",
        "  ✓ cocoapods (pod)  · 1.17.0",
        "",
        "  Project",
        "  ○ .adaptv/android project",
        "  ○ .adaptv/ios project",
        "  ○ 'icons' (icon source)  · adaptv's default mark",
        "",
        "  Project checks",
        "  ✓ no issues found",
        "",
        "",
      ].join("\n"),
    )
    expect(stderr).toBe("")
    expect(exitCode).toBeUndefined()
  })

  it("asks each tool for its version, and the native CLI through adaptv's shim", async () => {
    await runDoctor()
    expect(machine.calls).toEqual(
      expect.arrayContaining([
        ["node", "--version"],
        [process.execPath, SHIM, "--version"],
        [path.join(sdk, "platform-tools/adb"), "version"],
        ["xcodebuild", "-version"],
        ["pod", "--version"],
      ]),
    )
    //`pod` answered on PATH, so the login-shell lookup is never paid for.
    expect(machine.calls.some(([cmd]) => cmd === "bash")).toBe(false)
  })

  it("serialises every row under '--json', with nothing else on stdout", async () => {
    const { doc, stderr } = await runDoctor({ json: true })
    //Nothing failed, so nothing speaks on stderr either.
    expect(stderr).toBe("")
    expect(doc.ok).toBe(true)
    expect(doc.command).toBe("doctor")
    expect(
      doc.steps.map(({ label, ok, optional }) => [label, ok, optional]),
    ).toEqual([
      ["node", true, false],
      ["adaptv's own install", true, false],
      ["Android SDK", true, false],
      ["JDK", true, false],
      ["adb", true, true],
      ["xcodebuild", true, true],
      ["cocoapods (pod)", true, true],
      [".adaptv/android project", false, true],
      [".adaptv/ios project", false, true],
      ["'icons' (icon source)", false, true],
      ["no issues found", true, false],
    ])
    expect(doc.steps[0].note).toBe("v26.0.0")
    expect(doc.error).toBeUndefined()
  })

  it("prints nothing under '--quiet', because nothing failed", async () => {
    //A passing row is the report's narration, not the run's outcome: the outcome of a
    //machine that can build is the exit code. '--quiet' printed nothing here before the
    //run could fail, and it still does.
    const { stdout, stderr, exitCode } = await runDoctor({ quiet: true })
    expect(stdout).toBe("")
    expect(stderr).toBe("")
    expect(exitCode).toBeUndefined()
  })
})

describe("a required tool that is missing", () => {
  it("is a red row, and the report goes on past it", async () => {
    tools({ node: null })
    vi.stubEnv("JAVA_HOME", undefined)
    vi.stubEnv("ANDROID_HOME", path.join(sdk, "absent"))
    const { lines, stdout, stderr, exitCode } = await runDoctor()
    //No note: a tool that did not answer has no version to show.
    expect(row(lines, "node")).toBe("  ✖ node")
    expect(row(lines, "JDK")).toBe(
      "  ✖ JDK  · install Android Studio or set JAVA_HOME",
    )
    expect(row(lines, "Android SDK")).toBe(
      `  ✖ Android SDK  · ${path.join(sdk, "absent")}`,
    )
    //Everything after the failures still ran, to the last row and the closing gap.
    expect(row(lines, "no issues found")).toBe("  ✓ no issues found")
    expect(
      stdout.endsWith("  Project checks\n  ✓ no issues found\n\n"),
    ).toBe(true)
    //The run fails, and says nothing more than its rows already did: no summary, no second
    //`✖` on stderr for a failure the page has already drawn (R2, R18).
    expect(exitCode).toBe(1)
    expect(stderr).toBe("")
  })

  it("fails the run, and '--json' says so with the row's name", async () => {
    //Closes the gap #192 pinned: a red row was on the page and in `steps` while the run
    //exited 0 with `ok: true`. R46 in docs/design/cli-contract.md has a failing run's
    //`--json` document carry `ok:false` and a structured `error`.
    tools({ node: null })
    const { doc, stderr, exitCode } = await runDoctor({ json: true })
    //The page is gone under '--json', and stderr always speaks (R46): the red row, as drawn.
    expect(stderr).toBe("  ✖ node\n")
    expect(doc.steps.find((s) => s.label === "node")).toEqual({
      label: "node",
      ok: false,
      optional: false,
    })
    expect(doc.ok).toBe(false)
    expect(doc.error).toEqual({
      kind: "check-failed",
      labels: ["node"],
      message: "1 check failed: node",
    })
    expect(exitCode).toBe(1)
  })

  it("keeps every red row under '--quiet', and nothing that passed", async () => {
    //R46: a run that fails under '--quiet' with nothing on either stream "is not quiet, it
    //is broken". Failing the run is what made that silence a failure.
    tools({ node: null })
    vi.stubEnv("JAVA_HOME", undefined)
    vi.stubEnv("ANDROID_HOME", path.join(sdk, "absent"))
    const { stdout, stderr, exitCode } = await runDoctor({ quiet: true })
    expect(stdout).toBe(
      [
        "  ✖ node",
        `  ✖ Android SDK  · ${path.join(sdk, "absent")}`,
        "  ✖ JDK  · install Android Studio or set JAVA_HOME",
        "",
      ].join("\n"),
    )
    expect(stderr).toBe("")
    expect(exitCode).toBe(1)
  })

  it("names every failing row, in page order, and only the failing ones", async () => {
    tools({ node: null, adb: null })
    vi.stubEnv("JAVA_HOME", undefined)
    vi.stubEnv("ANDROID_HOME", path.join(sdk, "absent"))
    const { doc, exitCode } = await runDoctor({ json: true })
    expect(doc.error.labels).toEqual(["node", "Android SDK", "JDK"])
    expect(doc.error.message).toBe(
      "3 checks failed: node, Android SDK, JDK",
    )
    //The error and the steps are one account of the run, never two.
    expect(doc.error.labels).toEqual(
      doc.steps.filter((s) => !s.ok && !s.optional).map((s) => s.label),
    )
    expect(exitCode).toBe(1)
  })
})

describe("a tool's version", () => {
  it("is the first line of what it printed, from stderr when stdout is empty", async () => {
    tools({
      xcodebuild: { stderr: "Xcode 16.4\nBuild version 16F6\n" },
      pod: { stdout: "", stderr: "" },
    })
    const { lines } = await runDoctor()
    expect(row(lines, "xcodebuild")).toBe("  ✓ xcodebuild  · Xcode 16.4")
    //A tool that answered with nothing still answered: found, with no note.
    expect(row(lines, "cocoapods (pod)")).toBe("  ✓ cocoapods (pod)")
  })
})

describe("an optional tool that is missing", () => {
  it("is a dim absent row, never a red one", async () => {
    tools({ adb: null, xcodebuild: null })
    const { lines } = await runDoctor()
    expect(row(lines, "adb")).toBe("  ○ adb")
    expect(row(lines, "xcodebuild")).toBe("  ○ xcodebuild")
    expect(lines.some((l) => l.includes("✖"))).toBe(false)
  })

  it("never fails the run", async () => {
    tools({ adb: null, xcodebuild: null, pod: null, podResolved: null })
    const { doc, exitCode } = await runDoctor({ json: true })
    expect(doc.steps.filter((s) => !s.ok).length).toBeGreaterThan(3)
    expect(doc.ok).toBe(true)
    expect(doc.error).toBeUndefined()
    expect(exitCode).toBeUndefined()
  })

  it("looks for 'pod' through a login shell before calling it absent", async () => {
    tools({ pod: null, podOnPath: false })
    const { lines } = await runDoctor()
    expect(row(lines, "cocoapods (pod)")).toBe("  ○ cocoapods (pod)")
    expect(row(lines, "cocoapods (pod, resolved)")).toBe(
      "  ✓ cocoapods (pod, resolved)  · 1.16.2",
    )
    const bash = machine.calls.find(([cmd]) => cmd === "bash")
    expect(bash?.slice(0, 2)).toEqual(["bash", "-lc"])
    expect(bash?.[2]).toMatch(/^PATH=".*" pod --version$/)
  })

  it("says both lookups came back empty when neither found it", async () => {
    tools({ pod: null, podResolved: null, podOnPath: false })
    const { lines } = await runDoctor()
    expect(row(lines, "cocoapods (pod, resolved)")).toBe(
      "  ○ cocoapods (pod, resolved)",
    )
  })
})

describe("where the Android toolchain is looked for", () => {
  it("takes ANDROID_HOME over ANDROID_SDK_ROOT, and finds adb under it", async () => {
    const other = scratch("sdk-root")
    vi.stubEnv("ANDROID_SDK_ROOT", other)
    const { lines } = await runDoctor()
    expect(row(lines, "Android SDK")).toBe(`  ✓ Android SDK  · ${sdk}`)
    expect(machine.calls).toContainEqual([
      path.join(sdk, "platform-tools/adb"),
      "version",
    ])
  })

  it("falls back to ANDROID_SDK_ROOT, then to the default under the home directory", async () => {
    const other = scratch("sdk-root")
    vi.stubEnv("ANDROID_HOME", undefined)
    vi.stubEnv("ANDROID_SDK_ROOT", other)
    expect(row((await runDoctor()).lines, "Android SDK")).toBe(
      `  ✓ Android SDK  · ${other}`,
    )

    vi.stubEnv("ANDROID_SDK_ROOT", undefined)
    const fallback = path.join(machine.home, "Library/Android/sdk")
    expect(row((await runDoctor()).lines, "Android SDK")).toBe(
      `  ✖ Android SDK  · ${fallback}`,
    )
    mkdirSync(fallback, { recursive: true })
    expect(row((await runDoctor()).lines, "Android SDK")).toBe(
      `  ✓ Android SDK  · ${fallback}`,
    )
  })

  it("takes JAVA_HOME's java, and Android Studio's bundled JDK without it", async () => {
    const home = process.env.JAVA_HOME
    machine.studio = true
    expect(row((await runDoctor()).lines, "JDK")).toBe(
      `  ✓ JDK  · ${home}`,
    )

    //A JAVA_HOME with no java in it is not a JDK.
    vi.stubEnv("JAVA_HOME", scratch("not-a-jdk"))
    expect(row((await runDoctor()).lines, "JDK")).toBe(
      "  ✓ JDK  · /Applications/Android Studio.app/Contents/jbr/Contents/Home",
    )
  })
})

describe("adaptv's own install", () => {
  it("is one red row with the action when the native CLI does not run", async () => {
    tools({ cap: null })
    const { lines } = await runDoctor()
    expect(row(lines, "adaptv's own install")).toBe(
      "  ✖ adaptv's own install  · incomplete",
    )
    expect(under(lines, "adaptv's own install")).toEqual([
      "Reinstall with 'pnpm install'.",
      "Run with '--verbose' to list what is missing.",
    ])
  })

  it("fails the run under its own name, which stays opaque even under '--verbose'", async () => {
    //`--verbose` is the one surface where the page may name the engines (R71), and the
    //broken install's detail does. The document's error is not that surface.
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    tools({ cap: null })
    const { doc, exitCode } = await runDoctor({ json: true })
    expect(doc.error.labels).toEqual(["adaptv's own install"])
    expect(namesPlumbing(JSON.stringify(doc.error))).toBe(false)
    expect(exitCode).toBe(1)
  })

  it("keeps its action with its row under '--quiet', and on stderr under '--json'", async () => {
    tools({ cap: null })
    const want = [
      "  ✖ adaptv's own install  · incomplete",
      "    Reinstall with 'pnpm install'.",
      "    Run with '--verbose' to list what is missing.",
      "",
    ].join("\n")
    const quiet = await runDoctor({ quiet: true })
    expect(quiet.stdout).toBe(want)
    expect(quiet.exitCode).toBe(1)
    const json = await runDoctor({ json: true })
    expect(json.stderr).toBe(want)
  })

  it("names what it checked only under '--verbose', the one surface allowed to", async () => {
    vi.stubEnv("ADAPTV_VERBOSE", "1")
    const { lines } = await runDoctor()
    const listed = under(lines, "adaptv's own install")
    expect(listed[0]).toBe("native cli 8.4.3")
    expect(listed.length).toBeGreaterThan(1)
    expect(listed.slice(1).every((l) => namesPlumbing(l))).toBe(true)
  })
})

describe("the project rows", () => {
  it("sees a native project that exists, and says nothing is wrong without one", async () => {
    mkdirSync(path.join(app, ".adaptv/android"), { recursive: true })
    const { lines } = await runDoctor()
    expect(row(lines, ".adaptv/android project")).toBe(
      "  ✓ .adaptv/android project",
    )
    expect(row(lines, ".adaptv/ios project")).toBe(
      "  ○ .adaptv/ios project",
    )
  })

  it("names the icon directory the config names, and counts its art", async () => {
    const icons = path.join(app, "public/icons")
    mkdirSync(icons, { recursive: true })
    for (const f of ["android-chrome-512.png", "apple-touch-icon-180.png"])
      copyFileSync(
        path.join(ROOT, "assets/default-icons", f),
        path.join(icons, f),
      )
    writeFileSync(
      path.join(app, "adaptv.config.ts"),
      'export default { appId: "dev.adaptv.doctor", icons: "./public/icons" }\n',
    )
    const { lines } = await runDoctor()
    expect(row(lines, "./public/icons (icon source)")).toBe(
      "  ✓ ./public/icons (icon source)  · 2 icons",
    )
  })

  it("still reports when the config is refused, and drops all of it", async () => {
    //Best effort by design: the config may be the very thing that is broken. This one names
    //a real icon directory but no 'appId', so it is refused whole, and the icon row falls
    //back to the default rather than half-trusting it.
    const icons = path.join(app, "public/icons")
    mkdirSync(icons, { recursive: true })
    copyFileSync(
      path.join(ROOT, "assets/default-icons/android-chrome-512.png"),
      path.join(icons, "android-chrome-512.png"),
    )
    writeFileSync(
      path.join(app, "adaptv.config.ts"),
      'export default { icons: "./public/icons" }\n',
    )
    const { lines } = await runDoctor()
    expect(row(lines, "'icons' (icon source)")).toBe(
      "  ○ 'icons' (icon source)  · adaptv's default mark",
    )
    expect(row(lines, "no issues found")).toBe("  ✓ no issues found")
  })
})

/**
 * The rules themselves are `src/native/doctor.test.ts`'s. What is pinned here is the wiring: which
 * files doctor feeds them, and that their report reaches the page intact.
 */
describe("the project checks", () => {
  const INFO_PLIST = "<key>WKAppBoundDomains</key><array/>"

  /** The framework's own report for these inputs, as doctor's dim lines. */
  async function report(input) {
    const { runDoctor, formatDiagnostics } =
      await loadAdaptvModule("native/doctor.ts")
    return formatDiagnostics(runDoctor(input)).split("\n")
  }

  /** Everything under the Project checks heading. */
  const checks = (lines) => {
    const at = lines.indexOf("  Project checks")
    return lines
      .slice(at + 1)
      .map((l) => l.replace(/^ {4}/, ""))
      .filter((l) => l.trim() !== "")
  }

  it("prints the framework's report under the heading, and no pass row", async () => {
    mkdirSync(path.join(app, ".adaptv/ios/App/App"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/ios/App/App/Info.plist"),
      INFO_PLIST,
    )
    mkdirSync(path.join(app, ".adaptv/android"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/android/variables.gradle"),
      "ext {\n    targetSdkVersion = 34\n}\n",
    )
    const { lines } = await runDoctor()
    const expected = await report({
      iosInfoPlist: INFO_PLIST,
      androidVariablesGradle: "ext {\n    targetSdkVersion = 34\n}\n",
      hasPrivacyManifest: false,
    })
    expect(expected.length).toBeGreaterThan(3)
    expect(checks(lines)).toEqual(expected.filter((l) => l.trim() !== ""))
    expect(row(lines, "no issues found")).toBeUndefined()
  })

  it("draws every diagnostic in the CLI's own glyphs and quotes", async () => {
    //The report is the framework's text, rendered as doctor's dim lines, so neither
    //engine.test.mjs's glyph scan nor cli-spec's quote rule ever read it: it lives in src/.
    //Every rule fired at once, so nothing on the page can hide from the scan.
    mkdirSync(path.join(app, ".adaptv/ios/App/App"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/ios/App/App/Info.plist"),
      INFO_PLIST,
    )
    mkdirSync(path.join(app, ".adaptv/android"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/android/variables.gradle"),
      "targetSdkVersion = 34\n",
    )
    const found = checks((await runDoctor()).lines)
    const titles = found.filter((l) => !l.startsWith(" "))
    expect(titles).toHaveLength(3)
    //An error takes the failure glyph and a warning the notice glyph, as on every other row.
    expect(titles.map((l) => l.slice(0, 2))).toEqual(["✖ ", "✖ ", "! "])
  })

  it("fails the run on an error, and hands '--json' each finding where its glyph puts it", async () => {
    //B22 in docs/decisions/register.md: doctor should "fail loudly" on this trap. An error
    //(`✖`) is a failed step; a warning (`!`) is a notice (R5) and fails nothing.
    mkdirSync(path.join(app, ".adaptv/ios/App/App"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/ios/App/App/Info.plist"),
      INFO_PLIST,
    )
    mkdirSync(path.join(app, ".adaptv/android"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/android/variables.gradle"),
      "targetSdkVersion = 34\n",
    )
    const [appBound, privacy, target] = await report({
      iosInfoPlist: INFO_PLIST,
      androidVariablesGradle: "targetSdkVersion = 34\n",
      hasPrivacyManifest: false,
    })
      .then((l) => l.filter((t) => /^[✖!] /.test(t)))
      .then((l) => l.map((t) => t.slice(2)))
    const { doc, exitCode } = await runDoctor({ json: true })
    expect(doc.steps.slice(-2)).toEqual([
      { label: appBound, ok: false, optional: false },
      { label: privacy, ok: false, optional: false },
    ])
    expect(doc.notices).toEqual([target])
    expect(doc.ok).toBe(false)
    expect(doc.error.labels).toEqual([appBound, privacy])
    expect(exitCode).toBe(1)
  })

  it("keeps the errors' report under '--quiet' and on stderr under '--json', never the warning's", async () => {
    mkdirSync(path.join(app, ".adaptv/ios/App/App"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/ios/App/App/Info.plist"),
      INFO_PLIST,
    )
    mkdirSync(path.join(app, ".adaptv/android"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/android/variables.gradle"),
      "targetSdkVersion = 34\n",
    )
    //The framework's own report for the two errors alone, as doctor's dim lines.
    const errors = (
      await report({ iosInfoPlist: INFO_PLIST, hasPrivacyManifest: false })
    ).map((l) => `    ${l}\n`)
    const want = errors.join("")
    expect(errors.filter((l) => l.startsWith("    ✖ "))).toHaveLength(2)
    const quiet = await runDoctor({ quiet: true })
    expect(quiet.stdout).toBe(want)
    expect(quiet.stdout).not.toMatch(/Android target SDK/)
    expect(quiet.exitCode).toBe(1)
    const json = await runDoctor({ json: true })
    expect(json.stderr).toBe(want)
  })

  it("does not fail the run on a warning alone", async () => {
    mkdirSync(path.join(app, ".adaptv/android"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/android/variables.gradle"),
      "targetSdkVersion = 34\n",
    )
    expect((await runDoctor({ quiet: true })).stdout).toBe("")
    const { doc, stderr, exitCode } = await runDoctor({ json: true })
    expect(stderr).toBe("")
    expect(doc.notices).toHaveLength(1)
    expect(doc.notices[0]).toMatch(/^Android target SDK is 34 /)
    expect(doc.steps.some((s) => s.label === doc.notices[0])).toBe(false)
    expect(doc.ok).toBe(true)
    expect(exitCode).toBeUndefined()
  })

  it("reads the target SDK from variables.gradle, never from app/build.gradle", async () => {
    mkdirSync(path.join(app, ".adaptv/android/app"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/android/app/build.gradle"),
      "targetSdkVersion = 34\n",
    )
    const { lines } = await runDoctor()
    expect(row(lines, "no issues found")).toBe("  ✓ no issues found")
  })

  it("asks about the privacy manifest only when there is an iOS project", async () => {
    mkdirSync(path.join(app, ".adaptv/ios"), { recursive: true })
    expect(row((await runDoctor()).lines, "no issues found")).toBeDefined()

    mkdirSync(path.join(app, ".adaptv/ios/App/App"), { recursive: true })
    expect(checks((await runDoctor()).lines)).toEqual(
      await report({ hasPrivacyManifest: false }),
    )

    writeFileSync(
      path.join(app, ".adaptv/ios/App/App/PrivacyInfo.xcprivacy"),
      "",
    )
    expect(row((await runDoctor()).lines, "no issues found")).toBeDefined()
  })

  it("hands the rules the config adaptv generated, from the environment", async () => {
    mkdirSync(path.join(app, ".adaptv/ios/App/App"), { recursive: true })
    writeFileSync(
      path.join(app, ".adaptv/ios/App/App/Info.plist"),
      INFO_PLIST,
    )
    writeFileSync(
      path.join(app, ".adaptv/ios/App/App/PrivacyInfo.xcprivacy"),
      "",
    )
    vi.stubEnv(
      "ADAPTV_CAPACITOR_CONFIG",
      JSON.stringify({
        ios: { limitsNavigationsToAppBoundDomains: true },
      }),
    )
    const { lines } = await runDoctor()
    expect(row(lines, "no issues found")).toBe("  ✓ no issues found")
  })
})
