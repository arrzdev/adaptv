#!/usr/bin/env node
// The adaptv CLI — owns the whole native (Capacitor) lifecycle so a consumer never
// touches Capacitor, the toolchain env, or the asset generator by hand.
//
// The command surface — every command, every flag, every description — is `bin/lib/cli-spec.mjs`.
// `adaptv --help` renders it and `bin/lib/cli-parse.mjs` parses from it; nothing here restates
// it. This comment used to carry its own copy and had already drifted away from the code below
// it: it described four commands and omitted `gen icons` entirely, along with all seven of its
// flags. A test in `cli-parse.test.mjs` now fails the build if a flag reappears here.
//
// Native projects live inside the hidden, git-ignored `.adaptv/` dir (relocated from the
// app root). The CLI resolves ANDROID_HOME / JAVA_HOME / pod / LANG itself and invokes
// `cap` through adaptv's own shim, so it works from a bare shell. Launcher icons are
// rendered in-process from the app's icon set (bin/lib/icons.mjs) — no asset generator
// for the consumer to install.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import process from "node:process"
import { doctor } from "./commands/doctor.mjs"
import { measureArtwork } from "./lib/artwork.mjs"
import {
  buildIdEnv,
  builtOutDir,
  bundleStale,
} from "./lib/build-stamp.mjs"
import { renderFault, renderHelp, renderVersion } from "./lib/cli-help.mjs"
import { CliFault, parse } from "./lib/cli-parse.mjs"
import { startDevServer, warmDevServer } from "./lib/dev-server.mjs"
import { listTargets, resolveTarget } from "./lib/devices.mjs"
import { exec } from "./lib/exec.mjs"
import { explainFailure } from "./lib/explain.mjs"
import {
  appConfigFingerprint,
  cliSourceFingerprint,
  fingerprint,
  nativeFingerprint,
} from "./lib/fingerprint.mjs"
import {
  effectiveBackground,
  existingIcons,
  generateIcons,
  sourceError,
  sourceWarnings,
} from "./lib/icon-gen.mjs"
import { artTarget, SAFE_ZONE } from "./lib/icon-geometry.mjs"
import { writeIconPreview } from "./lib/icon-preview.mjs"
import { parseTuning } from "./lib/icon-tuning.mjs"
import { clearIconCaches, parseHex } from "./lib/icons.mjs"
import {
  androidReverse,
  healDevAtsLeftover,
  patchIosAts,
  patchIosLocalNetwork,
  patchServerUrl,
} from "./lib/live-reload.mjs"
import { loadConfig } from "./lib/load-config.mjs"
import { ADAPTV_ROOT, loadAdaptvModule } from "./lib/load-ts.mjs"
import {
  acquireDevLock,
  assertNoActiveDevLock,
  releaseDevLock,
  updateDevLock,
} from "./lib/lock.mjs"
import {
  ADAPTV_DIR,
  BUILDS_DIR,
  buildWeb,
  CAP_WEB_DIR,
  capAddIfMissing,
  capRun,
  capSync,
  ensureDeviceWindow,
  generateAssets,
  isAppInstalled,
  isAppRunning,
  isPhysicalTarget,
  lanIp,
  launchInstalledApp,
  localBin,
  nativeDir,
  patchNativeIdentity,
  platformEnv,
  relaunchAndroidApp,
  resolveIconPlan,
} from "./lib/native.mjs"
import { configIsStale } from "./lib/native-state.mjs"
import { installOfflinePage } from "./lib/offline-page.mjs"
import { namesPlumbing } from "./lib/opacity.mjs"
import { inspect as inspectApp } from "./lib/preflight.mjs"
import {
  addresses,
  c,
  confirm,
  detail,
  emitJson,
  fail,
  flushNotices,
  footer,
  header,
  liveWatcher,
  log,
  onKeys,
  rawOut,
  record,
  recordError,
  rewindLines,
  runLanes,
  runLine,
  section,
  setOutputMode,
  since,
  spacer,
  verbatim,
  wasReported,
} from "./lib/render.mjs"
import { readBuildState, writeBuildState } from "./lib/state.mjs"
import { errorTail, portInUse } from "./lib/tool-log.mjs"

/** @typedef {import("./lib/exec.mjs").CliError} CliError */

const CWD = process.cwd()

/**
 * What every command does before it does anything: read the config, check what adaptv can
 * check without doing work, and say it — under the banner, above the first step (R33).
 *
 * Returns the loaded config, so no command pays for a second esbuild bundle of it.
 *
 * The ordering is the whole point. A launcher-icon `!` is about source art the run does not
 * touch, so printing it between the web bundle and the device lanes told the dev, halfway
 * through a build, something that was true before it started; and a config value adaptv
 * cannot use must stop the command, not survive into a native build that fails on it minutes
 * later. Anything that can only be known by doing the work (a compile error, a device that
 * won't boot) still belongs to the step that finds it.
 *
 * `optional` is the web-only commands: `dev web` / `preview web` run an app that has no
 * adaptv.config.ts at all, so a missing one is not an error there — but a config that IS
 * there is still checked before the server comes up, because the same values reach the
 * manifest and the shell.
 *
 * `icons: false` skips the `!` half. `icons` passes it because a notice about the icon set
 * is stale the moment that command finishes — replacing the set is its whole job. A mid-run
 * `b` passes it because those notices were already printed above the run and are about source
 * art, not about whether this rebuild can happen; reprinting them on every `b` would be R18.
 *
 * `beforeExit` runs after the errors are printed and before the process goes — it is how a
 * live `dev` session unwinds (dev server, adb reverse, the iOS ATS exception, the lock)
 * instead of being killed where it stands. There is exactly ONE answer to "is this config
 * usable", and it is the same at startup and at minute forty: print every problem and stop.
 * A session whose config no longer parses is serving something that does not match the file
 * on disk, which is a worse place to be than back at the shell.
 * @param {string} appRoot
 * @param {string[]} platforms
 * @param {{ optional?: boolean, icons?: boolean, beforeExit?: () => void }} [opts]
 */
async function preflight(
  appRoot,
  platforms,
  { optional = false, icons = true, beforeExit } = {},
) {
  // Unwind BEFORE printing, not after. A live `dev` session's watch row redraws every 80ms,
  // so an error written while it is still animating is overwritten before it can be read —
  // and `beforeExit` (teardown) stops that row first. At startup there is nothing to unwind
  // and this is simply absent.
  const stop = (messages) => {
    beforeExit?.()
    //Under `--json` the caller never gets to `emitJson`, because this exits. Record the
    //failure and emit here, so a script sees a document that says what went wrong rather
    //than an empty stdout and a non-zero code.
    for (const m of messages) recordError({ kind: "config", message: m })
    //Every one of them, not just the first: they are all already known, and fixing a config
    //one line per run is a worse experience than reading the list. Each names its key in
    //single quotes and stays on one row (R10, R43) — the file is not repeated per line because every
    //key here is one the dev wrote in adaptv.config.ts.
    for (const m of messages) log.error(m)
    spacer()
    emitJson({ command: "preflight", version: pkgVersion() })
    process.exit(1)
  }
  if (optional && !existsSync(path.join(appRoot, "adaptv.config.ts")))
    return null
  let config
  try {
    config = await loadConfig(appRoot)
  } catch (err) {
    // A config problem is a plain user error — clean one-liner, not a "run failed" report (R7).
    stop([err.message])
  }
  const { errors, warnings } = await inspectApp(appRoot, config, platforms)
  if (errors.length > 0) stop(errors)
  if (icons) flushNotices(warnings)
  return config
}

/**
 * Publish the Capacitor config to the `ADAPTV_CAPACITOR_CONFIG` env var, generated fresh
 * from `adaptv.config.ts`, before any native command runs. adaptv's patched `@capacitor/cli`
 * reads config from this env (not a file), so there is NO `capacitor.config.json` anywhere in
 * the consumer's project — cap bakes the only copy into the native project itself.
 *
 * Being in the env (not a file) also makes stale dev state impossible for free: `dev` layers
 * the `server`/identity overrides onto this same env (`updateCapacitorEnv`), and it all dies
 * with the process — a SIGKILL'd run can't leave a config pointing at a dead dev server.
 */
async function setCapacitorConfigEnv(config) {
  const { capacitorConfigJson } = await loadAdaptvModule(
    "vite/capacitor-config.ts",
  )
  const json = capacitorConfigJson(config)
  if (json) process.env.ADAPTV_CAPACITOR_CONFIG = json
  else delete process.env.ADAPTV_CAPACITOR_CONFIG
}

/**
 * Refuse a native build whose update core is missing adaptv's edits.
 *
 * 🔴 The absence is silent by construction: the build succeeds, the app runs, and
 * updates install. Only the recovery paths change, and only on a device that has
 * already hit trouble. So the check has to be here, ahead of the compile.
 *
 * The message is written out with `log.error` rather than raised as a failure,
 * because it ends in a block the dev copies verbatim into their workspace file —
 * and the failure renderer drops any detail line naming the packages that block
 * has to name (R8, `lib/opacity.mjs`). A stripped fix is worse than a plain one.
 *
 * Returns `false` when it printed, so the caller can stop.
 */
async function assertUpdateCorePatched() {
  const { missingNativePatchMessage } = await loadAdaptvModule(
    "vite/verify-patches.ts",
  )
  //ADAPTV_ROOT, passed rather than inferred: this module reaches the CLI as a
  //transpiled `data:` URL, so it cannot locate itself, and the update core is
  //resolvable only from adaptv's own directory.
  const message = missingNativePatchMessage(ADAPTV_ROOT)
  if (!message) return true
  for (const line of message.split("\n")) log.error(line)
  spacer()
  process.exitCode = 1
  return false
}

/** The native fingerprint of each ready platform, keyed by platform. */
function snapshotNativeFp(appRoot, platforms) {
  return Object.fromEntries(
    platforms.map((p) => [p, nativeFingerprint(appRoot, p)]),
  )
}

/**
 * The dev server came up, and then never served the app. THREE different faults land here and
 * they want three different sentences — the one that used to cover all of them ("Another
 * process is likely using that port") was flatly wrong for the common case, where the port is
 * ours and the app itself is throwing, and it sent the dev hunting a collision that never
 * happened. It was also one 150-column sentence with no `detail`, so `runLine` clipped it to
 * `dev server at http://localhost:41730 is…` and the fix it named never reached the screen.
 *
 * So: a SHORT reason, and the rest as `fix` lines the renderer prints dim underneath (R13/R15).
 * @param {{ ok: boolean, why?: string, status?: number }} verdict
 * @param {string} url
 * @param {string[]} log
 */
function devServerUnhealthy({ why, status }, url, log) {
  if (why !== "error") {
    /** @type {CliError} */
    const err = new Error(
      why === "thin"
        ? `${url} is answering, but not with this app`
        : `dev server at ${url} never answered`,
    )
    err.fix = [
      "Another process is likely using that port. Stop it, or run on a free port:",
      "'adaptv dev … -- --port <n>'.",
    ]
    return err
  }

  // The server answered, and answered badly, and has already written why to its own stderr.
  // Only the lines that say so — `explainFailure` falls back to the first line of a tail it
  // can't narrow, which for a dev server's raw stream is `VITE v8.0.11  ready in 2490 ms`.
  const said = log.filter((l) => /\berror\s*:/i.test(l))

  // WHOSE fault is it? The answer decides what may be printed at all, not just the wording.
  //
  // A consumer's own source never mentions the engines (that is what the barrels are for), so
  // an error that names them is a fault in adaptv's own graph — and adaptv owns its plumbing
  // out loud but never by name (R8, R7b's `could not brand the launcher icon on this
  // platform`). The dev gets the fact and the action; the package stays invisible, and
  // `explainFailure` will fall back to the message below rather than lift that line onto the ✖.
  const ours = said.some(namesPlumbing)
  const unresolved = said.some((l) =>
    /Cannot find (module|package)|Failed to resolve/i.test(l),
  )
  /** @type {CliError} */
  const err = new Error("the app did not render")
  err.fix = [
    `every request to ${url} answered ${status} for 30s.`,
    ...(ours
      ? unresolved
        ? [
            //The observed cause, every time: a lockfile moved and an install did not, leaving
            //two halves of the toolchain that no longer agree. Naming the action is the whole
            //value of the line — the dev cannot act on anything else here, by design.
            "a module adaptv needs could not be resolved. Reinstall dependencies, then run again.",
          ]
        : ["this is a fault inside adaptv, not in your app."]
      : []),
  ]
  if (said.length) err.tail = said.join("\n")
  return err
}

/**
 * Everything that must be true of a platform's native project before anything syncs, builds
 * or installs it: the project exists, it carries the right install identity, its generated
 * assets match the config, and its plist has no dev leftovers in it.
 *
 * There is one of these because there used to be two, and they had already drifted. `dev`
 * kept a copy that patched the install identity in a SEPARATE loop after the device picker
 * and never healed a leftover ATS exception; `preview`/`build` kept another that did both
 * here. Neither difference was ever decided by anyone — and a step that lives in one half of
 * a duplicated flow is exactly how `b` came to reinstall the launcher icons of the run it
 * started in: it calls the launch half, and the assets were written by the other one.
 *
 * `dev: true` is the `.dev` install identity, shared by `dev` and `preview` so both coexist
 * with a release build in their own icon + storage sandbox. `build` uses the release id.
 *
 * `healAts: false` is for a rebuild INSIDE a live `dev` session, and only for that. The heal
 * strips a dev ATS exception a previous run left behind — but mid-session that exception is
 * this run's own, still in force, with its revert already registered on teardown. Healing it
 * there would cut the running app off from the cleartext dev server it is loading from.
 */
