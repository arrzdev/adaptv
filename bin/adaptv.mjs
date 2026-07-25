#!/usr/bin/env node
// The adaptv CLI — owns the whole native (Capacitor) lifecycle so a consumer never
// touches Capacitor, the toolchain env, or the asset generator by hand:
//
//   adaptv doctor                     check the local toolchain (JDK, Android SDK, Xcode, pod)
//   adaptv dev  web|ios|android|all   live reload: one Vite dev server, web + native
//                                    WebViews all attached, hot-reloading on save
//   adaptv preview web|ios|android|all  the real build: web served locally, native installed
//                                    and launched on a device (no live reload)
//   adaptv build ios|android|all      static artifacts: build SPA → sync → package (.ipa/.apk)
//
//   dev/preview flags:
//               --target <id>   launch on a specific device/simulator id
//               --latest        reuse the last device picked for this platform
//               --host [ip]     (dev only) serve on the LAN IP for a PHYSICAL device — auto
//                               when the target is a real device; pass an ip to pin it
//               --force         reinstall even when nothing native changed (dev/preview skip
//                               the rebuild and just relaunch the installed app otherwise)
//               -- <vite args>  (dev only) forwarded to the vite dev server (e.g. `-- --port 4000`)
//   build flags: --output <path> where to write the artifact (default: .adaptv/)
//               --force         rebuild even if unchanged (web build + sync are cached)
//   all:         --verbose      show the full underlying tool logs (raw passthrough)
//
// Native projects live inside the hidden, git-ignored `.adaptv/` dir (relocated from the
// app root). The CLI resolves ANDROID_HOME / JAVA_HOME / pod / LANG itself and invokes
// the local `cap` / `capacitor-assets` binaries directly, so it works from a bare shell.
import { spawn, spawnSync } from "node:child_process"
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { createRequire } from "node:module"
import { homedir } from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { build as esbuild } from "esbuild"
import { startDevServer, warmDevServer } from "./lib/dev-server.mjs"
import {
  cachedDevice,
  listTargets,
  resolveTarget,
} from "./lib/devices.mjs"
import { exec } from "./lib/exec.mjs"
import { fingerprint, nativeFingerprint } from "./lib/fingerprint.mjs"
import {
  androidReverse,
  healDevAtsLeftover,
  patchIosAts,
  patchIosLocalNetwork,
  patchServerUrl,
} from "./lib/live-reload.mjs"
import {
  acquireDevLock,
  assertNoActiveDevLock,
  releaseDevLock,
  updateDevLock,
} from "./lib/lock.mjs"
import {
  ADAPTV_DIR,
  buildWeb,
  CAP_WEB_DIR,
  capAddIfMissing,
  capCmd,
  capRun,
  capSync,
  explainLaunchFailure,
  foregroundDevice,
  generateAssets,
  iosEnv,
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
} from "./lib/native.mjs"
import { configIsStale } from "./lib/native-state.mjs"
import { installOfflinePage } from "./lib/offline-page.mjs"
import {
  addresses,
  c,
  check,
  detail,
  fail,
  flushNotices,
  footer,
  header,
  helpText,
  liveWatcher,
  log,
  onKeys,
  rawOut,
  rewindLines,
  runLanes,
  runLine,
  section,
  since,
  spacer,
  wasReported,
} from "./lib/render.mjs"
import { readBuildState, writeBuildState } from "./lib/state.mjs"
import { errorTail, gradleCause } from "./lib/tool-log.mjs"

const CWD = process.cwd()
//the framework package root — bin/ is directly under it. Lets the CLI load adaptv's
//own pure modules (doctor, privacy-manifest) rather than duplicate them.
const ADAPTV_ROOT = fileURLToPath(new URL("..", import.meta.url))

/* =============================================================================
 * config loading (esbuild-bundled `adaptv.config.ts`)
 * ============================================================================= */

async function loadConfig(appRoot) {
  const configPath = path.join(appRoot, "adaptv.config.ts")
  if (!existsSync(configPath)) {
    throw new Error(
      `no adaptv.config.ts in ${appRoot} — run from an app root.`,
    )
  }
  const result = await esbuild({
    entryPoints: [configPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    plugins: [
      {
        name: "externalize-dynamic-imports",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (args) =>
            args.kind === "dynamic-import" ? { external: true } : null,
          )
        },
      },
    ],
  })
  const source = result.outputFiles?.[0]?.text
  if (!source) throw new Error("failed to bundle adaptv.config.ts")
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  const mod = await import(url)
  const config = mod.default
  if (!config?.appId) {
    throw new Error("missing `appId` in adaptv.config.ts")
  }
  return config
}

/**
 * Load a adaptv source module (TS) and return its exports. Same esbuild trick as
 * loadConfig, so the CLI can call the framework's own pure functions (doctor,
 * privacy-manifest) instead of duplicating them here.
 */
