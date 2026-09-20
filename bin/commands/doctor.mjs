// `adaptv doctor` — the toolchain report. The first command to live in its own module:
// the entry (`bin/adaptv.mjs`) keeps dispatch and the helpers every command shares, and
// a command that shares nothing but the renderer has no reason to be in it. Its output
// is byte-for-byte what it was inside the entry; only the file moved.
import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import process from "node:process"
import { loadIconSet } from "../lib/icons.mjs"
import { describeOwnInstall } from "../lib/install-report.mjs"
import { loadConfig } from "../lib/load-config.mjs"
import { ADAPTV_ROOT, loadAdaptvModule } from "../lib/load-ts.mjs"
import { ADAPTV_DIR, capCmd, iosEnv, nativeDir } from "../lib/native.mjs"
import { locatePackage, ownNativeModules } from "../lib/own-modules.mjs"
import {
  detail,
  check as drawRow,
  header,
  log,
  record,
  recordError,
  section,
  spacer,
} from "../lib/render.mjs"

/**
 * The labels of every row that failed the run: a required row that came back red, and every
 * error the project checks raised. Per process, like the renderer's journal it mirrors.
 *
 * A red row used to be on the page and in `steps` while the run exited 0 with `ok: true`,
 * because only `fail()` marks a run failed and doctor draws its rows with `check()`. A
 * script asking "can this machine build my app?" got yes from a report that said no, against
 * R46 (a failing run's document carries `ok:false` and a structured `error`) and B22's
 * "fail loudly" on the WKAppBoundDomains trap. `fail()` itself is not the way through: it
 * prints its own `✖`, and the row already printed one (R2).
 */
const failed = []

/** `check()`, remembering a red required row. An optional row's absence is fine by definition. */
function check(ok, label, note = "", { optional = false } = {}) {
  drawRow(ok, label, note, { optional })
  if (!ok && !optional) failed.push(label)
}

/** Run a tool for its version. Answers, rather than printing, so a caller that reports on
 * several tools as ONE row can still ask about each of them. */
function toolVersion(argv) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" })
  return {
    found: r.status === 0,
    version:
      r.status === 0
        ? (r.stdout || r.stderr || "").trim().split("\n")[0]
        : null,
  }
}

function checkTool(label, argv, { optional = false } = {}) {
  const { found, version } = toolVersion(argv)
  check(found, label, version ?? "", { optional })
  return found
}

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p)) ?? null
}

function readIf(p) {
  return existsSync(p) ? readFileSync(p, "utf8") : undefined
}

/**
 * adaptv's own install, as ONE row (R71).
 *
 * The native command adaptv drives and the native modules it ships are adaptv's
 * dependencies, resolved from the framework's package root and never added to the
 * consumer's app, so this verifies adaptv's install and not the app's `package.json`. It
 * used to verify exactly the same thing and print it as twelve rows naming the engine
 * twelve times, under a heading that said they were adaptv's; the dev has one action for
 * any of it. `--verbose` keeps the names, which is where they are worth something.
 *
 * WHICH modules is not written down here. It was — eleven names in an array — and adaptv had
 * grown to fifteen without it, so four of them, the OTA plugin included, could have been
 * missing under a green row. `bin/lib/own-modules.mjs` reads adaptv's own `package.json` and
 * asks the framework's own `carriesNativeCode` which of those reach the binary.
 */
async function checkOwnInstall(appRoot) {
  const { cmd, pre } = capCmd(appRoot)
  const cli = toolVersion([cmd, ...pre, "--version"])
  const { carriesNativeCode } = await loadAdaptvModule(
    "native/installed-plugins.ts",
  )
  const { modules, missing } = ownNativeModules({
    dependencies: Object.keys(
      JSON.parse(
        readFileSync(path.join(ADAPTV_ROOT, "package.json"), "utf8"),
      ).dependencies ?? {},
    ),
    locate: (name) => locatePackage(name, ADAPTV_ROOT),
    isNative: carriesNativeCode,
  })
  const report = describeOwnInstall({
    modules,
    missing,
    runnable: cli.found,
    version: cli.version,
    verbose: process.env.ADAPTV_VERBOSE === "1",
  })
  check(report.ok, report.label, report.note)
  for (const line of [...report.notices, ...report.detail])
    detail(line, { failure: !report.ok })
}