async function preparePlatform(
  appRoot,
  config,
  platform,
  env,
  { dev, healAts = true, force = false, report, warnings },
) {
  //Nothing scaffolding finds travels to the notice channel: a configured plugin that
  //isn't installed used to, and no longer does — that one needs no native project to
  //know, so `preflight` refuses over it before this runs at all.
  await capAddIfMissing(appRoot, platform, env, {
    report,
    plugins: config?.plugins,
    privacy: config?.privacy,
  })
  // Before the assets, and before `dev` patches its ATS exception in: the identity rewrites
  // Info.plist, and `patchIosAts` snapshots that file to restore on teardown. Patching the
  // identity afterwards — as `dev` used to — meant teardown wrote back a plist from before
  // the `(dev)` display name existed, so every session ended by reverting its own rename.
  patchNativeIdentity(appRoot, config, platform, { dev })
  //Silent about the icon set: `preflight` already read the same art and said whatever there
  //was to say, above the run (R33). Repeating it here would be the same fact twice (R18),
  //the second time under a step that only wrote files from it.
  //`force` reaches here so `--force` re-derives the assets, not just the binary.
  await generateAssets(appRoot, config, [platform], { report, force })
  // The iOS Info.plist is patched in place by `dev` and never regenerated, so a run killed
  // without teardown strands an ATS exception in it. `dev` heals it too, and MUST: its own
  // `patchIosAts` no-ops when ATS is already declared, so it adopted the leftover, registered
  // no revert, and the exception outlived the session — silently, because a stale
  // `NSAllowsArbitraryLoads` happens to be exactly what live-reload wanted anyway. Shipping
  // one is a real hole and something App Review asks about.
  if (platform === "ios" && healAts) {
    const ats = healDevAtsLeftover(appRoot)
    if (ats.healed) {
      // SILENT (R4/R8): adaptv added this exception, adaptv just removed it, and the plist is
      // back where it should be. There is nothing for the dev to know or do, so it is not
      // printed — the alternative was a glyphless line, and a notice with no `!` is not a
      // lower severity, it is a line that shouldn't have been printed.
    } else if (ats.warn) {
      warnings.push(
        "ios: Info.plist declares NSAppTransportSecurity and adaptv did not add it, so it is left alone. If that's an NSAllowsArbitraryLoads left over from an older dev run, remove it before submitting to App Review.",
      )
    }
  }
}

/**
 * Prepare every platform, in order, billing what each took to that platform's own line.
 *
 * Scaffolding is the first thing a platform does, NOT a step of its own — so on a first run
 * (`cap add` + CocoaPods is slow and worth watching) it renders on a TRANSIENT line under the
 * platform's OWN label, erased rather than settled, and the seconds it took are folded into
 * that platform's real line below (`prepareMs` → `offsetMs`). The dev sees one `ios` line that
 * begins at "preparing" and settles once. On later runs it's a sub-10ms no-op with no line at
 * all. Sequential on purpose: first-run prepares are rare, so it costs nothing, and it keeps
 * the warnings in order instead of interleaved under live lanes.
 *
 * Returns the platforms that made it, and what each one cost.
 */
async function preparePlatforms(
  appRoot,
  config,
  platforms,
  { dev, healAts = true, force = false, envFor, verbose, warnings },
) {
  const prepared = new Set()
  /** @type {Record<string, number>} */
  const prepareMs = {}
  for (const platform of platforms) {
    const fresh = !existsSync(nativeDir(appRoot, platform))
    const startedAt = Date.now()
    const one = (report) =>
      preparePlatform(appRoot, config, platform, envFor(platform), {
        dev,
        healAts,
        force,
        report,
        warnings,
      })
    try {
      if (fresh) {
        await runLine(platform, one, { verbose, transient: true })
      } else {
        await one(() => {})
      }
      prepared.add(platform)
    } catch (err) {
      // The transient line was erased and this platform never reaches the lanes below, so
      // its ONE line is printed here — same shape as a settled ✖.
      const { reason, detail } = explainFailure(platform)(err)
      fail(platform, `native project: ${reason}`, detail)
    }
    prepareMs[platform] = Date.now() - startedAt
  }
  return { ready: platforms.filter((p) => prepared.has(p)), prepareMs }
}

/**
 * Assemble the platform artifact (.apk / .ipa) and place it at `output` or `.adaptv/builds/`.
 * Returns the artifact path relative to the app root — that string becomes the step's
 * settled detail, and an absolute path there is just noise the renderer has to truncate.
 *
 * Both artifacts are UNSIGNED/debug on purpose: adaptv owns the whole native toolchain
 * and the consumer owns none of it (`docs/decisions/register.md` §2 L20 — they never name, install or script
 * Capacitor/Xcode), so packaging cannot be delegated to a script in their repo. A signing
 * identity is the one input adaptv cannot invent, so it stays theirs: Xcode ▸ Archive.
 */
async function packageArtifact(
  appRoot,
  config,
  platform,
  env,
  output,
  report,
) {
  const name = (config.appName ?? config.name ?? "app").replace(
    /[^\w.-]+/g,
    "-",
  )

  if (platform === "android") {
    const androidDir = nativeDir(appRoot, "android")
    report("packaging")
    await exec(path.join(androidDir, "gradlew"), ["assembleDebug"], {
      cwd: androidDir,
      env,
      onLine: (l) => report(l),
    })
    const built = path.join(
      androidDir,
      "app/build/outputs/apk/debug/app-debug.apk",
    )
    if (!existsSync(built))
      throw new Error("gradle produced no app-debug.apk")
    const dest = resolveOutput(appRoot, output, `${name}.apk`)
    copyFileSync(built, dest)
    return shortPath(appRoot, dest)
  }

  return await packageIpa(appRoot, name, env, output, report)
}

/**
 * Build the unsigned iOS `.ipa` — entirely inside adaptv, from the project it owns at
 * `.adaptv/ios`.
 *
 * There is no `xcodebuild` action that emits an unsigned .ipa: `-exportArchive` insists on
 * an export identity, which is exactly what we don't have. So do what the format actually
 * is — an .ipa is a zip whose only requirement is a top-level `Payload/<App>.app`. Build
 * the device slice with signing switched off, drop the product into `Payload/`, zip it.
 * The result installs on a simulator or via a re-signing pipeline (fastlane, `codesign`),
 * which is the point: a shippable artifact without adaptv ever touching the user's certs.
 *
 * DerivedData lives under `.adaptv/ios/` so nothing leaks into the app root — and it's in
 * the native fingerprint's skip list, so a build never invalidates its own cache.
 */
async function packageIpa(appRoot, name, env, output, report) {
  const iosDir = nativeDir(appRoot, "ios")
  const workspace = path.join(iosDir, "App/App.xcworkspace")
  if (!existsSync(workspace))
    throw new Error(
      "no .adaptv/ios/App/App.xcworkspace, so the iOS project isn't prepared.",
    )
  const derived = path.join(iosDir, "DerivedData/build")

  report("building app")
  await exec(
    "xcodebuild",
    [
      "-workspace",
      workspace,
      "-scheme",
      "App",
      "-configuration",
      "Release",
      "-sdk",
      "iphoneos",
      "-derivedDataPath",
      derived,
      "build",
      // All four: `CODE_SIGNING_ALLOWED=NO` alone still lets targets that pin an identity
      // (Pods, and any plugin with an entitlements file) fail the build.
      "CODE_SIGNING_ALLOWED=NO",
      "CODE_SIGNING_REQUIRED=NO",
      "CODE_SIGN_IDENTITY=",
      "CODE_SIGN_ENTITLEMENTS=",
    ],
    { cwd: iosDir, env, onLine: (l) => report(l) },
  )

  const app = path.join(derived, "Build/Products/Release-iphoneos/App.app")
  if (!existsSync(app))
    throw new Error(
      "xcodebuild produced no Release-iphoneos/App.app to package.",
    )

  //`packaging`, not `packaging .ipa`: a phase says what is happening, never what it is
  //happening TO (R22), and the android branch above says the same word for the same work.
  report("packaging")
  // Stage fresh every time: a leftover Payload from an earlier build would be zipped in
  // alongside the new one (zip merges into an existing archive rather than replacing it).
  const stage = path.join(iosDir, "DerivedData/payload")
  rmSync(stage, { recursive: true, force: true })
  mkdirSync(path.join(stage, "Payload"), { recursive: true })
  // Symlinks verbatim + modes preserved: an .app's embedded frameworks are symlinked, and
  // a dereferenced or chmod-ed copy is not a loadable bundle.
  cpSync(app, path.join(stage, "Payload/App.app"), {
    recursive: true,
    verbatimSymlinks: true,
  })
  const dest = resolveOutput(appRoot, output, `${name}.ipa`)
  rmSync(dest, { force: true })
  // `-y` stores symlinks as symlinks (see above); `-q` because zip's per-file chatter says
  // nothing the "packaging .ipa" phase doesn't already.
  await exec("zip", ["-qry", dest, "Payload"], {
    cwd: stage,
    env,
    onLine: (l) => report(l),
  })
  return shortPath(appRoot, dest)
}

/** A path as the user would type it: relative to the app root when it's inside it. */
function shortPath(appRoot, target) {
  const rel = path.relative(appRoot, target)
  return rel && !rel.startsWith("..") ? rel : target
}

/**
 * Resolve where an artifact should land: a `--output` path/dir, or `.adaptv/builds/<default>`.
 *
 * Artifacts get their OWN directory rather than sitting next to `ios/`, `android/` and the
 * cache files at the top of `.adaptv/`: those are adaptv's working state, an `.ipa`/`.apk` is
 * the thing the dev came for. One place to look, one place to delete.
 */
function resolveOutput(appRoot, output, defaultName) {
  const base = path.join(appRoot, ADAPTV_DIR, BUILDS_DIR)
  if (!output) {
    mkdirSync(base, { recursive: true })
    return path.join(base, defaultName)
  }
  const abs = path.resolve(appRoot, output)
  // a directory (existing dir, or a trailing slash) → keep the default filename
  const isDir =
    output.endsWith("/") ||
    (existsSync(abs) && statSync(abs).isDirectory())
  const dest = isDir ? path.join(abs, defaultName) : abs
  mkdirSync(path.dirname(dest), { recursive: true })
  return dest
}

/**
 * `dev` — the live-reload command. Starts ONE Vite dev server and points the web
 * + native WebViews at it, so an edit hot-reloads every surface. `platforms` is empty
 * for `dev web` (dev server only). Runs until Ctrl-C, then reverts every change
 * (capacitor.config server block, the iOS ATS exception, the adb reverse) and stops
 * Vite. Static installs stay on `adaptv preview`; artifacts on `adaptv build`.
 */