async function loadAdaptvModule(relFromSrc) {
  const abs = path.join(ADAPTV_ROOT, "src", relFromSrc)
  const result = await esbuild({
    entryPoints: [abs],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    alias: { "#adaptv": path.join(ADAPTV_ROOT, "src") },
  })
  const source = result.outputFiles?.[0]?.text
  if (!source) throw new Error(`failed to bundle ${relFromSrc}`)
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  return import(url)
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

/** The native fingerprint of each ready platform, keyed by platform. */
function snapshotNativeFp(appRoot, platforms) {
  return Object.fromEntries(
    platforms.map((p) => [p, nativeFingerprint(appRoot, p)]),
  )
}

/* =============================================================================
 * run / build pipelines
 * ============================================================================= */

/** How much captured tool output a failed line expands into — enough to name the problem,
 *  not a log dump (that's `--verbose`). Generous rather than tight: the lines are already
 *  filtered to the ones that explain the failure, and cutting a diagnostic off mid-
 *  instructions is the one failure mode worse than a few lines too many (CLI-UX R15). */
const DETAIL_LINES = 10
// ANSI escape (ESC = char 27), built without a literal control char in the source. Tool
// output arrives coloured, and a reason rendered inline has to measure as what it prints.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g")

/**
 * Describe a failure the way the renderer wants it: a concise `reason` shown INLINE on
 * that step's own `✖ <label>` line, plus `detail` lines dim underneath. This is the ONLY
 * place a failure is put into words — every step/lane carries its own outcome, so nothing
 * prints a second `✖ <label> failed — …` afterwards (that duplicated the glyph and, for
 * `all`, separated a platform's reason from its line by the other platform's).
 *
 * A recognised cause wins (iOS signing, an unavailable device, Developer Mode off, …):
 * its message is the reason and its fix steps are the detail. Otherwise the first line of
 * the captured tail is — for xcodebuild/gradle `err.message` is only "exited with code
 * 65", while `err.tail` is already filtered down to the lines that name the error.
 */
function explainFailure(label) {
  return (err) => {
    const known = explainLaunchFailure(
      label,
      `${err?.message ?? ""}\n${err?.tail ?? ""}`,
    )
    if (known) return { reason: known.msg, detail: known.fix }

    const lines = String(err?.tail ?? "")
      .split("\n")
      .map((l) => l.replace(ANSI, "").trim())
      .filter(Boolean)
      // `** BUILD FAILED **` & friends only restate the ✖ that's already printing.
      .filter((l) => !/^\*{2}.*\*{2}$/.test(l))
    // Gradle never says `error:` — it nests the cause under `* What went wrong:`, so the
    // generic pass below would settle for `> Task :app:… FAILED` (the task, not the cause).
    // Ask the gradle-aware extractor first; the boilerplate it skips is exactly what was
    // being dumped as a 7-line block under the ✖.
    const gradle = gradleCause(lines)
    if (gradle)
      return {
        reason: gradle,
        detail: lines
          .filter(
            (l) =>
              /^\s*Execution failed for task/i.test(l) &&
              !l.includes(gradle),
          )
          .slice(0, 1),
      }
    // `exec` narrows the tail to error-ISH lines, but the ones that actually say `error:`
    // are what a dev reads; the rest are trailers ("The following build commands failed:").
    const errors = lines.filter((l) => /\berror\s*:/i.test(l))
    const picked = errors.length ? errors : lines
    if (picked.length === 0)
      return {
        reason: String(err?.message ?? err).split("\n")[0],
        detail: [],
      }
    const { message, where } = toolErrorParts(picked[0])
    return {
      reason: message,
      detail: [
        where && `at ${where}`,
        ...picked.slice(1, 1 + DETAIL_LINES).map(shortenLocator),
      ].filter(Boolean),
    }
  }
}

/**
 * Split a compiler/tool error into what to say and where. clang/swift/gradle prefix the
 * message with an ABSOLUTE `file:line:col: error:` locator — long enough on its own to
 * overflow the line and push the actual message off the end, which is how the reason
 * became unreadable. So the message goes INLINE (it's what's read first) and a short
 * `file:line:col` goes on the dim line under it.
 */
function toolErrorParts(raw) {
  const m = raw.match(
    /^(\S+?):(\d+)(?::(\d+))?:\s*(?:fatal\s+)?error:\s*(.+)$/i,
  )
  if (m)
    return {
      message: m[4],
      where: `${path.basename(m[1])}:${m[2]}${m[3] ? `:${m[3]}` : ""}`,
    }
  // no locator — strip any `<tool>: error:` prefix and keep the sentence.
  return {
    message: raw.replace(/^.*?\berror\s*:\s*/i, "") || raw,
    where: "",
  }
}

/** Same idea for a detail line: keep the filename, drop the directories. */
const shortenLocator = (l) => l.replace(/^\/\S*\//, "")

/**
 * Assemble the platform artifact (.apk / .ipa) and place it at `output` or `.adaptv/`.
 * Returns the artifact path relative to the app root — that string becomes the step's
 * settled detail, and an absolute path there is just noise the renderer has to truncate.
 *
 * Both artifacts are UNSIGNED/debug on purpose: adaptv owns the whole native toolchain
 * and the consumer owns none of it (DECISIONS §2 L20 — they never name, install or script
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
      "no .adaptv/ios/App/App.xcworkspace — the iOS project isn't prepared.",
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

  report("packaging .ipa")
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

/** Resolve where an artifact should land: a `--output` path/dir, or `.adaptv/<default>`. */
function resolveOutput(appRoot, output, defaultName) {
  const base = path.join(appRoot, ADAPTV_DIR)
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
  let devServer = null
  let onDevLine = null // set once we're watching; parses HMR events
  let watcher = null // the live "watching / hot-reload" status line
  let launchAll = null // replays the launch lines (used by the `r` key)
  let nativeFp = null // last-known native fingerprint per platform
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

  // A config problem (missing file / no appId) is a plain user error — show it as a clean
  // one-liner and stop, exactly like the dev-lock check above, not a "run failed" step
  // report. `dev web` needs no config.
  let config = null
  if (!webOnly) {
    try {
      config = await loadConfig(appRoot)
    } catch (err) {
      log.error(err.message)
      process.exit(1)
    }
  }

  try {
    const warnings = []
    const prepared = new Set()
    // Per-platform scaffolding time, billed to that platform's launch line further down
    // (it runs before the line exists — see the prepare loop). Declared out here because
    // the launch phase lives in a separate `if (!webOnly)` block.
    const prepareMs = {}

    if (!webOnly) {
      // Fresh capacitor.config.json before anything reads or patches it, so a run
      // killed without teardown can never leave dev fields behind for the next command.
      await setCapacitorConfigEnv(config)
      // cap sync copies the web bundle even though the WebView loads from the dev
      // server, so make sure one exists (content is irrelevant here).
      if (!existsSync(path.join(appRoot, CAP_WEB_DIR, "index.html"))) {
        await runLine(
          "web bundle (first run)",
          (r) => buildWeb(appRoot, { report: r }),
          { verbose },
        )
      }
      // prepare native projects (must exist before device listing + sync).
      const prepareOne = async (platform, report) => {
        await capAddIfMissing(appRoot, platform, envFor(platform), {
          report,
          plugins: config?.plugins,
        })
        const res = await generateAssets(appRoot, config, [platform], {
          report,
        })
        //NOT platform-prefixed: an icon/splash source is an app-level fact, identical for
        //every platform. Prefixing it made `all` print the same sentence once per
        //platform, as if two different things were wrong.
        warnings.push(...res.warnings)
        prepared.add(platform)
      }
      // Scaffolding the native project has to happen HERE, before the device picker: the
      // device list comes from `cap run <platform> --list`, which needs the project to
      // exist. But it is NOT a step of its own — it's the first thing that platform does.
      // So on a first run (`cap add` + CocoaPods is slow and worth watching) it renders on
      // a TRANSIENT line under the platform's OWN label, which is erased rather than
      // settled; the seconds it took are then folded into that platform's real line below
      // (`prepareMs` → `offsetMs`). The dev sees one `ios` line that begins at "preparing"
      // and settles once — no separate "native project" step to learn. On later runs it's
      // a sub-10ms no-op, done with no line at all.
      for (const platform of platforms) {
        const fresh = !existsSync(nativeDir(appRoot, platform))
        const t0 = Date.now()
        try {
          if (fresh) {
            await runLine(platform, (r) => prepareOne(platform, r), {
              verbose,
              transient: true,
            })
          } else {
            await prepareOne(platform, () => {})
          }
        } catch (err) {
          // The transient line was erased and this platform never reaches the launch
          // lanes, so its ONE line is printed here — same shape as a settled ✖.
          const { reason, detail } = explainFailure(platform)(err)
          fail(platform, `native project — ${reason}`, detail)
        }
        prepareMs[platform] = Date.now() - t0
      }
      flushNotices(warnings)
    }

    const ready = platforms.filter((p) => prepared.has(p))
    if (!webOnly && ready.length === 0) {
      teardown()
      process.off("SIGINT", onSigint)
      process.off("SIGTERM", onSigint)
      process.off("SIGHUP", onSigint)
      footer(c.red("✖ could not prepare any platform"))
      process.exitCode = 1
      return
    }

    // Decide whether the dev server must be reachable over the LAN (bind 0.0.0.0) BEFORE
    // asking which device — so a broken app surfaces on the `dev server` line without first
    // forcing a device pick. The LAN is needed when the run COULD land on a physical device:
    // --host, a physical --target, a cached physical (--latest), or a physical device sitting
    // in the picker's list. Over-binding when a simulator is ultimately picked is harmless
    // (localhost still works); a false negative would break a physical launch.
    const forcedHost = opts.host // true | "<ip>" | undefined
    let externalPossible = !!forcedHost
    if (!webOnly && !externalPossible) {
      for (const p of ready) {
        const env = envFor(p)
        const physicalInPlay = opts.target
          ? isPhysicalTarget(p, opts.target, env)
          : opts.latest
            ? isPhysicalTarget(p, cachedDevice(appRoot, p)?.id, env)
            : (await listTargets(appRoot, p, env)).some((t) =>
                isPhysicalTarget(p, t.id, env),
              )
        if (physicalInPlay) {
          externalPossible = true
          break
        }
      }
    }

    // Start the Vite dev server FIRST — an app/config problem shows up here, before the dev
    // has to pick a device. Bind for the LAN when external is even possible; a
    // simulator/emulator-only run stays on localhost.
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
          onLine: (l) => onDevLine?.(l),
        })
        // Native only: stabilize the server (dep re-optimize + its full-reload) BEFORE
        // launching the WebViews. iOS WKWebView won't survive that reload if it attaches
        // mid-optimize — it drops the HMR socket for good. Web reconnects fine, so skip.
        if (!webOnly) {
          report(`${devServer.localUrl} · warming`)
          const stable = await warmDevServer(devServer.localUrl, {
            onLine: (l) => onDevLine?.(l),
          })
          // Fail SAFE: if the detected URL never serves the app, something else holds
          // the port (a stray `adaptv dev`/`pnpm dev`, or another server on the same
          // port). Don't point the native apps at a stranger — abort with a clear fix.
          if (!stable) {
            throw new Error(
              `dev server at ${devServer.localUrl} isn't responding — another process ` +
                "is likely using that port. Stop it, or run on a free port: " +
                "`adaptv dev … -- --port <n>`.",
            )
          }
        }
        //no detail: the addresses are rendered as their own aligned block under this row.
        return ""
      },
      { verbose },
    )
    addresses({
      local: devServer.localUrl,
      network: devServer.networkUrl,
    })

    // Now resolve the device — AFTER the server is confirmed up, so the picker never appears
    // for a run that was going to fail at the dev server anyway.
    const targets = {}
    for (const p of ready) {
      targets[p] = await resolveTarget(appRoot, p, envFor(p), {
        target: opts.target,
        latest: opts.latest,
      })
    }

    // `capacitor.config`'s `server.url` is a single value shared by every attached platform,
    // so the mode is per-RUN: external (the machine's LAN IP) if the PICKED device is
    // physical or --host forced it, else localhost (sim shares loopback; emulator uses
    // `adb reverse`). Vite is already bound for the LAN if it was possible, so only the URL
    // is decided here.
    const anyPhysical =
      !webOnly &&
      ready.some((p) => isPhysicalTarget(p, targets[p].id, envFor(p)))
    const external = !!forcedHost || anyPhysical
    // The Android emulator can't reach a LAN IP (its NAT can't route back to the host's own
    // LAN address), so it's fundamentally incompatible with external mode.
    if (
      external &&
      ready.includes("android") &&
      !isPhysicalTarget("android", targets.android.id, envFor("android"))
    ) {
      throw new Error(
        "the Android emulator can't reach an external dev server (its NAT can't route to your LAN IP). " +
          "Use a physical Android device, or run android without `--host` (and not alongside a physical iOS device).",
      )
    }
    let lanHost = null
    if (external) {
      lanHost = typeof forcedHost === "string" ? forcedHost : lanIp()
      if (!lanHost) {
        throw new Error(
          "couldn't detect a LAN IP for external mode — pass one explicitly: " +
            "`adaptv dev … --host <ip>` (find it with `ipconfig getifaddr en0`).",
        )
      }
    }
    const port = devServer.port
    const url = external
      ? `http://${lanHost}:${port}`
      : `http://localhost:${port}`
    // The dev-server line shows localhost (the binding); a physical device actually loads
    // over the LAN, so surface that address once — it's the only place it appears now.
    if (external) log.info(`device loads from ${c.bold(url)}`)
    // Vite reports a Network address only when it actually bound one (external mode). Show
    // it when it exists and stay silent otherwise — printing an address that nothing serves
    // is the same lie as offering a key that does nothing.
    if (devServer?.networkUrl) detail(`network  ${devServer.networkUrl}`)
    // Record the bound port + url in the lock, so a second `dev` (or a `preview`/`build`)
    // can name exactly what's holding the port in its refusal message.
    updateDevLock(appRoot, { port, url })

    if (!webOnly) {
      // point the native projects at the dev server, and remember how to undo it.
      cleanups.push(patchServerUrl(appRoot, url))
      // Generate the offline screen into the web dir BEFORE sync so `cap sync` copies it
      // into each platform's public/. Capacitor's `server.errorPath` (set above) loads
      // it locally when the dev server is unreachable, instead of a black WebView.
      cleanups.push(installOfflinePage(appRoot, { url }))
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
      // dev shares the `.dev` install identity with `preview` (separate icon + storage
      // sandbox, coexists with a release build). Patch it AFTER the dev server's own
      // capacitor.config.json stamp (which writes the base id), and before sync/build reads
      // the native project. Idempotent, so a first-run `cap add` created with the base id is
      // corrected here too.
      for (const p of ready) {
        patchNativeIdentity(appRoot, config, p, { dev: true })
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
          isAppInstalled(appRoot, platform, target.id, env)

        if (cached) {
          // Android emulator first needs the localhost route back to the host — no `cap
          // run` will set it. In external mode a physical device reaches the LAN IP
          // directly, so there's no `adb reverse` to (re-)assert.
          if (platform === "android" && !external) {
            report("linking server")
            cleanups.push(androidReverse(port, env))
          }
          report("launching device")
          if (launchInstalledApp(appRoot, platform, target.id, env)) {
            foregroundDevice(platform, target.id, env)
            launched.add(platform)
            return `${target.name} · cached`
          }
          // couldn't launch it after all — fall through and rebuild.
        }

        report("sync")
        await capSync(appRoot, platform, env, {
          report,
          plugins: config?.plugins,
        })
        // Was the app already up? If so, it survives the build (capRun no longer kills it)
        // and only cap run's re-front touched it, so we relaunch the fresh install once.
        const wasRunning = isAppRunning(appRoot, platform, target.id, env)
        report("launching device")
        await capRun(appRoot, platform, target.id, env, { report })
        if (platform === "android" && !external) {
          // `cap run` resets the emulator's `adb reverse` while installing/launching,
          // so the app it just launched has no route to the dev server (black WebView,
          // no JS to recover). Re-assert the reverse AFTER cap run, then relaunch the
          // app so its WebView loads with a working route. External mode reaches the LAN IP
          // directly (no reverse), so none of this applies.
          report("linking server")
          cleanups.push(androidReverse(port, env))
          relaunchAndroidApp(appRoot, env, target.id)
        } else if (platform === "ios" && wasRunning) {
          // The old process kept running through the build; load the fresh install now
          // (one relaunch, at the end — not a kill-then-wait-15s at the start).
          launchInstalledApp(appRoot, platform, target.id, env, {
            restart: true,
          })
        }
        foregroundDevice(platform, target.id, env)
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
      // A replay (`b`) passes none — that work isn't repeated, so it mustn't be re-billed.
      launchAll = async ({ force, offsets = {} } = {}) => {
        // One lane per platform for ANY count — same as `build`/`preview`. Rendering one
        // platform through a different call than two is how the two shapes drift apart.
        // Each lane carries its own outcome (explain → the inline reason + hint), so a
        // failure needs nothing printed after the lanes settle.
        await runLanes(
          ready.map((p) => ({
            label: p,
            run: (r) => launchOne(p, r, { force }),
            idle: "building app",
            offsetMs: offsets[p] ?? 0,
            explain: explainFailure(p),
          })),
          { verbose },
        )
      }
      await launchAll({ force: opts.force, offsets: prepareMs })
      nativeFp = snapshotNativeFp(appRoot, ready)

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

    // watch: a single live line (✓ turns to a spinner on HMR), no raw vite logs.
    spacer()
    watcher = liveWatcher({ keys: !webOnly })

    // `b` reinstalls on demand — always, not only after a change is detected. A device
    // in a state you don't trust is reason enough, and having to kill the run to get a
    // clean install is exactly the friction this removes. `r` is the cheap sibling: it
    // just reloads the running app's JS (no reinstall).
    let rebuilding = false
    let reloading = false
    const rebuild = async () => {
      if (rebuilding || reloading || webOnly || !launchAll) return
      rebuilding = true
      watcher.stop() // clears the watch row; cursor stays on it
      // Walk back over the blank separator + one row per platform so the SETTLED
      // platform lines animate again in place, rather than a second copy appearing
      // below them. Off a TTY there's no cursor to move, so just append.
      if (!rewindLines(1 + ready.length)) spacer()
      await launchAll({ force: true })
      nativeFp = snapshotNativeFp(appRoot, ready)
      spacer()
      watcher = liveWatcher({ keys: !webOnly }) // fresh line, which also clears any pending notice
      rebuilding = false
    }

    // `r` = reload: relaunch the installed app so its WebView reconnects to the dev
    // server. Instant next to a native rebuild (no sync/gradle/xcode), and the fix for a
    // wedged JS bundle — a fresh document from the dev server, no reinstall. Distinct from
    // `R`, which reinstalls the binary for a genuine native change.
    const reloadOne = (platform, report) => {
      const target = targets[platform]
      report("reloading device")
      const ok = launchInstalledApp(
        appRoot,
        platform,
        target.id,
        envFor(platform),
        { restart: true },
      )
      if (!ok)
        throw new Error(
          "couldn't relaunch the app — is it still installed? press b to rebuild.",
        )
      foregroundDevice(platform, target.id, envFor(platform))
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
      watcher = liveWatcher({ keys: !webOnly })
      reloading = false
    }
    cleanups.push(
      onKeys({ onReload: reload, onRebuild: rebuild, onQuit: onSigint }),
    )

    // Native changes can't hot-reload: a new plugin, an edited Info.plist or
    // AndroidManifest, or hand-written Swift/Kotlin all live in the BINARY, so the
    // running app simply won't have them. Left undetected the symptom is a bridge call
    // that fails with no explanation. Poll the same fingerprint the run cache uses (it
    // already covers config, deps and native sources) and surface it — but never rebuild
    // behind the dev's back: a reinstall costs ~15s and drops app state, so it's their call.
    if (!webOnly && ready.length > 0) {
      const poll = setInterval(() => {
        if (rebuilding || reloading) return
        const now = snapshotNativeFp(appRoot, ready)
        const changed = ready.filter((p) => now[p] !== nativeFp?.[p])
        if (changed.length === 0) return
        nativeFp = now // re-arm, so one edit notices once
        watcher.notice(`native change · ${changed.join(", ")}`)
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

/** Shared orchestration for `build` (static artifacts). */
async function pipeline(kind, appRoot, platforms, opts) {
  // kind is "preview" (static build → install → launch) or "build" (produce artifacts).
  const verb = kind
  const single = platforms.length === 1
  header(`${verb} ${single ? platforms[0] : "all"}`)

  // A live `dev` run owns capacitor.config.json (its server.url etc.); regenerating it
  // here would break that run. Refuse until it's stopped.
  assertNoActiveDevLock(appRoot, kind)

  const t0 = Date.now()
  // A config problem is a plain user error — clean one-liner, not a "run failed" report.
  let config
  try {
    config = await loadConfig(appRoot)
  } catch (err) {
    log.error(err.message)
    process.exit(1)
  }
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
    } else spacer()
  }

  // build fingerprint cache — skip the web build + sync when nothing that affects the
  // bundle changed. `--force` (or a missing dist) always rebuilds.
  const buildCache = readBuildState(appRoot)
  const distReady = existsSync(
    path.join(appRoot, CAP_WEB_DIR, "index.html"),
  )
  let fp = fingerprint(appRoot)

  // 1. barrier: build the SPA once (shared by every platform). If it fails, abort —
  //    never fall through and ship a stale bundle. A CACHED build is SILENT — like `dev`
  //    never prints the web bundle build when it's already there — so the asset/config
  //    warnings from prepare stay the first thing under the header, not a cache line on top.
  if (opts.force || !distReady || buildCache.web !== fp) {
    try {
      await runLine("web build", (r) => buildWeb(appRoot, { report: r }), {
        verbose,
        explain: explainFailure("web build"),
      })
    } catch {
      // the ✖ web build line already states why; the footer just says nothing shipped.
      return finish(
        c.red("✖ web build failed — nothing was rebuilt or launched"),
      )
    }
    // re-fingerprint after the build (it stamps a few files) and remember it.
    fp = fingerprint(appRoot)
    buildCache.web = fp
    buildCache.sync = {} // a new bundle invalidates every platform's sync
    writeBuildState(appRoot, buildCache)
  }

  // 2. prepare native projects — must precede device listing (`cap run --list`
  //    refuses until the platform exists) and sync.
  const prepared = new Set()
  const prepareOne = async (platform, report) => {
    await capAddIfMissing(appRoot, platform, envFor(platform), {
      report,
      plugins: config?.plugins,
    })
    // `preview` shares the `.dev` install identity with `dev` (own icon + storage sandbox,
    // coexists with a release build); `build` uses the release id. Patch after the web
    // build's capacitor.config.json stamp, before sync. Idempotent → also flips a project
    // back to the release id when this is a `build`.
    patchNativeIdentity(appRoot, config, platform, {
      dev: kind === "preview",
    })
    const res = await generateAssets(appRoot, config, [platform], {
      report,
    })
    //NOT platform-prefixed: an icon/splash source is an app-level fact, identical for
    //every platform. Prefixing it made `all` print the same sentence once per
    //platform, as if two different things were wrong.
    warnings.push(...res.warnings)
    // The iOS Info.plist is patched in place by `dev` and never regenerated, so a run
    // killed without teardown can leave an ATS exception in it. Strip ours before it
    // gets packaged; only warn about one we didn't add.
    if (platform === "ios") {
      const ats = healDevAtsLeftover(appRoot)
      if (ats.healed) {
        // A note, NOT a warning: this is adaptv's own leftover and adaptv just removed it.
        // Nothing is wrong and there is nothing for the dev to do, so it doesn't get a `!`.
        warnings.push({
          note: "ios: cleaned up a dev ATS exception left by an interrupted `adaptv dev`.",
        })
      } else if (ats.warn) {
        warnings.push(
          "ios: Info.plist declares NSAppTransportSecurity and adaptv did not add it — leaving it alone. If that's an NSAllowsArbitraryLoads left over from an older dev run, remove it before submitting to App Review.",
        )
      }
    }
    prepared.add(platform)
  }
  // Scaffolding is the first thing a platform does, NOT a step of its own — so on a first
  // run (`cap add` + CocoaPods is slow and worth watching) it renders on a TRANSIENT line
  // under the platform's OWN label, erased rather than settled, and the time it took is
  // folded into that platform's real line below (`prepareMs` → `offsetMs`). On later runs
  // it's a sub-10ms no-op with no line at all. Sequential (like `dev`): first-run prepares
  // are rare, so it costs nothing, and it keeps asset/config warnings in order instead of
  // interleaved under live lanes.
  const prepareMs = {}
  for (const platform of platforms) {
    const fresh = !existsSync(nativeDir(appRoot, platform))
    const startedAt = Date.now()
    try {
      if (fresh) {
        await runLine(platform, (r) => prepareOne(platform, r), {
          verbose,
          transient: true,
        })
      } else {
        await prepareOne(platform, () => {})
      }
    } catch (err) {
      // The transient line was erased and this platform never reaches the sync/package
      // lanes, so its ONE line is printed here — same shape as a settled ✖.
      const { reason, detail } = explainFailure(platform)(err)
      fail(platform, `native project — ${reason}`, detail)
    }
    prepareMs[platform] = Date.now() - startedAt
  }
  // surface asset/config warnings right after prepare (where they arise), not at the end.
  flushWarnings()

  const ready = platforms.filter((p) => prepared.has(p))
  if (ready.length === 0)
    return finish(c.red("✖ could not prepare any platform"))

  // 3. resolve device targets (run only) — sequential prompts, up front, so the
  //    parallel launch phase never has two pickers competing for the terminal.
  if (kind === "preview") {
    for (const p of ready) {
      ctx.targets[p] = await resolveTarget(appRoot, p, envFor(p), {
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
      isAppInstalled(appRoot, platform, target.id, env)
    if (cached) {
      // Nothing to rebuild — but RELAUNCH (restart), never just foreground: a stale run
      // (e.g. a prior `dev` session's offline screen) must not linger on screen.
      report("relaunching device")
      launchInstalledApp(appRoot, platform, target.id, env, {
        restart: true,
      })
      foregroundDevice(platform, target.id, env)
      done[platform] = `launched on ${target.name}`
      return `${target.name} · cached`
    }
    report("launching device")
    // `cap run` installs + activates, but only FOREGROUNDS an already-running app — its old
    // WebView (e.g. the dev offline screen) would stay. Restart it after the build so the
    // freshly-installed bundle is what's shown.
    const wasRunning = isAppRunning(appRoot, platform, target.id, env)
    await capRun(appRoot, platform, target.id, env, { report })
    if (wasRunning) {
      launchInstalledApp(appRoot, platform, target.id, env, {
        restart: true,
      })
    }
    foregroundDevice(platform, target.id, env)
    buildCache.run[key] = { id: runIdOf(platform) }
    done[platform] = `launched on ${target.name}`
    return target.name
  }

  const tailOne = async (platform, report) => {
    if (syncNeeded(platform)) {
      report("sync")
      await capSync(appRoot, platform, envFor(platform), {
        report,
        plugins: config?.plugins,
      })
      buildCache.sync[platform] = syncTag
    } else {
      report("sync · cached")
    }
    if (kind === "preview") {
      return previewLaunch(platform, ctx.targets[platform], report)
    }
    report("package")
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
      idle: "building app",
      offsetMs: prepareMs[p] ?? 0,
      explain: explainFailure(p),
    })),
    { verbose },
  )
  writeBuildState(appRoot, buildCache)

  const ok = platforms.every((p) => p in done)
  // On success the label reads like `dev`'s "watching": a green ✓ + bold white word, not an
  // all-green phrase. Failure stays red.
  // Which platform failed and why is already on that platform's own line, so the footer
  // states only the command's outcome — `✖ build failed`, not a second inventory of it.
  finish(
    ok
      ? `${c.green("✓")} ${c.bold(kind === "preview" ? "launched" : "artifacts ready")}`
      : c.red(`✖ ${verb} failed`),
  )
}

/* =============================================================================
 * doctor
 * ============================================================================= */

const ADAPTV_BASE_PLUGINS = [
  "@capacitor/app",
  "@capacitor/browser",
  "@capacitor/core",
  "@capacitor/geolocation",
  "@capacitor/haptics",
  "@capacitor/keyboard",
  "@capacitor/network",
  "@capacitor/preferences",
  "@capacitor/screen-orientation",
  "@capacitor/splash-screen",
  "@capacitor/status-bar",
]

function checkTool(label, argv, { optional = false } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" })
  const found = r.status === 0
  const detail = found
    ? (r.stdout || r.stderr || "").trim().split("\n")[0]
    : ""
  check(found, label, detail, { optional })
  return found
}

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p)) ?? null
}