/** Project-level checks (the silent failures), from src/native/doctor.ts. */
async function runProjectChecks(appRoot) {
  section("Project checks")
  const { runDoctor, formatDiagnostics } =
    await loadAdaptvModule("native/doctor.ts")
  const ios = nativeDir(appRoot, "ios")
  const android = nativeDir(appRoot, "android")
  //only an answer when there IS an iOS project: `undefined` keeps the rule quiet, and a
  //web-only app has no manifest to be missing. Same guard the stamper uses.
  const hasPrivacyManifest = existsSync(path.join(ios, "App"))
    ? existsSync(path.join(ios, "App/App/PrivacyInfo.xcprivacy"))
    : undefined
  const diagnostics = runDoctor({
    iosInfoPlist: readIf(path.join(ios, "App/App/Info.plist")),
    capacitorConfig: process.env.ADAPTV_CAPACITOR_CONFIG ?? undefined,
    //`variables.gradle`, not `app/build.gradle`: the numbers live in the first, the second
    //only references them, and the check was dead for as long as it read the reference
    androidVariablesGradle: readIf(path.join(android, "variables.gradle")),
    hasPrivacyManifest,
  })
  if (diagnostics.length === 0) {
    check(true, "no issues found")
  } else {
    //One diagnostic at a time, so an error's lines are marked a failure and survive
    //'--quiet' while a warning's stay narration. The page is the same text the whole list
    //formats to: the blank line between two findings belongs to the one below it.
    diagnostics.forEach((d, i) => {
      const failure = d.severity === "error"
      if (i > 0) detail("", { failure })
      for (const l of formatDiagnostics([d]).split("\n"))
        detail(l, { failure })
    })
  }
  //The page draws these as dim lines, so `check()` never saw them and `--json` had none of
  //them. Each lands where its glyph already says it belongs: an error (`✖`) is a failed
  //step and fails the run, a warning (`!`) is a notice (R5) and does not.
  for (const d of diagnostics) {
    if (d.severity === "error") {
      record("steps", { label: d.title, ok: false, optional: false })
      failed.push(d.title)
    } else record("notices", d.title)
  }
}

export async function doctor(appRoot) {
  //the SAME banner every other command prints — `doctor` had its own
  header("doctor")
  log.info("toolchain for building native iOS / Android from this app")

  section("Core")
  checkTool("node", ["node", "--version"])
  await checkOwnInstall(appRoot)

  section("Android")
  const aEnv = { ...process.env }
  const androidHome =
    aEnv.ANDROID_HOME ??
    aEnv.ANDROID_SDK_ROOT ??
    path.join(homedir(), "Library/Android/sdk")
  check(existsSync(androidHome), "Android SDK", androidHome)
  const jbr = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  const jdk = firstExisting([
    aEnv.JAVA_HOME && path.join(aEnv.JAVA_HOME, "bin/java"),
    path.join(jbr, "bin/java"),
  ])
  check(
    !!jdk,
    "JDK",
    jdk
      ? path.dirname(path.dirname(jdk))
      : "install Android Studio or set JAVA_HOME",
  )
  checkTool(
    "adb",
    [path.join(androidHome, "platform-tools/adb"), "version"],
    {
      optional: true,
    },
  )

  section("iOS (macOS only)")
  checkTool("xcodebuild", ["xcodebuild", "-version"], { optional: true })
  const ie = iosEnv()
  checkTool("cocoapods (pod)", ["pod", "--version"], { optional: true }) ||
    checkTool(
      "cocoapods (pod, resolved)",
      ["bash", "-lc", `PATH="${ie.PATH}" pod --version`],
      { optional: true },
    )

  section("Project")
  check(
    existsSync(nativeDir(appRoot, "android")),
    `${ADAPTV_DIR}/android project`,
    "",
    { optional: true },
  )
  check(
    existsSync(nativeDir(appRoot, "ios")),
    `${ADAPTV_DIR}/ios project`,
    "",
    { optional: true },
  )
  //Best-effort config read: `doctor` reports on the toolchain and must still be useful when
  //the app's config is the thing that's broken, so a failed load just falls back to an empty
  //config (and therefore the default icon dir) rather than taking the report down with it.
  let iconConfig = {}
  try {
    iconConfig = await loadConfig(appRoot)
  } catch {}
  const set = await loadIconSet(appRoot, iconConfig)
  check(
    set.source === "app",
    //An app that named no directory has no path to show, so the row names the KEY it is
    //reporting on instead. Interpolating `dirRel` regardless printed a bare " (icon source)".
    set.configured
      ? `${set.dirRel} (icon source)`
      : "'icons' (icon source)",
    set.source === "app"
      ? `${set.icons.length} icons`
      : "adaptv's default mark",
    { optional: true },
  )
  await runProjectChecks(appRoot)
  //no "doctor complete" footer: every row above already reported itself (R18).
  spacer()
  //The report went on past every red row, because a dev runs doctor to see ALL of what is
  //wrong. Only now does the run fail, and it adds nothing to the page: each failure already
  //has its `✖`. The labels are the rows' own text, already on the page: adaptv's literals
  //and the framework's diagnostic titles, which bin/lib/opacity.test.mjs scans for engine
  //names. Nothing from a tool reaches them, so there is nothing here to filter.
  if (failed.length > 0) {
    recordError({
      kind: "check-failed",
      labels: failed,
      message: `${failed.length} ${failed.length === 1 ? "check" : "checks"} failed: ${failed.join(", ")}`,
    })
    process.exitCode = 1
  }
}