async function runLive(appRoot, platforms, opts) {
  const webOnly = platforms.length === 0
  const single = platforms.length === 1
  header(`dev ${webOnly ? "web" : single ? platforms[0] : "all"}`)

  const verbose = opts.verbose
  const cleanups = [] // revert fns, unwound LIFO on exit
  /** @type {Awaited<ReturnType<typeof startDevServer>> | null} */
  let devServer = null
  let onDevLine = null // set once we're watching; parses HMR events
  // Everything the dev server has said, kept from the moment it starts. `onDevLine` is not
  // assigned until the watch phase, ~500 lines down, and until then every line Vite writes
  // went NOWHERE — which is exactly the window in which a broken app announces itself: Vite
  // resolves `Local:` as soon as it is listening, then prints the SSR stack for the very
  // first request the warm makes. That is how a 500-ing app produced one clipped line —
  // `✖ web  dev server at http://localhost:41730 is…` — and not a word of the
  // `Cannot find module …` Vite had already written to its own stderr (R15).
  const devLog = []
  const recordDevLine = (l) => {
    devLog.push(l)
    if (devLog.length > 200) devLog.shift()
    onDevLine?.(l)
  }
  let watcher = null // the live "watching / hot-reload" status line
  let launchAll = null // replays the launch lines (used by the `r` key)
  let nativeFp = null // last-known native fingerprint per platform
  let configFp = null // last-known adaptv.config.ts + icon-art fingerprint
  // adaptv's OWN bin/ source, captured NOW — the modules this process loaded at startup. Unlike
  // config/native (which a rebuild re-applies), a change here needs a fresh process, so it is
  // never re-armed by `armStaleness`; only the poll re-arms it, to notice one edit once.
  let cliFp = cliSourceFingerprint()
  let tearing = false

  let tornDown = false
  const teardown = () => {
    if (tornDown) return // idempotent — called from SIGINT, the catch, AND the exit hook
    tornDown = true
    try {
      watcher?.stop()
    } catch {}
    while (cleanups.length) {
      try {
        cleanups.pop()()
      } catch {}
    }
    try {
      devServer?.stop()
    } catch {}
    // Release the single-instance lock last, once the port + adb mapping it names are
    // actually gone — so a queued second run never reclaims it before this one is clear.
    try {
      releaseDevLock(appRoot)
    } catch {}
  }
  const onSigint = () => {
    if (tearing) return
    tearing = true
    // Quiet teardown — no implementation chatter. It reverts the capacitor.config server
    // block, the iOS ATS/Local-Network exceptions, and the adb reverse, then exits.
    spacer()
    teardown()
    process.exit(0)
  }
  // Revert on ANY termination we can catch — not just Ctrl-C. A plain `kill` (SIGTERM)
  // or a closed terminal (SIGHUP) otherwise skips teardown and leaves the committed
  // capacitor.config pinned at the dev `server.url`. (SIGKILL can't be caught; the
  // next run self-heals by stripping a stale live-reload server block — patchServerUrl.)
  process.on("SIGINT", onSigint)
  process.on("SIGTERM", onSigint)
  process.on("SIGHUP", onSigint)
  // Safety net: whatever ends this process — Ctrl-C at the picker, a thrown error, a plain
  // exit — run the (idempotent, sync) teardown so the dev server, adb mapping, config
  // patches and lock never leak. onSigint/catch also call it; the guard makes that a no-op.
  process.on("exit", () => {
    try {
      teardown()
    } catch {}
  })

  const envs = {}
  const envFor = (p) => {
    if (!envs[p]) envs[p] = platformEnv(p)
    return envs[p]
  }

  // Refuse a second concurrent dev run BEFORE touching anything (ports, config, adb) — and
  // show it as a plain message, not a "run failed" stack. A stale lock auto-reclaims.
  try {
    acquireDevLock(appRoot)
  } catch (err) {
    log.error(err.message)
    process.exit(1)
  }

  // Config + assets, checked and reported before the dev server or any native project is
  // touched (R33). `dev web` runs without an adaptv.config.ts, so there it checks one only
  // if the app has one.
  //`let`, because the `b` key re-reads it — see `reloadConfig`. A dev editing
  //adaptv.config.ts mid-run and rebuilding must not get the config the run started with.
  let config = await preflight(appRoot, platforms, { optional: webOnly })

  try {
    // Prepare-time notices — the iOS ATS block adaptv did NOT add. `preflight` already
    // flushed everything the config could tell us; this is the half that can only be known
    // by opening the native project, and it still belongs above the run (R33).
    const warnings = []
    // The platforms whose native project is ready to sync, and what each cost to prepare —
    // billed to that platform's launch line further down (it runs before the line exists).
    // Declared out here because the launch phase lives in a separate `if (!webOnly)` block.
    let ready = []
    /** @type {Record<string, number>} */
    let prepareMs = {}
    // Re-arm BOTH staleness fingerprints together, always. They answer one question — does
    // what is installed still match what the dev wrote — so arming one without the other is
    // how a notice comes to either never fire or never clear.
    const armStaleness = () => {
      nativeFp = snapshotNativeFp(appRoot, ready)
      configFp = appConfigFingerprint(appRoot, config)
    }

    if (!webOnly) {
      // Fresh capacitor.config.json before anything reads or patches it, so a run
      // killed without teardown can never leave dev fields behind for the next command.
      await setCapacitorConfigEnv(config)
      // cap sync copies the web bundle into the native project even though the WebView
      // loads from the dev server, so one has to exist — and it has to be one THIS config
      // produced.
      //
      // This used to be a bare existence check, on the reasoning that the content is
      // irrelevant to a live-reload session. The content is irrelevant; the ARTIFACT is
      // not. `.adaptv/web` is what `cap sync` copies into `public/`, so a `dev` run was
      // the one path that could bake a shell from a config the dev had already replaced —
      // while `preparePlatforms`, three lines down, re-derived the iOS splash colourset
      // and Android's `colors.xml` from the NEW one. One app, two colours, and nothing on
      // screen to say so. Both halves now answer to `appConfigFingerprint`.
      //
      // Deliberately NOT the source fingerprint that `build`/`preview` also check: app
      // code is exactly what live reload owns, and rebuilding the bundle on every edit
      // would put a full vite build in front of a loop that exists to avoid one. What
      // `dev` must not do is ship a shell built from a config that no longer exists.
      //
      // The bundle is a SUB-ACTION of getting the app onto the device, not a step of its
      // own: it renders live under the SAME `web` label the dev server settles under, and
      // is erased rather than settled (R1 — one settled line per surface). It used to
      // settle as `✓ web bundle (first run)`, so a first `dev ios` printed two different
      // names for the one web surface.
      if (await bundleStale(appRoot, "capacitor", config)) {
        try {
          await runLine(
            "web",
            (r) => buildWeb(appRoot, { report: r, config }),
            {
              verbose,
              transient: true,
            },
          )
        } catch (err) {
          // A transient row is erased, so the caller owns the ✖ (and `fail` marks it
          // reported, keeping the outer catch from printing a second one).
          const { reason, detail } = explainFailure("web")(err)
          fail("web", reason, detail)
          throw err
        }
      }
    }

    /**
     * Whether the dev server has to be reachable over the LAN (bind `0.0.0.0`).
     *
     * ANY native run binds for the LAN, and that is the price of serving before the native
     * projects exist. It used to be decided by asking whether a physical device was in play —
     * `--host`, a physical `--target`, a cached physical (`--latest`), or a physical device
     * sitting in the picker's list — and every one of those answers comes from
     * `cap run <platform> --list`, which refuses until the project exists. So the question
     * could only be asked after scaffolding, which is what pinned the whole first-run
     * `cap add` + CocoaPods wait (minutes, on a lone `ios` row) IN FRONT of the dev server.
     *
     * Over-binding was always documented as harmless — a simulator reaches the app on
     * localhost either way — and it is what makes the order the dev actually wants possible:
     * Vite comes up first and proves the app compiles, and the native work happens after,
     * against a server already known to be good. What it costs is real and worth stating: a
     * simulator-only `dev` now listens on the LAN too, and the address block says so.
     */
    const forcedHost = opts.host // true | undefined — '--host' takes no value
    const externalPossible = !!forcedHost || !webOnly

    // Start the Vite dev server FIRST — an app/config problem shows up here, before any
    // native project is scaffolded and before the dev has to pick a device.
    await runLine(
      //`web` — the same name the platform lanes use, because that is what is being served.
      //The URL moves off this row into the address block below (R27), so the row no longer
      //grows with the port and both addresses get a label instead of only one.
      "web",
      async (report) => {
        devServer = await startDevServer(appRoot, {
          args: opts.viteArgs,
          // native WebViews need a client SPA with no service worker (a SW caches
          // the app inside the WebView and blocks hot reload). adaptv's plugin reads
          // this and forces render:spa + sw:false for the dev server. `dev web` (no
          // native surface) keeps the app's normal web config.
          env: webOnly ? {} : { ADAPTV_DEV_NATIVE: "1" },
          host: externalPossible,
          onLine: recordDevLine,
        })
        // Native only: stabilize the server (dep re-optimize + its full-reload) BEFORE
        // launching the WebViews. iOS WKWebView won't survive that reload if it attaches
        // mid-optimize — it drops the HMR socket for good. Web reconnects fine, so skip.
        if (!webOnly) {
          //The URL stays OFF the row (R27 — it has its own address block below), and the
          //phase is the participle alone. `starting server` is what `preview` calls the
          //same idea: from the dev's side the server is still coming up until this row
          //settles, and the dep re-optimize it is waiting on is adaptv's business, not
          //theirs (R8). It used to be `<url> · warming`, which `prettyLine` erased
          //outright — a `:` and a `/` are not a phase — so the row silently held
          //`preparing` through the whole settle.
          report("starting server")
          const stable = await warmDevServer(devServer.localUrl, {
            onLine: recordDevLine,
            //NOT passing `sawOptimize` — so the FULL settle is taken, every time, as before.
            //
            //The short-settle path is built, plumbed and unit-tested, and it is worth ~850ms
            //on every native `dev`. It is not enabled because its gate cannot currently be
            //run: the check is "do two consecutive HMR updates still land in the WKWebView",
            //and in this playground they do not land even with the original 1s settle. The
            //dev server serves the edited module (verified: curl returns the new source, root
            //is 200) but the WebView does not apply it. Whatever that is, it is not this
            //change — and until it is fixed there is no baseline to certify against.
            //
            //To enable, once HMR is fixed: sniff the dev-server lines for `SAW_OPTIMIZE`
            //(they must be sniffed in `startDevServer`'s own `onLine`, because `onDevLine` is
            //not assigned until the watch phase and the optimize signal arrives before that),
            //then pass `sawOptimize`. Do it only after watching an edit reach the simulator
            //twice, cold `.vite` and warm.
          })
          // Fail SAFE: the detected URL never served the app, so don't point the native
          // apps at it. WHY it didn't decides what to say — see `devServerUnhealthy`.
          if (!stable.ok)
            throw devServerUnhealthy(stable, devServer.localUrl, devLog)
        }
        //no detail: the addresses are rendered as their own aligned block under this row.
        return ""
      },
      // The dev server gets the same failure vocabulary as every other line: a taken port
      // reads as `port 41710 is already in use` with the fix underneath, instead of one
      // three-sentence message clipped to the terminal width (R15).
      { verbose, explain: explainFailure("web") },
    )
    addresses({
      local: devServer.localUrl,
      network: devServer.networkUrl,
    })

    // Prepare the native projects — the SAME call `preview`/`build` make, so `dev` can never
    // drift into its own idea of what a prepared platform is. It has to happen before the
    // device picker: the device list comes from `cap run <platform> --list`, which refuses
    // until the project exists. It happens AFTER the dev server because a first run scaffolds
    // for minutes (`cap add` + CocoaPods), and doing that first meant a `dev all` sat on a
    // lone `ios` row with nothing yet proved about the app itself.
    let deviceLists = {}
    if (!webOnly) {
      const prep = await preparePlatforms(appRoot, config, platforms, {
        dev: true,
        force: opts.force,
        envFor,
        verbose,
        warnings,
      })
      ready = prep.ready
      prepareMs = prep.prepareMs
      //R33 draws the line at what was already sitting in a file the dev wrote: preflight said
      //all of that under the banner. This is the other half — an ATS block in a plist that has
      //to EXIST first — and it belongs to the step that finds it, which is this one.
      flushNotices(warnings)

      if (ready.length === 0) {
        teardown()
        process.off("SIGINT", onSigint)
        process.off("SIGTERM", onSigint)
        process.off("SIGHUP", onSigint)
        footer(c.red("✖ could not prepare any platform"))
        process.exitCode = 1
        return
      }

      //Start listing devices NOW, unawaited: a listing costs 176-279ms per platform and the
      //picker is the next thing to want one. It used to overlap the dev server's ~1.9s warm,
      //which the reorder above spends before the projects exist. See the bounding rule in
      //`resolveTarget`: this may only ever be used to SUCCEED.
      deviceLists = Object.fromEntries(
        ready.map((p) => [p, listTargets(appRoot, p, envFor(p))]),
      )
    }

    // Now resolve the device — AFTER the server is confirmed up, so the picker never appears
    // for a run that was going to fail at the dev server anyway.
    const targets = {}
    for (const p of ready) {
      targets[p] = await resolveTarget(appRoot, p, envFor(p), {
        command: "dev",
        target: opts.target,
        latest: opts.latest,
        prefetch: deviceLists[p],
      })
    }

    // `capacitor.config`'s `server.url` is a single value shared by every attached platform,
    // so the mode is per-RUN: external (the machine's LAN IP) if the PICKED device is
    // physical or --host forced it, else localhost (sim shares loopback; emulator uses
    // `adb reverse`). Vite is already bound for the LAN if it was possible, so only the URL
    // is decided here.
    //Same trap as above: resolve first, then ask.
    const anyPhysical =
      !webOnly &&
      (
        await Promise.all(
          ready.map((p) => isPhysicalTarget(p, targets[p].id, envFor(p))),
        )
      ).some(Boolean)
    const external = !!forcedHost || anyPhysical
    // The Android emulator can't reach a LAN IP (its NAT can't route back to the host's own
    // LAN address), so it's fundamentally incompatible with external mode.
    if (
      external &&
      ready.includes("android") &&
      !(await isPhysicalTarget(
        "android",
        targets.android.id,
        envFor("android"),
      ))
    ) {
      throw new Error(
        "the Android emulator can't reach an external dev server (its NAT can't route to your LAN IP). " +
          "Use a physical Android device, or run android without '--host' (and not alongside a physical iOS device).",
      )
    }
    let lanHost = null
    if (external) {
      //Always detected. `--host` used to accept an ip to pin the interface, which asked the
      //dev to go and look up their own address for a machine adaptv is already running on.
      //There is no override to fall back to now, so a failure here has to say what to CHECK
      //rather than what to pass.
      lanHost = lanIp()
      if (!lanHost)
        throw new Error(
          "no LAN address on this machine, so a physical device has no route to the dev server. " +
            "Connect to Wi-Fi or Ethernet (a VPN tunnel alone is not enough), or run on a " +
            "simulator instead.",
        )
    }
    const port = devServer.port
    const url = external
      ? `http://${lanHost}:${port}`
      : `http://localhost:${port}`
    // The `addresses()` block under the web row already lists local + network; this says
    // WHICH of them the device will load, and only when that's the non-obvious one (external).
    if (external) log.info(`device loads from ${c.bold(url)}`)
    // Record the bound port + url in the lock, so a second `dev` (or a `preview`/`build`)
    // can name exactly what's holding the port in its refusal message.
    updateDevLock(appRoot, { port, url })

    if (!webOnly) {
      // point the native projects at the dev server, and remember how to undo it.
      cleanups.push(patchServerUrl(appRoot, url))
      // Generate the offline screen into the web dir BEFORE sync so `cap sync` copies it
      // into each platform's public/. Capacitor's `server.errorPath` (set above) loads
      // it locally when the dev server is unreachable, instead of a black WebView.
      cleanups.push(await installOfflinePage(appRoot, { url, config }))
      if (ready.includes("ios")) {
        const revert = patchIosAts(appRoot)
        if (revert) cleanups.push(revert)
        // External mode reaches the dev server over the LAN, which iOS 14+ gates behind a
        // Local Network permission — declare it so the OS prompts instead of silently
        // blocking. Reverted on teardown, like the ATS exception.
        if (external) {
          const revertLN = patchIosLocalNetwork(appRoot)
          if (revertLN) cleanups.push(revertLN)
        }
      }
      // sync (copies the patched config) + launch each platform against the server.
      //
      // …unless nothing NATIVE changed. In live-reload the installed app is only a shell
      // pointing at the dev server, so when the native inputs and the dev URL are
      // unchanged AND the device confirms it's still installed, there is nothing to
      // rebuild: launch it and let it reconnect. That turns a ~15s build+install into a
      // ~1s launch, and drops Android from two relaunches to one (no `cap run` to reset
      // `adb reverse`). Every uncertainty falls through to the full path.
      const runCache = readBuildState(appRoot)
      runCache.run ??= {}
      const cacheKey = (platform) =>
        `${platform}:${targets[platform]?.id ?? "default"}`
      // Platforms that actually got onto a device — so a run where every native launch
      // failed (e.g. iOS signing) exits instead of pretending to "watch" nothing.
      const launched = new Set()

      const launchOne = async (
        platform,
        report,
        { force = opts.force } = {},
      ) => {
        const target = targets[platform]
        const env = envFor(platform)
        const key = cacheKey(platform)
        const prev = runCache.run[key]
        const cached =
          !force &&
          prev?.url === url &&
          prev?.fp === nativeFingerprint(appRoot, platform) &&
          (await isAppInstalled(appRoot, platform, target.id, env))

        if (cached) {
          // Android emulator first needs the localhost route back to the host — no `cap
          // run` will set it. In external mode a physical device reaches the LAN IP
          // directly, so there's no `adb reverse` to (re-)assert.
          if (platform === "android" && !external) {
            report("linking server")
            cleanups.push(await androidReverse(port, env))
          }
          report("launching device")
          if (
            await launchInstalledApp(appRoot, platform, target.id, env)
          ) {
            await ensureDeviceWindow(platform, target.id, env)
            launched.add(platform)
            return `${target.name} · cached`
          }
          // couldn't launch it after all — fall through and rebuild.
        }

        // No `generateAssets` here: every path that reaches this function has just been
        // through `preparePlatforms`, which owns the assets. It briefly lived here too — the
        // patch for `b` reinstalling the launcher icons of the run it started in — and that
        // is precisely the seam this pipeline removes: assets written in two places is how
        // they came to be written in neither on the one path that mattered.
        report("syncing")
        await capSync(appRoot, platform, env, {
          report,
          plugins: config?.plugins,
          privacy: config?.privacy,
        })
        // Was the app already up? If so, it survives the build (capRun no longer kills it)
        // and only cap run's re-front touched it, so we relaunch the fresh install once.
        const wasRunning = await isAppRunning(
          appRoot,
          platform,
          target.id,
          env,
        )
        // `cap run` BUILDS, then installs, then launches — the build is all but one second
        // of it. Announcing `launching device` here said the last step first, so the row read
        // `launching device` through twenty seconds of compiling. A row narrates whatever it
        // is told (it has no fallback of its own any more), so announcing the right thing at
        // the right moment is entirely this function's job. Say what STARTS.
        report("building app")
        await capRun(appRoot, platform, target.id, env, { report })
        // The build is done; from here it really is the device's turn. Every branch below
        // installs, relaunches or fronts the app, so the phase covers all of them.
        report("launching device")
        if (platform === "android" && !external) {
          // `cap run` resets the emulator's `adb reverse` while installing/launching,
          // so the app it just launched has no route to the dev server (black WebView,
          // no JS to recover). Re-assert the reverse AFTER cap run, then relaunch the
          // app so its WebView loads with a working route. External mode reaches the LAN IP
          // directly (no reverse), so none of this applies.
          report("linking server")
          cleanups.push(await androidReverse(port, env))
          await relaunchAndroidApp(appRoot, env, target.id)
        } else if (platform === "ios" && wasRunning) {
          // The old process kept running through the build; load the fresh install now
          // (one relaunch, at the end — not a kill-then-wait-15s at the start).
          await launchInstalledApp(appRoot, platform, target.id, env, {
            restart: true,
          })
        }
        await ensureDeviceWindow(platform, target.id, env)
        // Record AFTER the build: `cap sync` rewrites files in the native project, so a
        // fingerprint taken before it would never match on the next run.
        runCache.run[key] = {
          url,
          fp: nativeFingerprint(appRoot, platform),
        }
        writeBuildState(appRoot, runCache)
        launched.add(platform)
        return `${target.name}`
      }
      // Hoisted so the `r` key can replay exactly the same launch lines mid-run. `offsets`
      // carries the scaffolding time each platform already spent above (the transient
      // "preparing" line), so the settled line reports the platform's WHOLE first-run cost.
      // A replay (`b`) passes none — it re-prepares inside the lane instead, and that time
      // is billed by the lane itself.
      //
      // `prepare` is the `b` rebuild: it re-runs the SAME preparation a fresh run does —
      // scaffold, install identity, generated assets — as the first phase of the platform's
      // own line. Doing it here rather than before the lanes is what keeps the terminal from
      // sitting blank for a second while sharp re-renders the launcher icons; doing it AT ALL
      // is what stops a rebuild from being a subset of a startup. `healAts: false` because the
      // ATS exception in the plist right now is this session's own and still in force.
      /** @param {{ force?: boolean, offsets?: Record<string, number>, prepare?: boolean }} opts */
      launchAll = async ({
        force,
        offsets = {},
        prepare = false,
      } = {}) => {
        // One lane per platform for ANY count — same as `build`/`preview`. Rendering one
        // platform through a different call than two is how the two shapes drift apart.
        // Each lane carries its own outcome (explain → the inline reason + hint), so a
        // failure needs nothing printed after the lanes settle.
        await runLanes(
          ready.map((p) => ({
            label: p,
            run: async (r) => {
              if (prepare)
                await preparePlatform(appRoot, config, p, envFor(p), {
                  dev: true,
                  healAts: false,
                  //`b` means "rebuild it properly" — re-derive the assets, don't consult
                  //the guard. A device in a state you don't trust is the whole reason for
                  //pressing it.
                  force: true,
                  report: r,
                  //Dropped, not flushed: these were printed above the run, and a row
                  //appearing here would also desync the rewind geometry the caller used.
                  warnings: [],
                })
              return launchOne(p, r, { force })
            },
            offsetMs: offsets[p] ?? 0,
            explain: explainFailure(p),
          })),
          { verbose },
        )
      }
      await launchAll({ force: opts.force, offsets: prepareMs })
      armStaleness()

      // Nothing made it onto a device? Then there's nothing to hot-reload — don't pretend
      // to "watch". The dev server did come up, but `dev <platform>` is about the device,
      // so surface the failure (e.g. iOS signing) and exit non-zero. Fix it and re-run.
      if (launched.size === 0) {
        teardown()
        process.off("SIGINT", onSigint)
        process.off("SIGTERM", onSigint)
        process.off("SIGHUP", onSigint)
        const what = `dev ${single ? platforms[0] : "all"}`
        footer(
          verbose
            ? c.red(`✖ ${what} failed`)
            : `${c.red(`✖ ${what} failed`)}${c.dim(" · run with --verbose for the full output")}`,
        )
        process.exitCode = 1
        return
      }
    }

    /**
     * The watch block. Ink renders it (`bin/ui/watch.mjs`), describing the block as layout
     * rather than growing and shrinking it with cursor arithmetic — the thing that once walked
     * it up the screen and erased the settled rows above it.
     *
     * `dev web` still takes the string version (`liveWatcher`) instead: it draws one row with
     * no keys, which is not worth 136-177ms of `ink` + `react` on a run that never touches a
     * device. Both return the same `{ hmr, notice, clearNotice, stop }`, so nothing below can
     * tell them apart.
     *
     * There is no longer an `ADAPTV_INK=0` env override. It defaulted the other way while the
     * port was unproven and was then "kept for one release" as an escape hatch, which is a
     * promise this repo cannot make: it is unreleased, and it carries no compatibility shims.
     * The port is proven — `build`, `dev`, the `b` rebuild and the `r` reload have all run
     * through it on a device — so the flag only bought a second, colder rendering path that
     * nothing exercised and every change to the block had to keep working.
     *
     * Ink also owns the keypresses when it is in play — see `if (!useInk)` below.
     */
    const useInk = !webOnly
    //Imported HERE, not at the top of the file. `ink` + `react` cost 136-177ms to load against
    //a 64ms bare-node floor, and a static import would charge that to `adaptv --help` and to
    //every invocation error — the paths where the <100ms responsiveness rule actually bites.
    //Only a run that puts a live block on screen pays for one.
    const openWatcher = async () => {
      if (!useInk) return liveWatcher({ keys: !webOnly })
      const { inkWatcher } = await import("./ui/watch.mjs")
      return inkWatcher({
        keys: !webOnly,
        onReload: () => void reload(),
        onRebuild: () => void rebuild(),
        onQuit: () => onSigint(),
      })
    }

    // watch: a single live line (✓ turns to a spinner on HMR), no raw vite logs.
    spacer()
    watcher = await openWatcher()

    // `b` reinstalls on demand — always, not only after a change is detected. A device
    // in a state you don't trust is reason enough, and having to kill the run to get a
    // clean install is exactly the friction this removes. `r` is the cheap sibling: it
    // just reloads the running app's JS (no reinstall).
    let rebuilding = false
    let reloading = false
    const rebuild = async () => {
      if (rebuilding || reloading || webOnly || !launchAll) return
      rebuilding = true
      // `b` is a FULL rebuild, and that has to include the CONFIG — it used to reuse the
      // object loaded before the run, so editing adaptv.config.ts and pressing `b` rebuilt
      // the app from the config the dev had already replaced.
      //
      // A config adaptv cannot use ENDS the session (R39). The old `b` kept the last good
      // config and refused the rebuild, which left a dev server and two attached devices
      // serving something that no longer matched the file on disk — two answers to "is this
      // config usable", one at startup and a softer one at minute forty. `beforeExit` is what
      // makes that affordable: the dev server, the adb reverse, the iOS ATS exception and the
      // lock all unwind first, so exiting here is as clean as ctrl-c.
      config = await preflight(appRoot, ready, {
        icons: false,
        beforeExit: () => {
          teardown()
          process.off("SIGINT", onSigint)
          process.off("SIGTERM", onSigint)
          process.off("SIGHUP", onSigint)
        },
      })
      // Re-stamp the env from the config just read. `setCapacitorConfigEnv` regenerates it
      // from adaptv.config.ts ALONE, so it carries no `server` block — re-stamping and
      // syncing straight afterwards installed an app with no dev-server URL at all, a
      // live-reload shell pointing nowhere and rendering the placeholder bundle. The install
      // identity is re-applied by the lane's own prepare below; the server block is re-applied
      // here, reusing the revert already registered at startup.
      await setCapacitorConfigEnv(config)
      patchServerUrl(appRoot, url)
      // …and the offline screen, which bakes the config's theme colours in. `b` exists to
      // re-read the config, so regenerating here is the same fix as re-stamping the env and
      // rebuilding the bundle: without it the sync below copies a screen painted in the
      // colour the dev has already replaced. No new cleanup — the one registered at startup
      // deletes this exact path.
      await installOfflinePage(appRoot, { url, config })
      watcher.stop() // clears the watch row; cursor stays on it
      // …and the BUNDLE, for the config just read. `b` after a `themeColor` edit is the
      // shortest path to the split-colour app there is: the lanes below re-derive the
      // native splash from the new config while `cap sync` copies a shell emitted from
      // the old one. Transient, under the same `web` label as the run's own bundle step,
      // and erased — so the rewind geometry two lines down is unchanged.
      if (await bundleStale(appRoot, "capacitor", config)) {
        try {
          await runLine(
            "web",
            (r) => buildWeb(appRoot, { report: r, config }),
            { verbose, transient: true },
          )
        } catch (err) {
          const { reason, detail } = explainFailure("web")(err)
          fail("web", reason, detail)
          rebuilding = false
          watcher = await openWatcher()
          return
        }
      }
      // Walk back over the blank separator + one row per platform so the SETTLED
      // platform lines animate again in place, rather than a second copy appearing
      // below them. Off a TTY there's no cursor to move, so just append.
      if (!rewindLines(1 + ready.length)) spacer()
      // `prepare: true` — the rebuild re-runs the SAME preparation a fresh run does, on each
      // platform's own line. That is the whole point of the pipeline: a rebuild cannot be a
      // subset of a startup, because both go through one definition of "ready to sync".
      await launchAll({ force: true, prepare: true })
      armStaleness()
      spacer()
      watcher = await openWatcher() // fresh block, which also clears any pending notice
      rebuilding = false
    }

    // `r` = reload: relaunch the installed app so its WebView reconnects to the dev
    // server. Instant next to a native rebuild (no sync/gradle/xcode), and the fix for a
    // wedged JS bundle — a fresh document from the dev server, no reinstall. Distinct from
    // `R`, which reinstalls the binary for a genuine native change.
    const reloadOne = async (platform, report) => {
      const target = targets[platform]
      report("reloading device")
      const ok = await launchInstalledApp(
        appRoot,
        platform,
        target.id,
        envFor(platform),
        { restart: true },
      )
      if (!ok)
        throw new Error(
          "couldn't relaunch the app. Is it still installed? press b to rebuild.",
        )
      await ensureDeviceWindow(platform, target.id, envFor(platform))
      return `${target.name} · reloaded`
    }
    const reload = async () => {
      if (reloading || rebuilding || webOnly || ready.length === 0) return
      reloading = true
      watcher.stop()
      if (!rewindLines(1 + ready.length)) spacer()
      if (single) {
        try {
          await runLine(ready[0], (r) => reloadOne(ready[0], r), {
            verbose,
            explain: explainFailure(ready[0]),
          })
        } catch {
          // the ✖ line already states why — see explainFailure.
        }
      } else {
        await runLanes(
          ready.map((p) => ({
            label: p,
            run: (r) => reloadOne(p, r),
            explain: explainFailure(p),
          })),
          { verbose },
        )
      }
      spacer()
      watcher = await openWatcher()
      reloading = false
    }
    //Ink owns stdin when it is rendering: `useInput` puts the terminal in raw mode itself, and
    //a second listener on the same stdin would take half the bytes.
    if (!useInk)
      cleanups.push(
        onKeys({ onReload: reload, onRebuild: rebuild, onQuit: onSigint }),
      )

    // Two kinds of edit can't hot-reload, and both leave the installed app quietly wrong.
    //
    // NATIVE ones — a new plugin, an edited Info.plist or AndroidManifest, hand-written
    // Swift/Kotlin — live in the BINARY, so the running app simply won't have them, and the
    // symptom is a bridge call that fails with no explanation.
    //
    // DECLARED ones — `adaptv.config.ts` and the icon art it points at — are invisible to the
    // native fingerprint (see `appConfigFingerprint`), so until now they produced no notice at
    // all: the reported case was commenting `icons` out and watching nothing happen.
    //
    // Never rebuild behind the dev's back either way: a reinstall costs ~15s and drops app
    // state, so it stays their call. The notice IS the feature.
    if (!webOnly && ready.length > 0) {
      const poll = setInterval(() => {
        if (rebuilding || reloading) return
        const nowNative = snapshotNativeFp(appRoot, ready)
        const changed = ready.filter((p) => nowNative[p] !== nativeFp?.[p])
        const nowConfig = appConfigFingerprint(appRoot, config)
        const configChanged = nowConfig !== configFp
        // adaptv's OWN source (bin/): only ever moves with a `link:`ed adaptv (framework dev), and
        // the notice is the only signal there is — a generator edit is invisible on screen.
        const nowCli = cliSourceFingerprint()
        const cliChanged = nowCli !== cliFp
        if (changed.length === 0 && !configChanged && !cliChanged) return
        // re-arm all three, so one edit notices once
        nativeFp = nowNative
        configFp = nowConfig
        cliFp = nowCli
        // ONE row, one line (R31) — so the causes MERGE rather than one winning the slot. Config
        // and native name the cause the dev acts on with `r`/`b`. adaptv's OWN source is the
        // exception and WINS the row: the running process holds the old modules, so `r`/`b` can't
        // apply the edit — only a restart can, and a restart re-reads config and re-syncs native
        // too, so naming that superset action is the honest single line.
        if (cliChanged)
          // The restart variant: `b` would rebuild with the CLI modules THIS process already
          // loaded, so it can't apply an edit to adaptv's own source — see liveWatcher's notice.
          watcher.notice("adaptv source change", { restart: true })
        else
          watcher.notice(
            configChanged && changed.length > 0
              ? `config + native change · ${changed.join(", ")}`
              : configChanged
                ? "config change"
                : `native change · ${changed.join(", ")}`,
          )
      }, 3000)
      poll.unref?.()
      cleanups.push(() => clearInterval(poll))
    }

    onDevLine = (l) => {
      if (verbose) {
        detail(`vite │ ${l}`)
        return
      }
      // "[vite] (client) hmr update /src/a.tsx, /src/b.css?direct" → flash the line
      const m = l.match(/hmr update (.+)/i)
      if (m) {
        const files = [
          ...new Set(
            m[1]
              .split(",")
              .map((f) => f.trim().split("?")[0].split("/").pop()),
          ),
        ].join(", ")
        watcher.hmr(files)
      }
    }
    await new Promise(() => {}) // resolved only by the SIGINT handler (process.exit)
  } catch (err) {
    // Anything that escaped a step's own line (the dev server, a teardown-time throw) —
    // still ONE ✖, same shape, so the whole CLI reports failure identically.
    // A step that already settled its own ✖ owns the report — printing again here is a
    // second glyph for one failure (and pastes Node's raw text beside the calm reason).
    if (!wasReported(err)) {
      const { reason, detail } = explainFailure("dev")(err)
      fail("dev", reason, detail)
    }
    teardown()
    process.exit(1)
  }
}