function readIf(p) {
  return existsSync(p) ? readFileSync(p, "utf8") : undefined
}

function checkAppPlugins(_appRoot) {
  // adaptv OWNS the Capacitor plugins — they're its own dependencies, resolved from
  // the framework, never added to the consumer's app. So verify adaptv's install, not
  // the app's package.json.
  const resolveFromAdaptv = createRequire(
    path.join(ADAPTV_ROOT, "package.json"),
  )
  const missing = []
  for (const name of ADAPTV_BASE_PLUGINS) {
    let present = true
    try {
      resolveFromAdaptv.resolve(`${name}/package.json`)
    } catch {
      present = false
    }
    check(present, name)
    if (!present) missing.push(name)
  }
  if (missing.length) {
    log.warn(
      `${missing.length} plugin(s) missing from adaptv's install — reinstall with \`pnpm install\``,
    )
  }
}

/** Project-level checks (the silent failures), from src/native/doctor.ts. */
async function runProjectChecks(appRoot) {
  section("Project checks")
  const { runDoctor, formatDiagnostics } =
    await loadAdaptvModule("native/doctor.ts")
  let deps = []
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(appRoot, "package.json"), "utf8"),
    )
    deps = [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
    ]
  } catch {}
  const ios = nativeDir(appRoot, "ios")
  const android = nativeDir(appRoot, "android")
  const diagnostics = runDoctor({
    iosInfoPlist: readIf(path.join(ios, "App/App/Info.plist")),
    capacitorConfig: process.env.ADAPTV_CAPACITOR_CONFIG ?? undefined,
    androidBuildGradle: readIf(path.join(android, "app/build.gradle")),
    hasPrivacyManifest: existsSync(
      path.join(ios, "App/App/PrivacyInfo.xcprivacy"),
    ),
    dependencies: deps,
  })
  if (diagnostics.length === 0) {
    check(true, "no issues found")
  } else {
    for (const l of formatDiagnostics(diagnostics).split("\n")) detail(l)
  }
}