/**
 * Shared orchestration for the two static-build commands. `kind` is "preview" (build →
 * install → launch on a device) or "build" (produce artifacts).
 */
async function pipeline(kind, appRoot, platforms, opts) {
  const verb = kind
  const single = platforms.length === 1
  // `embedded` = this is one part of a larger command (`preview all`, which serves the web
  // surface around it), so the banner and the closing gap belong to that command, not here.
  const embedded = !!opts.embedded
  if (!embedded) header(`${verb} ${single ? platforms[0] : "all"}`)

  // A live `dev` run owns capacitor.config.json (its server.url etc.); regenerating it
  // here would break that run. Refuse until it's stopped.
  assertNoActiveDevLock(appRoot, kind)

  const t0 = Date.now()
  // Config + assets, before the first byte of work (R33). `preview all` preflighted for the
  // whole command — including the web surface it builds ahead of this — and hands the config
  // down rather than having it read, checked and reported a second time.
  const config = opts.config ?? (await preflight(appRoot, platforms))
  // The update core's patch, checked here because here is where it would be compiled in.
  // Printed rather than thrown: the fix is a block the dev has to copy verbatim, and the
  // failure renderer drops lines that name the packages it names.
  if (!(await assertUpdateCorePatched())) return { ran: true, ok: false }
  // Fresh capacitor.config.json FIRST — a release build must never inherit dev fields
  // (`server.url` etc.) left by a `dev` run that was killed before it could revert.
  await setCapacitorConfigEnv(config)
  const verbose = opts.verbose
  const ctx = { targets: {}, output: opts.output }
  const done = {}
  const warnings = []
  const envs = {}
  // lazy per-platform env so a missing JDK/pod fails only that platform.
  const envFor = (p) => {
    if (!envs[p]) envs[p] = platformEnv(p)
    return envs[p]
  }

  // Surface warnings near the step that produced them, not dumped at the very end.
  const flushWarnings = () => flushNotices(warnings)

  const finish = (hint) => {
    flushWarnings()
    // Only a FAILURE gets a closing line. On success every platform already settled its own
    // line naming what it produced or where it launched, so a total underneath adds a row
    // that says nothing new. A failure still needs one: it is the command's verdict, and for
    // `all` it is the only place that says more than one platform went wrong.
    const failed = !platforms.every((p) => p in done)
    if (failed) {
      footer(`${hint} ${c.dim(`· ${since(t0)}`)}`)
      process.exitCode = 1
    } else if (!embedded) spacer()
    return { ran: true, ok: !failed }
  }

  // The command gave up before the lanes ran — the shared web bundle didn't build, or no
  // platform could be prepared. There is exactly ONE thing that went wrong and its ✖ is
  // already on screen, so there is no verdict left to state: a closing
  // `nothing was rebuilt or launched · 3s` under a `✖ web …` is the same fact a second
  // time (R18/R30). Just the blank line, and `false` so the caller stops instead of
  // handing the terminal to a watcher for work that never started.
  const abort = () => {
    flushWarnings()
    process.exitCode = 1
    spacer()
    return { ran: false, ok: false }
  }

  // build fingerprint cache — skip the web build + sync when nothing that affects the
  // bundle changed. `--force` always rebuilds, and so does a bundle that is missing or
  // was not emitted from this config.
  const buildCache = readBuildState(appRoot)
  // Two questions, deliberately kept apart. `fingerprint` asks whether the app's SOURCE
  // moved; the stamp asks whether the bundle on disk was emitted from the config on disk
  // and is still byte-for-byte the one that build wrote. Only the second is shared with
  // `dev`, which has no reason to rebuild for a source edit — see the note there.
  const bundleUnusable = await bundleStale(appRoot, "capacitor", config)
  let fp = fingerprint(appRoot)

  // 1. barrier: build the SPA once (shared by every platform). If it fails, abort —
  //    never fall through and ship a stale bundle. A CACHED build is SILENT — like `dev`
  //    never prints the web bundle build when it's already there — so the asset/config
  //    warnings from prepare stay the first thing under the header, not a cache line on top.
  if (opts.force || bundleUnusable || buildCache.web !== fp) {
    try {
      // Transient, under the plain `web` label: this bundle is what the native targets
      // install, a sub-action of theirs rather than a step the dev asked for — and in
      // `preview all` the served web surface settles its own `web` line afterwards, so a
      // settled one here would print the same name twice for two different things.
      await runLine(
        "web",
        (r) => buildWeb(appRoot, { report: r, config }),
        {
          verbose,
          transient: true,
        },
      )
    } catch (err) {
      // The erased row owns no ✖, so this ONE line carries the whole failure — and it is
      // also the whole command, because nothing downstream can run without this bundle.
      const { reason, detail } = explainFailure("web")(err)
      fail("web", reason, detail)
      return abort()
    }
    // re-fingerprint after the build (it stamps a few files) and remember it.
    fp = fingerprint(appRoot)
    buildCache.web = fp
    buildCache.sync = {} // a new bundle invalidates every platform's sync
    writeBuildState(appRoot, buildCache)
  }

  // The error screen, into the web dir so `cap sync` copies it into each platform's
  // public/. `dev` installs its own (with the dev URL baked in) and deletes it on teardown;
  // this one carries no URL and is NOT reverted, because it has to ship inside the app:
  // Android's `minWebViewVersion` gate loads `server.errorPath` and, with nothing there,
  // Capacitor just logs and boots the app anyway — a silent no-op gate. Unconditional
  // rather than inside the cache branch above, so a cached bundle still gets it.
  await installOfflinePage(appRoot, { url: null, config })

  // The last vite BUILD of the command is done (or was cached away), so it is now safe for
  // the caller to start serving: `preview all` hangs its web server here rather than before
  // the pipeline, because two vite processes on one app collide on any port that app's
  // config pins — see R32 and `buildWebPreview`. Nothing below this point runs vite.
  await opts.onBundleReady?.()

  // 2. prepare native projects — must precede device listing (`cap run --list`
  //    refuses until the platform exists) and sync. Same call `dev` makes, so a step can
  //    never again be added to one command's idea of "prepared" and not the other's.
  const { ready, prepareMs } = await preparePlatforms(
    appRoot,
    config,
    platforms,
    {
      dev: kind === "preview",
      force: opts.force,
      envFor,
      verbose,
      warnings,
    },
  )
  // surface asset/config warnings right after prepare (where they arise), not at the end.
  flushWarnings()

  // Every platform already settled its own `✖ ios  native project — …`, so a footer here
  // would be a second glyph for failures the dev has just read.
  if (ready.length === 0) return abort()

  // 3. resolve device targets (run only) — sequential prompts, up front, so the
  //    parallel launch phase never has two pickers competing for the terminal.
  if (kind === "preview") {
    for (const p of ready) {
      ctx.targets[p] = await resolveTarget(appRoot, p, envFor(p), {
        command: kind,
        target: opts.target,
        latest: opts.latest,
      })
    }
  }

  // 4. sync + launch/package. Single platform → visible per-step lines; `all` →
  //    one live line per platform, run concurrently. Sync is skipped when this exact
  //    bundle was already synced to the platform (cache hit).
  buildCache.sync ??= {}
  // The sync key folds in the install identity: `preview` (`.dev`) and `build` (release id)
  // produce a different capacitor.config.json, so a `preview`↔`build` switch must re-sync
  // even though the web fingerprint is unchanged (it deliberately skips capacitor.config.json).
  const syncTag = `${fp}:${kind === "preview" ? "dev" : "release"}`
  // …but the cache key can't see what's actually BAKED into the native project, and a `dev`
  // run bakes dev-only fields (`server.url` → the live-reload origin) into exactly that file.
  // So a preview after a dev run could hit a cache hit, skip the sync, and install an app
  // still pointing at a dev server that isn't running — the user sees the offline screen
  // instead of their app. Compare the baked config against what this command intends and
  // re-sync when they disagree; it self-corrects no matter which command dirtied it.
  const bakedConfigPath = (p) =>
    p === "ios"
      ? path.join(nativeDir(appRoot, p), "App/App/capacitor.config.json")
      : path.join(
          nativeDir(appRoot, p),
          "app/src/main/assets/capacitor.config.json",
        )
  const bakedConfigStale = (p) => {
    try {
      return configIsStale(
        JSON.parse(readFileSync(bakedConfigPath(p), "utf8")),
        JSON.parse(process.env.ADAPTV_CAPACITOR_CONFIG ?? "{}"),
      )
    } catch {
      return true //unreadable / not synced yet → sync
    }
  }
  const syncNeeded = (p) =>
    opts.force || buildCache.sync[p] !== syncTag || bakedConfigStale(p)
  // Snapshot staleness NOW — after prepare, before any sync. The sync repairs the project's
  // config, but the app ALREADY INSTALLED on the device is whatever the last command put
  // there; a dirty config at this point means that install is a `dev` shell, so the launch
  // step must reinstall rather than relaunch it. Checking after the sync would always read
  // "clean" and happily relaunch the stale binary.
  const staleAtStart = Object.fromEntries(
    platforms.map((p) => [p, bakedConfigStale(p)]),
  )
  // `preview` run cache: when NOTHING that lands on the device changed since the last
  // preview on it — the web bundle+identity (`syncTag`) AND the native project
  // (`nativeFingerprint`: config/plugins/pbxproj; it skips the synced `public/`, which
  // `syncTag` already covers) — skip the whole build+install and just relaunch (~1s vs a
  // full `cap run`). Keyed under a `preview:` prefix so it never crosses dev's run cache.
  buildCache.run ??= {}
  // `cap run` re-syncs and touches native files, so — like dev's run cache — this id must
  // be STORED after the build; a next run's pre-build hash then matches when nothing changed.
  const runIdOf = (platform) =>
    `${syncTag}:${nativeFingerprint(appRoot, platform)}`
  const previewLaunch = async (platform, target, report) => {
    const env = envFor(platform)
    const key = `preview:${platform}:${target.id}`
    // `preview` and `dev` deliberately SHARE the `.dev` install identity, so "an app is
    // installed" cannot tell them apart — after a `dev` run the installed binary is a
    // live-reload shell pointing at a dev server. Taking the fast path there relaunches
    // THAT, and the user gets the "dev server isn't running" screen instead of their app.
    // The baked config is the tell (dev bakes `server.url`), so never reuse an install when
    // it disagrees with what this command intends — rebuild and reinstall instead.
    const cached =
      !opts.force &&
      !staleAtStart[platform] &&
      buildCache.run[key]?.id === runIdOf(platform) &&
      (await isAppInstalled(appRoot, platform, target.id, env))
    if (cached) {
      // Nothing to rebuild — but RELAUNCH (restart), never just foreground: a stale run
      // (e.g. a prior `dev` session's offline screen) must not linger on screen.
      report("relaunching device")
      await launchInstalledApp(appRoot, platform, target.id, env, {
        restart: true,
      })
      await ensureDeviceWindow(platform, target.id, env)
      done[platform] = `launched on ${target.name}`
      return `${target.name} · cached`
    }
    // Say what starts, not what it ends in — `cap run` is a build first and a launch last.
    // See the same note on `dev`'s launch path.
    report("building app")
    // `cap run` installs + activates, but only FOREGROUNDS an already-running app — its old
    // WebView (e.g. the dev offline screen) would stay. Restart it after the build so the
    // freshly-installed bundle is what's shown.
    const wasRunning = await isAppRunning(
      appRoot,
      platform,
      target.id,
      env,
    )
    await capRun(appRoot, platform, target.id, env, { report })
    report("launching device")
    if (wasRunning) {
      await launchInstalledApp(appRoot, platform, target.id, env, {
        restart: true,
      })
    }
    await ensureDeviceWindow(platform, target.id, env)
    buildCache.run[key] = { id: runIdOf(platform) }
    done[platform] = `launched on ${target.name}`
    return target.name
  }

  const tailOne = async (platform, report) => {
    if (syncNeeded(platform)) {
      report("syncing")
      await capSync(appRoot, platform, envFor(platform), {
        report,
        plugins: config?.plugins,
        privacy: config?.privacy,
      })
      buildCache.sync[platform] = syncTag
    } else {
      report("syncing · cached")
    }
    if (kind === "preview") {
      return previewLaunch(platform, ctx.targets[platform], report)
    }
    report("packaging")
    done[platform] = await packageArtifact(
      appRoot,
      config,
      platform,
      envFor(platform),
      ctx.output,
      report,
    )
    return done[platform]
  }

  // ONE line per platform, whatever the count (R1) — a single platform is simply a
  // one-lane run, not a different rendering. This used to branch: one platform printed
  // its internals as top-level steps (`✓ sync`, `✓ package`) while `all` printed one
  // line per platform. So `build ios`, `build android` and `build all` looked like three
  // different commands, and because a cached sync prints nothing, whether you saw a
  // `sync` line depended on which platform you had built last.
  await runLanes(
    ready.map((p) => ({
      label: p,
      // Each lane carries its own outcome (explain → the inline reason + hint), so a
      // failure needs nothing printed after the lanes settle.
      run: (r) => tailOne(p, r),
      offsetMs: prepareMs[p] ?? 0,
      explain: explainFailure(p),
    })),
    { verbose },
  )
  writeBuildState(appRoot, buildCache)

  //The artifacts (or the devices launched) are what a script came for.
  record("result", { [kind]: { ...done } })
  const ok = platforms.every((p) => p in done)
  // On success the label reads like `dev`'s "watching": a green ✓ + bold white word, not an
  // all-green phrase. Failure stays red.
  // Which platform failed and why is already on that platform's own line, so the footer
  // states only the command's outcome — `✖ build failed`, not a second inventory of it.
  return finish(
    ok
      ? `${c.green("✓")} ${c.bold(kind === "preview" ? "launched" : "artifacts ready")}`
      : c.red(`✖ ${verb} failed`),
  )
}

/**
 * A validated surface → the native platforms it means.
 *
 * No `null` branch and no error: by the time this is called the parser has already checked the
 * token against that command's own `choices`, so an unknown one cannot reach here. It used to
 * be three copies of the same check, one per command, each with its own sentence.
 */
function surfaceToPlatforms(surface) {
  if (surface === "all") return ["ios", "android"]
  if (surface === "web") return []
  return [surface]
}

/** adaptv's own version, for `--version`. */
function pkgVersion() {
  try {
    return JSON.parse(
      readFileSync(path.join(ADAPTV_ROOT, "package.json"), "utf8"),
    ).version
  } catch {
    return "unknown"
  }
}

/** `[command, args]` for a vite invocation, preferring the app's own binary. */
function viteCommand(appRoot, args) {
  const bin = localBin(appRoot, "vite")
  return bin ? [bin, args] : ["npx", ["--yes", "vite", ...args]]
}

/**
 * Build the web-lineage bundle that `preview` serves. Returns how long it took, for the
 * server's line to bill (R1: the `web` line covers the whole story, build included).
 *
 * TRANSIENT under the `web` label (R28): this is the bundle the served surface needs, not a
 * surface the dev can open, so it renders live and is erased — the ✓ belongs to the server.
 *
 * Split from `serveWebPreview` so that EVERY vite build in a command finishes before anything
 * starts serving (R32). `preview all` used to serve first and then build the native bundle,
 * which put two vite processes on the same app at once — and a vite config is free to pin
 * ports (a `cloudflare({ inspectorPort })`, an HMR port), which the second process then can't
 * bind. It doesn't even take a long-running server in the config to collide: TanStack's
 * prerender step starts its own `vite preview` inside the build to crawl the routes.
 */