async function doctor(appRoot) {
  //the SAME banner every other command prints — `doctor` had its own
  header("doctor")
  log.info("toolchain for building native iOS / Android from this app")

  section("Core")
  checkTool("node", ["node", "--version"])
  const { cmd, pre } = capCmd(appRoot)
  checkTool("capacitor cli", [cmd, ...pre, "--version"])

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

  section("Plugins (shipped by adaptv — the consumer installs none)")
  checkAppPlugins(appRoot)

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
  check(
    existsSync(path.join(appRoot, "assets/logo.png")),
    "assets/logo.png (launcher-icon source)",
    "",
    { optional: true },
  )
  await runProjectChecks(appRoot)
  //no "doctor complete" footer: every row above already reported itself (R18).
  spacer()
}

/* =============================================================================
 * dispatch
 * ============================================================================= */

function usage() {
  helpText(`${c.bold("adaptv")} — native (Capacitor) lifecycle for a adaptv app

${c.bold("Usage")}
  adaptv dev     <web|ios|android|all>  [--target <id>] [--latest] [--host [ip]] [--force] [--verbose] [-- <vite args>]
  adaptv preview <web|ios|android|all>  [--target <id>] [--latest] [--force] [--verbose]
  adaptv build   <ios|android|all>      [--output <path>] [--verbose] [--force]
  adaptv doctor

${c.dim("dev = live reload: one Vite dev server, web + native WebViews all attached,")}
${c.dim("hot-reloading on every save (Ctrl-C to stop). Args after `--` go to vite, e.g.")}
${c.dim("`adaptv dev all -- --port 4000`.")}
${c.dim("preview = static build installed & launched on a device/simulator (no live reload).")}
${c.dim("build = static artifacts: an UNSIGNED .ipa and a debug .apk, both built by adaptv.")}
${c.dim("Signing is the one thing adaptv can't do for you — for TestFlight/App Store, open")}
${c.dim(".adaptv/ios/App/App.xcworkspace and use Xcode ▸ Product ▸ Archive.")}
${c.dim("--latest reuses the last device you picked. dev/preview skip the rebuild and just")}
${c.dim("relaunch when nothing native changed; --force reinstalls anyway.")}
${c.dim("Physical devices just work — plug one in and pick it (adaptv serves on your LAN IP")}
${c.dim("automatically). --host <ip> only overrides that IP if detection guesses wrong (VPN /")}
${c.dim("multiple adapters). Native projects live in .adaptv/. Toolchain env auto-resolved.")}`)
}