async function buildWebPreview(appRoot, config, opts) {
  const verbose = !!opts.verbose
  const startedAt = Date.now()
  try {
    await runLine(
      "web",
      async (report) => {
        report("building app")
        const [cmd, args] = viteCommand(appRoot, ["build"])
        await exec(cmd, args, {
          cwd: appRoot,
          //Carries the build id like every other vite build adaptv runs, so the
          //bundle it produces can say which config it came from. → build-stamp.ts
          env: { ...process.env, ...(await buildIdEnv(appRoot, config)) },
          onLine: (l) => report(l),
        })
      },
      { verbose, transient: true },
    )
  } catch (err) {
    // The erased row owns no ✖, so this ONE line carries the whole failure — same shape as
    // the shared-bundle failure in `pipeline`, and the whole command, since there is nothing
    // left to serve.
    const { reason, detail } = explainFailure("web")(err)
    fail("web", reason, detail)
    process.exit(1)
  }
  return Date.now() - startedAt
}

/**
 * Serve the built bundle, settling ONE `web` line plus its address block. `offsetMs` bills the
 * build above to this line, so `✓ web · 4.0s` is still the whole surface's time.
 *
 * Split from the holding half below so `preview all` can put the web surface FIRST and still
 * keep the terminal afterwards: start here, run the native targets, then hold. Returns the
 * live server so the caller can hold or stop it.
 *
 * ONE line for the target (R1): the server renders on it and it settles into the address
 * block. It used to print `✓ web build` + `✓ server <url>` and then hand-roll its own
 * `ctrl-c stop` — a dim, unspaced copy of the row `dev` gets from `liveWatcher()`, which is
 * exactly the drift that comes from a command drawing its own output instead of asking the
 * renderer for it.
 */
async function serveWebPreview(appRoot, opts) {
  const verbose = !!opts.verbose
  let child = null
  const found = { local: "", network: "" }
  try {
    await runLine(
      "web",
      async (report) => {
        // `vite preview` is long-running: wait for it to announce an address, then let this
        // line settle and hand the terminal to the watcher.
        report("starting server")
        const [cmd, args] = viteCommand(appRoot, [
          "preview",
          ...(opts.viteArgs ?? []),
        ])
        // detached → its own process group, so `stop()` can take down vite AND its children.
        // `dev` has always done this (`startDevServer`); preview didn't, and a plain
        // `child.kill()` left the workers vite spawns (cloudflare's workerd, one per run)
        // orphaned on ppid 1, still holding the ports the next run needs.
        child = spawn(cmd, args, {
          cwd: appRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
          detached: true,
        })
        const seen = []
        await new Promise((resolve, reject) => {
          const onData = (buf) => {
            const text = String(buf)
            if (verbose) rawOut(text)
            for (const l of text.split("\n")) {
              if (!l.trim()) continue
              seen.push(l)
              //Bounded, because this listener stays attached for as long as the
              //server does — `preview all` holds it for the whole session — and
              //what it is kept for is the last few lines before it stopped.
              if (seen.length > 200) seen.shift()
            }
            const local = text.match(/Local:\s+(https?:\/\/\S+)/)
            const net = text.match(/Network:\s+(https?:\/\/\S+)/)
            if (net) found.network = net[1].replace(/\/$/, "")
            if (local) {
              found.local = local[1].replace(/\/$/, "")
              resolve()
            }
          }
          child.stdout.on("data", onData)
          child.stderr.on("data", onData)
          // A server that dies before announcing an address must say WHY (R13): "exited
          // with code 1" is the one thing the dev already knows. The useful line is in its
          // output — a taken port by far the most often, which Node states as a raw
          // `EADDRINUSE … 127.0.0.1:41720`: true, and unreadable.
          child.on("close", (code) => {
            const raw = seen.join("\n")
            reject(
              Object.assign(
                new Error(
                  `the preview server stopped${code ? ` (exit ${code})` : ""}`,
                ),
                // The wording of a busy port is `explainFailure`'s job, not this call
                // site's: a build that dies on the same port has to say the same thing,
                // and two copies of one sentence drift (R26).
                { tail: portInUse(raw) ? raw : errorTail(seen, 6) },
              ),
            )
          })
        })
        //the addresses are their own block under this row
        return ""
      },
      {
        verbose,
        offsetMs: opts.offsetMs ?? 0,
        explain: explainFailure("web"),
      },
    )
  } catch {
    //`runLine` already rendered the ✖ with the reason — just stop.
    process.exit(1)
  }

  addresses(found)

  // The server outlives this function (in `preview all` the native targets build while it
  // stays up), so the signal handlers are installed HERE — a Ctrl-C during the iOS build
  // must not leave a `vite preview` orphaned on the port.
  const state = { child, watcher: null }
  const stop = () => {
    state.watcher?.stop()
    // The whole GROUP (`-pid`), not just vite: the workers it spawns survive a SIGINT sent
    // to the parent alone, and a worker that outlives the run keeps holding the ports the
    // next one needs. Fall back to the direct child if the group is already gone.
    try {
      process.kill(-state.child.pid, "SIGINT")
    } catch {
      try {
        state.child?.kill("SIGINT")
      } catch {}
    }
  }
  // Exit with whatever the command decided, not a blanket 0: in `preview all` a native
  // target that failed has already set `exitCode`, and Ctrl-C on the still-running web
  // server must not report the whole command as a success.
  const quit = () => {
    stop()
    process.exit(process.exitCode ?? 0)
  }
  process.on("SIGINT", quit)
  process.on("SIGTERM", quit)
  state.stop = stop
  return state
}

/** Hand the terminal to the watcher and hold the preview server until Ctrl-C. */
async function holdWebPreview(state) {
  spacer()
  //The SAME watcher row `dev` uses — bold key, its own line — rather than a second copy of
  //the idea. `keys: false` because there is nothing to reload or rebuild from here (R17).
  state.watcher = liveWatcher({ keys: false })
  await new Promise((resolve) => {
    state.child?.on("close", (code) => {
      state.stop()
      if (code && code !== 0) {
        fail("web", `preview server exited with code ${code}`)
        process.exit(1)
      }
      resolve()
    })
  })
}

/**
 * `adaptv preview web` — the app's real web build, served locally, held until Ctrl-C.
 *
 * The web counterpart of `preview ios|android`: what a user would actually get, rather than
 * the dev server. Wrapped by adaptv (instead of leaving the dev to remember `vite build &&
 * vite preview`) so every target is reached the same way and the web build goes through the
 * same adaptv plugin pipeline — SSR/SPA choice, manifest, service worker — that a deploy does.
 * Deliberately NOT `ADAPTV_TARGET=capacitor`: this is the web lineage (`docs/design/lifecycle.md §0`, L14).
 */
async function previewWeb(appRoot, opts) {
  header("preview web")
  // Before the build, not after it fails inside vite (R33). No platforms: the launcher-icon
  // warnings are about art only a native build uses, and there is nothing native here — but
  // preflight still checks the icon set, because this command serves a manifest too.
  const config = await preflight(appRoot, [], { optional: true })
  const offsetMs = await buildWebPreview(appRoot, config, opts)
  return holdWebPreview(
    await serveWebPreview(appRoot, { ...opts, offsetMs }),
  )
}

/**
 * `adaptv build web` — the site to deploy, with the update channel inside it.
 *
 * ## Why this command exists at all
 *
 * It is the only place the channel CAN be published. An app has two bundles — the
 * site (SSR, service worker) and the one a native WebView runs (SPA, no worker) —
 * and they are separate builds of the same source that both write `dist/client`.
 * Nothing inside a single `vite build` can produce both, so publishing has to be a
 * step that sequences them: build the native bundle, archive it, build the site,
 * then write the archive and its manifest into the site's own output.
 *
 * That ordering is the whole design. The archive is taken BEFORE the site build,
 * because the site build overwrites the directory it was taken from.
 *
 * `preview web` is unchanged and still serves a build locally. This one publishes.
 *
 * ## What CI has to do
 *
 * Deploy `dist/client`. That is the entire contract — the channel rides the
 * ordinary web deploy, under `.well-known/`, so there is no second artifact, no
 * bucket to provision and no release step that can be forgotten independently of
 * the site going out. → `docs/design/ota.md §5.2`
 */
async function buildWebDeploy(appRoot, opts) {
  header("build web")
  //A live `dev` session owns the generated Capacitor config; regenerating it under
  //one would break that run. The same refusal every other build makes.
  assertNoActiveDevLock(appRoot, "build")
  const config = await preflight(appRoot, [])

  const { resolveOtaBuildConfig, resolveOtaOrigin } =
    await loadAdaptvModule("ota/build/ota-config-module.ts")
  //null when the app declares no origin — OTA is off, and this is then simply the
  //web build. Nothing is published, because there is nowhere to publish it to.
  const ota = resolveOtaBuildConfig(appRoot, config)
  const origin = ota ? resolveOtaOrigin(config) : null

  //BEFORE the bundle is built, not after: a deploy that cannot sign must not
  //spend two builds discovering it, and it must never reach the point where a
  //channel could be half-written.
  const signing = ota
    ? await resolveChannelSigning(ota)
    : { privateKey: null }
  if (signing.refusal) {
    fail("channel", signing.refusal.reason, signing.refusal.detail)
    spacer()
    process.exitCode = 1
    return { ran: true, ok: false }
  }

  let bundle = null
  if (ota) {
    try {
      bundle = await stageOtaBundle(appRoot, config, ota, opts)
    } catch (err) {
      const { reason, detail } = explainFailure("web")(err)
      fail("bundle", reason, detail)
      spacer()
      process.exitCode = 1
      return { ran: true, ok: false }
    }
  }

  //Where this build lands is NOT adaptv's to choose and never was: an `ssr` app is
  //assembled into `.output/`, a `spa` one into `dist/client`. `.adaptv/web` is the
  //native lineage's directory and this command does not write a byte of it — yet that
  //is what the line said, for both render modes, which is twenty minutes of debugging
  //a directory the command never touched. The build writes down where it wrote; this
  //reads it back. → src/vite/build-stamp.ts
  let outDir = null
  try {
    await runLine(
      "web",
      async (report) => {
        const [cmd, args] = viteCommand(appRoot, ["build"])
        await exec(cmd, args, {
          cwd: appRoot,
          env: { ...process.env, ...(await buildIdEnv(appRoot, config)) },
          onLine: report,
        })
        //`null` prints as no location at all rather than as a guess — a build that
        //left no stamp is one adaptv did not shape, and naming a directory for it
        //would be the same lie in a new place.
        outDir = await builtOutDir(appRoot, "web")
        return outDir ?? ""
      },
      //The row settles the ✖ itself, worded by `explainFailure` like every other
      //lane. Without `explain` it settled on the raw message — an absolute path,
      //clipped — and the catch below then printed a second ✖ with the calm
      //reason under it: two glyphs for one failure (R2), the first unreadable.
      { verbose: !!opts.verbose, explain: explainFailure("web") },
    )
  } catch (err) {
    //`runLine` owns the ✖ on a TTY and off it; only a failure that never reached
    //the row (the build stamp, say) is still unreported here.
    if (!wasReported(err)) {
      const { reason, detail } = explainFailure("web")(err)
      fail("web", reason, detail)
    }
    spacer()
    process.exitCode = 1
    return { ran: true, ok: false }
  }

  //A channel has to be placed INSIDE the deployed site or it is not published at all,
  //and without the stamp there is no honest answer to where that is. Refuse rather than
  //write it somewhere plausible: an update channel that silently 404s for every
  //installed app is the one failure mode this whole path exists to avoid.
  if (bundle && ota && origin && !outDir) {
    fail("channel", "the build did not report where it wrote", [
      "adaptv could not place the update channel inside the deployed site.",
    ])
    spacer()
    process.exitCode = 1
    return { ran: true, ok: false }
  }

  if (bundle && ota && origin) {
    await runLine("channel", async (report) => {
      const {
        decideChannelEmission,
        fetchDeployedManifest,
        writeChannel,
      } = await loadAdaptvModule("ota/build/ota-emit.ts")
      report("reading the published manifest")
      //What the channel currently serves decides ONE thing: whether this build is
      //new. An unchanged app keeps the timestamp it was first published with, so a
      //re-deploy does not read as a release to every device. Unreachable is fine
      //and means "assume nothing is published" — never a reason to fail a build.
      const deployed = await fetchDeployedManifest(ota.manifestUrl)
      const plan = decideChannelEmission({
        buildTag: bundle.buildTag,
        deployed,
        now: Date.now(),
      })
      report("writing the channel")
      //Written on EVERY deploy, unchanged or not: a deploy replaces the whole site,
      //so skipping the write here deletes the channel from the next one.
      //
      //Into the directory the build just wrote — the one the deploy uploads. It used
      //to be `.adaptv/web`, which the web build does not produce and no host ever
      //receives: the channel was written, the line said it was published, and every
      //installed app went on polling a URL that answered 404. Same wrong constant as
      //the success line above, with a worse ending. The playground's own OTA bench
      //carries a note about this exact failure (`scripts/ota-lab.ts`).
      const written = writeChannel({
        clientDir: path.resolve(appRoot, outDir),
        origin,
        plan,
        archive: readFileSync(bundle.archivePath),
        nativeFingerprint: ota.nativeFingerprint,
        privateKey: signing.privateKey,
      })
      const size = `${(written.bundleBytes / 1024 / 1024).toFixed(1)} MB`
      const unsigned = signing.privateKey ? "" : " · UNSIGNED"
      return `${plan.buildTag} · ${size}${plan.reused ? " · already live" : ""}${unsigned}`
    })
  }

  spacer()
  return { ran: true, ok: true }
}

/**
 * The key this deploy signs with — or the reason it must not publish at all.
 *
 * An update channel is a remote-code-execution channel into every installed app.
 * Publishing one that nothing verifies is not a degraded mode worth warning
 * about and continuing from; it is the failure. So this refuses, and it refuses
 * BEFORE any building, so the answer costs a second rather than two builds.
 *
 * Every branch below is a way to end up with a channel devices reject while CI
 * stays green — including the last one, which is the only place a wrong-half key
 * pair can be caught at all. After this point the evidence is on other people's
 * phones, and reads as "updates just stopped arriving".
 */
async function resolveChannelSigning(ota) {
  const { isUsableOtaPublicKey, resolveSigningKey, signingKeyMatches } =
    await loadAdaptvModule("ota/build/ota-emit.ts")

  let privateKey = null
  try {
    privateKey = resolveSigningKey()
  } catch (err) {
    return {
      refusal: {
        reason: String(err?.message ?? err).replace(/^ota: /, ""),
        detail: [],
      },
    }
  }

  //Signing turned off. That state cannot be reached by accident — it takes two
  //environment variables, one of which also has to repoint the channel — so it
  //is the one case where an unsigned publish is what was asked for.
  if (!ota.requireSignature) return { privateKey }

  const refuse = (reason, ...detail) => ({ refusal: { reason, detail } })

  if (!ota.publicKey)
    return refuse(
      "this app publishes updates but declares no key to verify them with",
      "run 'adaptv keys ota' and put the public half in adaptv.config.ts, under otaPublicKey",
    )
  if (!isUsableOtaPublicKey(ota.publicKey))
    return refuse(
      "otaPublicKey in adaptv.config.ts is not a key a device can load",
      "it must be an RSA public key in PEM form, exactly as 'adaptv keys ota' printed it",
    )
  if (!privateKey)
    return refuse(
      "nothing to sign the update with",
      "set ADAPTV_OTA_PRIVATE_KEY to the private half, or ADAPTV_OTA_PRIVATE_KEY_FILE to a path holding it",
      "in CI that is a secret; on your machine, keep the file outside the repository",
    )
  if (!signingKeyMatches(ota.publicKey, privateKey))
    return refuse(
      "the key being signed with is not the one this app verifies against",
      "the private key in the environment is a different pair from otaPublicKey in adaptv.config.ts",
      "every installed app would reject this update, and say so nowhere you can see",
    )

  return { privateKey }
}

/**
 * Build (or reuse) the bundle installed apps download, and archive it.
 *
 * The cache is an accelerator and nothing more: the tag is always recomputed from
 * the bytes on disk, so a stale cache costs a rebuild, never a wrong manifest.
 *
 * 🔴 Its key is NOT `fingerprint(appRoot)` alone, which is what `dev` and
 * `preview` use. That walk skips `node_modules` — correct for them, wrong here:
 * upgrading adaptv would leave this cache reporting a hit and publish a bundle
 * built by the previous version **to every installed device**. The trade a local
 * cache makes ("worst case you look at slightly stale code") stops being that
 * trade the moment the artifact ships. So the key folds in three inputs:
 *
 *   the app's own sources · the native plugin set · adaptv's runtime source
 *
 * The last one also closes the framework-dev trap where a linked adaptv is edited
 * and the build silently reuses the old framework code.
 *
 * The archive is kept under `.adaptv/ota/` rather than in `dist/`, because `dist`
 * is about to be overwritten by the site build — and because a deploy should carry
 * exactly one copy of it, the one `writeChannel` puts there.
 */
function otaCacheKey(appRoot, ota) {
  return createHash("sha1")
    .update(fingerprint(appRoot))
    .update(ota.nativeFingerprint)
    .update(cliSourceFingerprint(path.join(ADAPTV_ROOT, "src")))
    .digest("hex")
}

async function stageOtaBundle(appRoot, config, ota, opts) {
  const cacheDir = path.join(appRoot, ADAPTV_DIR, "ota")
  const cache = readBuildState(appRoot)
  const fp = otaCacheKey(appRoot, ota)
  const remembered = cache.ota
  const archivePath = remembered?.buildTag
    ? path.join(cacheDir, `bundle-${remembered.buildTag}.zip`)
    : null

  if (
    !opts.force &&
    remembered?.fingerprint === fp &&
    archivePath &&
    existsSync(archivePath)
  ) {
    //Silent, like every other cache hit in the CLI: the `channel` line below names
    //the tag, which is the fact worth reading either way.
    return { buildTag: remembered.buildTag, archivePath }
  }

  await setCapacitorConfigEnv(config)
  /** @type {{ buildTag: string, archivePath: string } | null} */
  let staged = null
  await runLine(
    "bundle",
    async (report) => {
      await buildWeb(appRoot, { report, config })
      const { buildBundleArchive, computeBuildTag } =
        await loadAdaptvModule("ota/build/ota-emit.ts")
      const clientDir = path.join(appRoot, CAP_WEB_DIR)
      const buildTag = computeBuildTag(clientDir)
      //`packaging` — R24's word for "put the built thing into its container", already
      //what the .ipa/.apk step says. `archiving` was a lone verb and `prettyLine` drops
      //those, so this row never said anything at all.
      report("packaging")
      mkdirSync(cacheDir, { recursive: true })
      const target = path.join(cacheDir, `bundle-${buildTag}.zip`)
      writeFileSync(target, buildBundleArchive(clientDir))
      staged = { buildTag, archivePath: target }
      return buildTag
    },
    { verbose: !!opts.verbose, transient: true },
  )

  //Recomputed AFTER the build, because the build stamps a few of the files the
  //app-source half of this key hashes — the same reason `pipeline` re-reads it,
  //and without it every single run is a cache miss.
  cache.ota = {
    fingerprint: otaCacheKey(appRoot, ota),
    buildTag: staged.buildTag,
  }
  writeBuildState(appRoot, cache)
  return staged
}

/**
 * `adaptv keys ota` — the pair that makes the update channel trustworthy.
 *
 * ## Why adaptv keeps no copy
 *
 * The public half is committed, on purpose: it is baked into the store binary,
 * and changing it is a store release. The private half is never written into the
 * repository and never remembered — not in `.adaptv/`, which the framework
 * itself calls disposable, and not anywhere else adaptv can quietly resurrect.
 *
 * A key adaptv stores is a key adaptv can lose, and losing it is not a bad
 * afternoon: every app already on a device verifies against the public half in
 * its binary, so there is no way back to a working channel except a store
 * release and the wait that comes with it. Printing it once puts the copy where
 * it has to live anyway — a secret store — and makes its absence obvious now
 * rather than at the first urgent fix.
 *
 * The private half goes to stdout LAST and alone, so `adaptv keys ota > key.pem`
 * is not the shape of this command; the pair is meant to be read and placed by
 * hand, once, per app.
 */
async function genOtaKeys() {
  header("keys ota")
  const { generateOtaKeyPair } = await loadAdaptvModule(
    "ota/build/ota-emit.ts",
  )
  const { publicKey, privateKey } = generateOtaKeyPair()

  section("public: commit this")
  detail("adaptv.config.ts ▸ otaPublicKey")
  //`verbatim` because a key is bytes, not prose: anything that wraps, indents or
  //re-flows it produces a PEM that no longer parses, and the dev finds out on a
  //device. And it is the OUTCOME, not narration: printed as `rawOut` it was a
  //step, so `keys ota --quiet` printed nothing, exited 0, and threw away a pair
  //adaptv keeps no copy of (R46).
  verbatim(`\n${publicKey.trim()}\n`)

  section("private: never commit this")
  detail("ADAPTV_OTA_PRIVATE_KEY, in the secret store your deploy reads")
  verbatim(`\n${privateKey.trim()}\n`)

  spacer()
  log.warn(
    "shown once. adaptv keeps no copy, and a lost key means no installed app can be updated again until a store release",
  )
  spacer()
  return { ran: true, ok: true }
}

/**
 * `adaptv icons --input <image>`: the app's whole icon set, from one image.
 *
 * The command adaptv was missing: it could always PICK the best member of an icon set, but
 * getting one meant finding a favicon generator on the web and hoping its filenames matched
 * what adaptv reads. Now the set is adaptv's own, so the manifest, the head and the native
 * launcher icons are all reading files adaptv wrote.
 *
 * The image is NAMED (`--input`) rather than positional. It started positional, on the argument
 * that `--target` — the flag a dev reaches for out of habit from `dev`/`preview`/`build` — is a
 * device id and must not gain a second meaning. That was the right worry and the wrong fix: the
 * dev still reached for a flag, and got `missing image` while looking at a command that plainly
 * contained one. A name they cannot collide with is the answer to both.
 */