function parseFlags(argv) {
  const flags = {}
  const rest = []
  let passthrough = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // a lone `--` ends adaptv's flags; the rest is forwarded to vite (dev server).
    if (a === "--") {
      passthrough = argv.slice(i + 1)
      break
    }
    if (a === "--target") flags.target = argv[++i]
    else if (a === "--output" || a === "-o") flags.output = argv[++i]
    else if (a === "--host") {
      // `--host` forces external (LAN) mode; an optional IP pins the interface
      // (`--host 192.168.1.50`) for the multi-NIC / VPN case where detection guesses wrong.
      const next = argv[i + 1]
      if (next && /^\d{1,3}(\.\d{1,3}){3}$/.test(next))
        flags.host = argv[++i]
      else flags.host = true
    } else if (a.startsWith("--")) flags[a.slice(2)] = true
    else rest.push(a)
  }
  flags.viteArgs = passthrough
  return { flags, rest }
}

/** Expand a `run`/`build` platform arg (`ios` | `android` | `all`) to a list. */
function targetsFor(arg) {
  if (arg === "all") return ["ios", "android"]
  if (arg === "ios" || arg === "android") return [arg]
  return null
}

/**
 * `adaptv preview web` — the app's real web build, served locally.
 *
 * The web counterpart of `preview ios|android`: what a user would actually get, rather than
 * the dev server. Wrapped by adaptv (instead of leaving the dev to remember `vite build &&
 * vite preview`) so every target is reached the same way and the web build goes through the
 * same adaptv plugin pipeline — SSR/SPA choice, manifest, service worker — that a deploy does.
 * Deliberately NOT `ADAPTV_TARGET=capacitor`: this is the web lineage (LIFECYCLE §0, L14).
 */