async function genIcons(appRoot, _positional, flags) {
  header("icons")

  //Nothing is validated here any more. Unknown flags, a missing `--input`, an out-of-range
  //`--margin` and a `--background` that isn't a colour are all rejected by the parser, from
  //the spec, BEFORE this function is entered — which is why the banner above is now safe to
  //print: it can no longer appear over a command that was never going to run (R33).
  const imageArg = flags.input
  //They named an image and it isn't there. The SHAPE of the command was not the problem, so
  //no usage block — that would be adaptv answering a question nobody asked (R6).
  const sourceAbs = path.resolve(appRoot, imageArg)
  if (!existsSync(sourceAbs)) throw new Error(`no such image: ${imageArg}`)

  //Through `preflight` like every other command (R33): a config adaptv would refuse for a
  //build must not be quietly accepted here, or the dev overwrites their icon directory and
  //only then finds out the run they wanted was never going to happen. `icons: false` because
  //a `!` about the set this command is REPLACING is stale before it is read.
  const config = await preflight(appRoot, [], { icons: false })
  const { resolveIconSet, manifestIcons } =
    await loadAdaptvModule("vite/icon-set.ts")
  //Resolved with NO adaptv fallback: this command is about the dev's own directory, and
  //`icons` writing into it is exactly what makes the fallback stop applying.
  const configured = resolveIconSet(appRoot, config, [])

  // WHERE the set goes, and never by guessing: files landing in a directory the dev never
  // named is a surprise they find afterwards, so the destination has to have been chosen,
  // either in the config or on the command line. `resolveIconSet` now holds the same line on
  // the READ side — an app that names no directory wears adaptv's mark rather than picking up
  // whatever happens to be in `./public/favicons`.
  const outArg = typeof flags.output === "string" ? flags.output : null
  const configuredDir =
    typeof config.icons === "string" ? config.icons : null
  //A plain error, not an invocation fault: this one can only be known once the CONFIG has been
  //read, so the parser could not have caught it and the shape of the command was not wrong.
  //The message names both fixes, which is all R7 asks.
  if (!outArg && !configuredDir)
    throw new Error(
      "nowhere to write. Set 'icons' in adaptv.config.ts, or pass --output <dir>",
    )

  //`--output` also serves as the escape hatch for a set that is NOT this app's: comparing two
  //sources, or producing adaptv's own shipped mark without inventing a scratch app for it.
  const set = outArg
    ? {
        ...configured,
        dirRel: outArg,
        dirAbs: path.resolve(appRoot, outArg),
      }
    : configured
  //Only the CONFIGURED directory has to be servable — an explicit `--output` is the dev saying
  //they know where these are going.
  if (!outArg && set.error) throw new Error(set.error)

  //Where the path came from, for the one message that is about to destroy files with it. An
  //`--output` the dev just typed needs no explaining; a path that arrived from a config file
  //they may not have open does.
  const whence = outArg ? "" : " (your 'icons' dir)"

  const sharp = (await import("sharp")).default
  const ext = path.extname(sourceAbs)
  //Bytes adaptv cannot decode are the ONLY refusal — there is no set to generate (R7).
  const error = sourceError(ext)
  if (error) {
    log.error(error)
    spacer()
    process.exit(1)
  }

  // Everything else about the source is a `!`, stated under the banner BEFORE anything is
  // written or asked (R33) — so it reaches the dev while cancelling is still free, and reads
  // the same way the icon notices on `dev`/`build` do. It is deliberately not a refusal: a
  // 512px source is a real answer for someone prototyping, and adaptv saying what will be
  // worse is help, where adaptv saying no is just the tool in the way.
  //ONE reading of the pixels, shared by the warnings and the layout. `measureArtwork` finds
  //where the background stops and how far the art reaches from its own centre; the `!`s below
  //and every masked slot are both derived from it, so they cannot disagree about whether a
  //mask is going to crop this logo.
  const [meta, artwork] = await Promise.all([
    sharp(sourceAbs)
      .metadata()
      .catch(() => ({})),
    //A file with the right extension that sharp still cannot decode — a truncated png, an svg
    //whose root element sits past sharp's format-sniffing window. `sourceError` only checks the
    //extension, so without this the run ends on `Input file contains unsupported image format`,
    //which is the library's sentence about its own internals, not adaptv's about their file.
    measureArtwork(sharp, sourceAbs).catch(() => {
      throw new Error(`could not read ${imageArg}. Is it a valid image?`)
    }),
  ])
  // The numeric flags are read HERE, with everything else adaptv knows before it acts (R33) —
  // a bad `--margin` must stop the run before the icon directory is emptied, and an unusual but
  // legal one must be said while cancelling is still free.
  // Hand-authored iOS 18 appearance variants. Resolved BEFORE the warnings, because "your mark
  // is too dark for the derived dark icon" is not something to say to someone who has already
  // supplied one.
  const appearances = {}
  for (const [flag, slot] of [
    ["dark", "icon-dark.png"],
    ["tinted", "icon-tinted.png"],
    ["monochrome", "icon-monochrome.png"],
  ]) {
    if (typeof flags[flag] !== "string") continue
    const abs = path.resolve(appRoot, flags[flag])
    if (!existsSync(abs))
      throw new Error(`no such image: ${flags[flag]} (--${flag})`)
    appearances[slot] = abs
  }

  //Resolved HERE, above the notices that read it — R33 puts everything adaptv already knows
  //before the run, so the values those notices are derived from have to exist by then.
  //`backgroundChosen` is whether the dev NAMED the colour, not what it resolved to:
  //`--background` outranks a measured background (see `slotPlan`), and once through `parseHex`
  //the default is indistinguishable from someone typing `--background #ffffff`.
  const backgroundChosen = typeof flags.background === "string"
  const background = parseHex(
    flags.background ?? (await resolveIconPlan()).iconBackground,
  )
  //What the mark will actually sit on. Shared with `slotPlan` rather than restated, so the
  //preview sheet cannot disagree with the files it is previewing.
  const tile = effectiveBackground(artwork, background, backgroundChosen)

  const tuning = parseTuning(flags)
  if (tuning.errors.length > 0) {
    for (const e of tuning.errors) log.error(e)
    spacer()
    process.exit(1)
  }
  flushNotices([
    ...sourceWarnings(
      {
        ...meta,
        isolable: artwork.mark !== null,
        luminance: artwork.luminance,
        background: artwork.background,
        backgroundChosen,
        hasDark: appearances["icon-dark.png"] !== undefined,
        hasTinted: appearances["icon-tinted.png"] !== undefined,
      },
      ext,
    ),
    ...tuning.warnings,
  ])

  // The overwrite gate. `icons` REPLACES the directory's art, so a dev pointing it at a
  // hand-tuned set has to say so — but only when there is something to lose (R4: an empty or
  // absent directory asks nothing).
  //Counted with `existingIcons`, not `set.icons`: the set is only art adaptv can RANK, while
  //what is about to be deleted includes the `.ico` and the `.svg` too. A prompt that says 11
  //and removes 13 is the kind of thing a dev finds out afterwards.
  const doomed = existingIcons(set.dirAbs)
  if (doomed.length > 0 && !flags.yes) {
    const ok = await confirm(
      `replace ${doomed.length} icons in ${set.dirRel}${whence}?`,
      { yes: "replace them" },
    )
    //`null` is "nobody could be asked" (CI, a pipe). Answering yes on the dev's behalf there
    //would overwrite files with no one watching, so the flag that decides it is named instead.
    if (ok === null)
      throw new Error(
        `${set.dirRel}${whence} is not empty. Pass --yes to replace it`,
      )
    if (!ok) {
      //A deliberate "no" is not a failure (`✖` would read as adaptv scolding them for it) and
      //not a success (`✓` would claim work that did not happen). It is something the dev needs
      //to know, which is what the `!` is for — and it names the DIRECTORY, because the thing
      //they just protected is the one thing worth confirming is still there.
      log.warn(`cancelled; ${set.dirRel} is unchanged`)
      spacer()
      return
    }
  }

  let written = []
  await runLine("icons", async () => {
    written = await generateIcons({
      source: sourceAbs,
      dirAbs: set.dirAbs,
      background,
      backgroundChosen,
      padding: tuning.values.padding,
      margin: tuning.values.margin,
      artwork,
      appearances,
      sharp,
    })
    return `${written.length} files → ${set.dirRel}`
  })
  //The icon directory just changed underneath every memo that describes it. This command is
  //the only one in the CLI that WRITES art, and it goes on to re-resolve the set for the
  //preview sheet below — so forget what was remembered before those files existed.
  clearIconCaches()

  {
    // ALWAYS, not behind a flag. The sheet is the only place the dev can actually SEE what the
    // warnings above are about — a mark cropped by Android's circle, a favicon that turns to
    // mush at 16px — and it costs one file in a directory adaptv already owns and gitignores.
    // Behind `--preview` it was a feature only someone who already knew to look would find,
    // which is exactly backwards for a review step.
    const dest = path.join(appRoot, ADAPTV_DIR, "icons-preview.html")
    mkdirSync(path.dirname(dest), { recursive: true })
    writeIconPreview({
      dest,
      dirAbs: set.dirAbs,
      names: written,
      manifest: manifestIcons(resolveIconSet(appRoot, config, [])),
      meta: {
        dirRel: set.dirRel,
        sourceRel: path.relative(appRoot, sourceAbs),
        padding: tuning.values.padding,
        margin: tuning.values.margin,
        artTarget: artTarget(tuning.values.margin),
        safeZone: SAFE_ZONE,
        //The colour that will actually SHIP, not the flag's value. `slotPlan` prefers the
        //measured background over the default, so a green-backed logo lands on green in every
        //solid slot and in `ic_launcher_background` — while the sheet drew its adaptive tiles
        //on white and captioned them `+ rgb(255 255 255)`. A preview whose whole job is
        //showing what the platforms will do must not disagree with them about the one colour
        //this run just printed a `!` about.
        background: `rgb(${tile.r} ${tile.g} ${tile.b})`,
      },
    })
    detail(`preview  ${path.relative(appRoot, dest)}`)
  }

  spacer()
}

async function main() {
  // Parsing, help and every invocation error come from ONE description of the command
  // surface (`cli-spec.mjs`). Nothing below re-validates a flag or a surface: by the time a
  // case body runs, the flags are known-good and the surface is one of its own choices.
  const parsed = parse(process.argv.slice(2))
  const { path: cmdPath, flags, rest } = parsed
  const appRoot = CWD

  if (parsed.version) return renderVersion(pkgVersion())
  if (parsed.help) return renderHelp(cmdPath)
  //Before any command runs, so no banner escapes ahead of the mode being known.
  setOutputMode({ json: !!flags.json, quiet: !!flags.quiet })

  // `--verbose` means "show me what the tools are actually doing", so it has to reach
  // the tools, not just the renderer. Set once here rather than threaded per call
  // site: every vite invocation (dev, build, preview) spawns with `...process.env`,
  // so one assignment covers all of them and none can be forgotten. Read by adaptv's
  // own vite plugins — currently the image pipeline's per-build cost summary.
  if (flags.verbose) process.env.ADAPTV_VERBOSE = "1"

  switch (cmdPath.join(" ")) {
    case "doctor": {
      const out = await doctor(appRoot)
      emitJson({ command: "doctor", version: pkgVersion() })
      return out
    }

    case "icons":
      return await genIcons(appRoot, null, flags)

    //`ota` is the only kind today, and the parser has already checked it. The
    //argument exists so the second kind is a line in the spec rather than a
    //renamed command.
    case "keys":
      return await genOtaKeys()

    case "dev": {
      // `dev` is the live-reload command: one Vite dev server, web + native
      // WebViews all pointed at it. `web` = the dev server alone (no native).
      const platforms = surfaceToPlatforms(rest[0])
      return runLive(appRoot, platforms, {
        target: flags.target,
        latest: !!flags.latest,
        verbose: !!flags.verbose,
        force: !!flags.force,
        viteArgs: flags.viteArgs,
        host: flags.host, // true | undefined — external (LAN) mode
      })
    }

    case "preview": {
      // `preview` = the real build, run the way a user would get it. `web` serves the web
      // build locally; the native targets install and launch it on a device (no live reload).
      if (rest[0] === "web")
        return await previewWeb(appRoot, {
          verbose: !!flags.verbose,
          viteArgs: flags.viteArgs,
        })
      const platforms = surfaceToPlatforms(rest[0])
      // `all` means every surface a user could get the app on, WEB INCLUDED — it used to
      // mean "every NATIVE target", so `preview all` skipped the one surface you can look
      // at without a device, and the command exited with nothing still running.
      const opts = {
        target: flags.target,
        latest: !!flags.latest,
        verbose: !!flags.verbose,
        force: !!flags.force,
      }
      if (rest[0] === "all") {
        // WEB FIRST, then the devices. `web` is the app's own JavaScript: if the bundle is
        // broken, it breaks here, in seconds, instead of after two native builds have run.
        // It also keeps the three surfaces as one uninterrupted block under one banner —
        // running it last put `web` after a blank line, reading like a separate command.
        // The server keeps running while the native targets build; the terminal is handed
        // over only once every surface has settled its line.
        header("preview all")
        // Before the first vite build, not inside `pipeline` after it: the web bundle is
        // work, and nothing this command already knows may be reported from underneath work
        // it went on to do anyway (R33). The config travels down so the native half doesn't
        // read and check it a second time.
        const config = await preflight(appRoot, platforms)
        // BUILD, then serve (R32). Both bundles are vite builds of the same app — the web
        // lineage here, the capacitor one inside `pipeline` — and they must not run while a
        // `vite preview` for that app is up: whatever the config pins (a cloudflare
        // `inspectorPort`) is already taken, and the build dies on a port the dev never
        // asked for. Serving is deferred to `onBundleReady`, the moment the last build is
        // done, which still leaves `✓ web` and its addresses above the device lanes (R29).
        const buildMs = await buildWebPreview(appRoot, config, {
          verbose: !!flags.verbose,
        })
        /** @type {Awaited<ReturnType<typeof serveWebPreview>> | null} */
        let web = null
        const native = await pipeline("preview", appRoot, platforms, {
          ...opts,
          config,
          embedded: true, //one banner and one closing gap per command, not per surface
          onBundleReady: async () => {
            web = await serveWebPreview(appRoot, {
              verbose: !!flags.verbose,
              viteArgs: flags.viteArgs,
              offsetMs: buildMs,
            })
          },
        })
        // The pipeline gave up before it launched anything (a broken bundle, no platform
        // preparable). Holding the terminal then is a promise the run can't keep: it
        // printed `✖ web …`, launched nothing, and still sat there offering `ctrl-c stop`
        // as if something were live. Stop the server this command started and leave (R30).
        // A run that DID reach the devices keeps the terminal even if a platform failed —
        // the web surface (and whatever else launched) is up and worth using.
        // `web` is null when it gave up BEFORE the bundle was ready (the capacitor build
        // failed), which is now the earliest thing that can go wrong.
        if (!native.ran) {
          web?.stop()
          process.exit(1)
        }
        return await holdWebPreview(web)
      }
      return pipeline("preview", appRoot, platforms, opts)
    }

    case "build": {
      //`web` is not a platform — it produces a deployable directory, not a device
      //artifact — so it does not go through the native pipeline at all.
      if (rest[0] === "web") {
        const out = await buildWebDeploy(appRoot, {
          verbose: !!flags.verbose,
          force: !!flags.force,
        })
        emitJson({ command: "build web", version: pkgVersion() })
        return out
      }
      const out = await pipeline(
        "build",
        appRoot,
        surfaceToPlatforms(rest[0]),
        {
          output: flags.output,
          verbose: !!flags.verbose,
          force: !!flags.force,
        },
      )
      emitJson({ command: `build ${rest[0]}`, version: pkgVersion() })
      return out
    }

    //No `default`: an unrecognised command never reaches here. `parse` throws a `CliFault`
    //carrying the token and a suggestion, and the catch below renders it — so there is no
    //second, weaker copy of "unknown command" to drift away from the first.
  }
}

main().catch((err) => {
  // An INVOCATION fault is not a run failure: nothing started, so there is nothing to tear
  // down and nothing to report but the sentence and the fix. It exits 2 (BSD `EX_USAGE`), so
  // CI can tell "the command was typed wrong" from "the build broke" — which is exactly the
  // distinction a single exit code was hiding.
  //`usageFail` owns its own blank lines, on stderr, so the block stays intact when stdout is
  //redirected somewhere else.
  if (err instanceof CliFault) {
    renderFault(err)
    process.exit(2)
  }
  // Same rule at the top level: if a step already rendered this failure, exit quietly
  // rather than appending Node's raw message under the calm one.
  if (!wasReported(err)) {
    log.error(err?.message ?? String(err))
    //`tail` is one line or several — a usage block is several, and joining them would put a
    //comma where a line break belongs. It is the failure's detail, so it survives the modes the
    //`✖` above it does: `--quiet` dropped it at step level, and `--json` never showed it (R46).
    for (const line of [].concat(err?.tail ?? []))
      detail(line, { failure: true })
  }
  process.exit(1)
})