/**
 * `preview web` — the real web build, served the way a user gets it, held until Ctrl-C.
 *
 * ONE line for the target (R1): the build and the server both render on it and vanish, and it
 * settles into the address block. It used to print `✓ web build` + `✓ server <url>` and then
 * hand-roll its own `ctrl-c stop` — a dim, unspaced copy of the row `dev` gets from
 * `liveWatcher()`, which is exactly the drift that comes from a command drawing its own
 * output instead of asking the renderer for it.
 *
 * `header: false` when `preview all` runs this after the native targets — one banner per
 * command, not one per surface.
 */
async function previewWeb(appRoot, opts) {
  if (opts.header !== false) header("preview web")
  const verbose = !!opts.verbose
  const viteBin = localBin(appRoot, "vite")
  const spawnVite = (args, extra) =>
    viteBin
      ? [viteBin, args, extra]
      : ["npx", ["--yes", "vite", ...args], extra]

  let child = null
  const found = { local: "", network: "" }
  try {
    await runLine(
      "web",
      async (report) => {
        report("building app")
        const [bcmd, bargs] = spawnVite(["build"])
        await exec(bcmd, bargs, {
          cwd: appRoot,
          env: process.env,
          onLine: (l) => report(l),
        })
        // `vite preview` is long-running: wait for it to announce an address, then let this
        // line settle and hand the terminal to the watcher.
        report("starting server")
        const [cmd, args] = spawnVite([
          "preview",
          ...(opts.viteArgs ?? []),
        ])
        child = spawn(cmd, args, {
          cwd: appRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"],
        })
        const seen = []
        await new Promise((resolve, reject) => {
          const onData = (buf) => {
            const text = String(buf)
            if (verbose) rawOut(text)
            for (const l of text.split("\n")) if (l.trim()) seen.push(l)
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
            const busy = seen.join("\n").match(/EADDRINUSE[^\n]*?:(\d+)/)
            reject(
              Object.assign(
                new Error(
                  busy
                    ? `port ${busy[1]} is already in use — stop what's holding it, or pick another: \`adaptv preview web -- --port <n>\``
                    : `the preview server stopped${code ? ` (exit ${code})` : ""}`,
                ),
                { tail: busy ? [] : errorTail(seen, 6) },
              ),
            )
          })
        })
        //the addresses are their own block under this row
        return ""
      },
      { verbose },
    )
  } catch {
    //`runLine` already rendered the ✖ with the reason — just stop.
    process.exit(1)
  }

  addresses(found)
  spacer()
  //The SAME watcher row `dev` uses — bold key, its own line — rather than a second copy of
  //the idea. `keys: false` because there is nothing to reload or rebuild from here (R17).
  const watcher = liveWatcher({ keys: false })

  const stop = () => {
    watcher.stop()
    try {
      child?.kill("SIGINT")
    } catch {}
  }
  process.on("SIGINT", () => {
    stop()
    process.exit(0)
  })
  process.on("SIGTERM", () => {
    stop()
    process.exit(0)
  })
  await new Promise((resolve) => {
    child?.on("close", (code) => {
      stop()
      if (code && code !== 0) {
        fail("web", `preview server exited with code ${code}`)
        process.exit(1)
      }
      resolve()
    })
  })
}

async function main() {
  const [command, ...raw] = process.argv.slice(2)
  const { flags, rest } = parseFlags(raw)
  const appRoot = CWD

  switch (command) {
    case "doctor":
      return await doctor(appRoot)

    case "dev": {
      // `dev` is the live-reload command: one Vite dev server, web + native
      // WebViews all pointed at it. `web` = the dev server alone (no native).
      const platforms = rest[0] === "web" ? [] : targetsFor(rest[0])
      if (platforms === null) {
        throw new Error(
          `unknown dev target "${rest[0] ?? ""}" — expected web, ios, android, or all.`,
        )
      }
      if (platforms.length > 1 && flags.target) {
        throw new Error(
          "--target can't be used with `dev all` (it's per-platform). Use --latest, or dev each platform.",
        )
      }
      return runLive(appRoot, platforms, {
        target: flags.target,
        latest: !!flags.latest,
        verbose: !!flags.verbose,
        force: !!flags.force,
        viteArgs: flags.viteArgs,
        host: flags.host, // true | "<ip>" | undefined — external (LAN) mode
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
      const platforms = targetsFor(rest[0])
      if (!platforms) {
        throw new Error(
          `unknown preview target "${rest[0] ?? ""}" — expected web, ios, android, or all.`,
        )
      }
      if (platforms.length > 1 && flags.target) {
        throw new Error(
          "--target can't be used with `preview all` (it's per-platform). Use --latest, or preview each platform.",
        )
      }
      // `all` means every surface a user could get the app on, WEB INCLUDED — the native
      // targets install and exit, then the web build is served and held until Ctrl-C. It
      // used to mean "every NATIVE target", so `preview all` skipped the one surface you
      // can look at without a device, and the command exited with nothing still running.
      const opts = {
        target: flags.target,
        latest: !!flags.latest,
        verbose: !!flags.verbose,
        force: !!flags.force,
      }
      if (rest[0] === "all") {
        await pipeline("preview", appRoot, platforms, opts)
        return await previewWeb(appRoot, {
          verbose: !!flags.verbose,
          header: false, //one banner per command, not one per surface
        })
      }
      return pipeline("preview", appRoot, platforms, opts)
    }

    case "build": {
      const platforms = targetsFor(rest[0])
      if (!platforms) {
        throw new Error(
          `unknown build target "${rest[0] ?? ""}" — expected ios, android, or all.`,
        )
      }
      return pipeline("build", appRoot, platforms, {
        output: flags.output,
        verbose: !!flags.verbose,
        force: !!flags.force,
      })
    }

    case "run": {
      // Retired in favour of dev/preview — don't silently redefine it.
      const hint = rest[0] && rest[0] !== "web" ? rest[0] : "ios"
      throw new Error(
        `\`run\` was split into \`dev\` and \`preview\` — did you mean \`adaptv dev ${hint}\`? (live reload = dev; static build → install = preview)`,
      )
    }

    case undefined:
    case "help":
    case "--help":
    case "-h":
      return usage()

    default:
      log.error(`unknown command: ${command}`)
      spacer()
      usage()
      process.exit(1)
  }
}

main().catch((err) => {
  // Same rule at the top level: if a step already rendered this failure, exit quietly
  // rather than appending Node's raw message under the calm one.
  if (!wasReported(err)) {
    log.error(err?.message ?? String(err))
    if (err?.tail) detail(err.tail)
  }
  process.exit(1)
})
