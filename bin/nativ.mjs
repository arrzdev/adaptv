#!/usr/bin/env node
// The nativ CLI — owns the whole native (Capacitor) lifecycle so a consumer never
// touches Capacitor, the toolchain env, or the asset generator by hand:
//
//   nativ doctor                    check the local toolchain (JDK, Android SDK, Xcode, pod)
//   nativ run  web|ios|android|all  live-reload dev: one Vite dev server, web + native
//                                   WebViews all attached, hot-reloading on save
//   nativ build ios|android|all     static artifacts: build SPA → sync → package (.ipa/.apk)
//
//   run  flags: --target <id>   launch on a specific device/simulator id
//               --latest        reuse the last device picked for this platform
//               -- <vite args>  forwarded to the vite dev server (e.g. `-- --port 4000`)
//   build flags: --output <path> where to write the artifact (default: .nativ/)
//               --force         rebuild even if unchanged (web build + sync are cached)
//   both:        --verbose      show the full underlying tool logs (raw passthrough)
//
// Native projects live inside the hidden, git-ignored `.nativ/` dir (relocated from the
// app root). The CLI resolves ANDROID_HOME / JAVA_HOME / pod / LANG itself and invokes
// the local `cap` / `capacitor-assets` binaries directly, so it works from a bare shell.
import { spawnSync } from "node:child_process"
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"
import { build as esbuild } from "esbuild"
import {
  fingerprint,
  readCache as readBuildCache,
  writeCache as writeBuildCache,
} from "./lib/cache.mjs"
import { startDevServer } from "./lib/dev-server.mjs"
import { resolveTarget } from "./lib/devices.mjs"
import { exec } from "./lib/exec.mjs"
import {
  androidReverse,
  patchIosAts,
  patchServerUrl,
} from "./lib/live-reload.mjs"
import {
  buildWeb,
  CAP_WEB_DIR,
  capAddIfMissing,
  capCmd,
  capRun,
  capSync,
  generateAssets,
  iosEnv,
  NATIV_DIR,
  nativeDir,
  platformEnv,
} from "./lib/native.mjs"
import {
  c,
  footer,
  header,
  liveWatcher,
  log,
  runLanes,
  runLine,
  since,
  skip,
  tail,
} from "./lib/render.mjs"

const CWD = process.cwd()
//the framework package root — bin/ is directly under it. Lets the CLI load nativ's
//own pure modules (doctor, privacy-manifest) rather than duplicate them.
const NATIV_ROOT = fileURLToPath(new URL("..", import.meta.url))

/* =============================================================================
 * config loading (esbuild-bundled `nativ.config.ts`)
 * ============================================================================= */

async function loadConfig(appRoot) {
  const configPath = path.join(appRoot, "nativ.config.ts")
  if (!existsSync(configPath)) {
    throw new Error(
      `no nativ.config.ts in ${appRoot} — run from an app root.`,
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
  if (!source) throw new Error("failed to bundle nativ.config.ts")
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  const mod = await import(url)
  const config = mod.default
  if (!config?.appId) {
    throw new Error("nativ.config.ts needs an `appId` for native builds.")
  }
  return config
}

/**
 * Load a nativ source module (TS) and return its exports. Same esbuild trick as
 * loadConfig, so the CLI can call the framework's own pure functions (doctor,
 * privacy-manifest) instead of duplicating them here.
 */
async function loadNativModule(relFromSrc) {
  const abs = path.join(NATIV_ROOT, "src", relFromSrc)
  const result = await esbuild({
    entryPoints: [abs],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    alias: { "#nativ": path.join(NATIV_ROOT, "src") },
  })
  const source = result.outputFiles?.[0]?.text
  if (!source) throw new Error(`failed to bundle ${relFromSrc}`)
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  return import(url)
}

/* =============================================================================
 * run / build pipelines
 * ============================================================================= */

/** Log a failed step's message + captured tail (visible even without --verbose). */
function reportError(label, err) {
  log.error(`${label} failed — ${err?.message ?? String(err)}`)
  tail(err?.tail)
}

/** Assemble the platform artifact (.apk / .ipa) and place it at `output` or `.nativ/`. */
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
    report("assembling debug APK (gradle)")
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
    return dest
  }

  // iOS: unsigned .ipa via the app's build-ipa.sh (signing stays the user's).
  const script = path.join(appRoot, "scripts/build-ipa.sh")
  if (!existsSync(script)) {
    throw new Error(
      "scripts/build-ipa.sh not found (needed for the unsigned .ipa). Signed builds: Xcode ▸ Archive.",
    )
  }
  report("archiving unsigned .ipa")
  await exec("bash", [script], {
    cwd: appRoot,
    env,
    onLine: (l) => report(l),
  })
  const ipa = newestIpa(appRoot)
  if (!ipa)
    throw new Error("build-ipa.sh produced no .ipa I could locate.")
  const dest = resolveOutput(appRoot, output, `${name}.ipa`)
  if (path.resolve(ipa) !== path.resolve(dest)) copyFileSync(ipa, dest)
  return dest
}

/** Resolve where an artifact should land: a `--output` path/dir, or `.nativ/<default>`. */
function resolveOutput(appRoot, output, defaultName) {
  const base = path.join(appRoot, NATIV_DIR)
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

/** Find the most recently produced `.ipa` under the app (best-effort). */
function newestIpa(appRoot) {
  const roots = [
    appRoot,
    path.join(appRoot, NATIV_DIR),
    nativeDir(appRoot, "ios"),
    path.join(nativeDir(appRoot, "ios"), "App/build"),
  ]
  let best = null
  for (const root of roots) {
    if (!existsSync(root)) continue
    for (const entry of readdirSync(root)) {
      if (!entry.endsWith(".ipa")) continue
      const full = path.join(root, entry)
      const mtime = statSync(full).mtimeMs
      if (!best || mtime > best.mtime) best = { full, mtime }
    }
  }
  return best?.full ?? null
}

/**
 * `run` — the live-reload dev command. Starts ONE Vite dev server and points the web
 * + native WebViews at it, so an edit hot-reloads every surface. `platforms` is empty
 * for `run web` (dev server only). Runs until Ctrl-C, then reverts every change
 * (capacitor.config server block, the iOS ATS exception, the adb reverse) and stops
 * Vite. Static artifacts stay on `nativ build`.
 */
async function runLive(appRoot, platforms, opts) {
  const webOnly = platforms.length === 0
  const single = platforms.length === 1
  const t0 = Date.now()
  header(
    `run ${webOnly ? "web" : single ? platforms[0] : "all"}  ${c.dim("· live reload")}`,
  )

  const verbose = opts.verbose
  const cleanups = [] // revert fns, unwound LIFO on exit
  let devServer = null
  let onDevLine = null // set once we're watching; parses HMR events
  let watcher = null // the live "watching / hot-reload" status line
  let tearing = false

  const teardown = () => {
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
  }
  const onSigint = () => {
    if (tearing) return
    tearing = true
    line("")
    log.info("stopping — reverting live-reload config…")
    teardown()
    process.exit(0)
  }
  process.on("SIGINT", onSigint)

  const envs = {}
  const envFor = (p) => {
    if (!envs[p]) envs[p] = platformEnv(p)
    return envs[p]
  }

  try {
    const config = webOnly ? null : await loadConfig(appRoot)
    const warnings = []
    const prepared = new Set()

    if (!webOnly) {
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
        })
        const res = await generateAssets(appRoot, config, [platform], {
          report,
        })
        warnings.push(...res.warnings.map((w) => `${platform}: ${w}`))
        prepared.add(platform)
      }
      if (single) {
        try {
          await runLine(
            `prepare ${platforms[0]}`,
            (r) => prepareOne(platforms[0], r),
            { verbose },
          )
        } catch (err) {
          reportError(`prepare ${platforms[0]}`, err)
        }
      } else {
        const res = await runLanes(
          platforms.map((p) => ({
            label: `prepare ${p}`,
            run: (r) => prepareOne(p, r),
          })),
          { verbose },
        )
        res.forEach((r, i) => {
          if (!r.ok) reportError(`prepare ${platforms[i]}`, r.error)
        })
      }
      for (const w of warnings) log.warn(w)
    }

    const ready = platforms.filter((p) => prepared.has(p))
    if (!webOnly && ready.length === 0) {
      teardown()
      process.off("SIGINT", onSigint)
      footer(c.red("✖ could not prepare any platform"))
      process.exitCode = 1
      return
    }

    // resolve device targets (sequential pickers, up front).
    const targets = {}
    for (const p of ready) {
      targets[p] = await resolveTarget(appRoot, p, envFor(p), {
        target: opts.target,
        latest: opts.latest,
      })
    }

    // start the Vite dev server and detect the URL it bound.
    await runLine(
      "dev server",
      async (report) => {
        devServer = await startDevServer(appRoot, {
          args: opts.viteArgs,
          onLine: (l) => onDevLine?.(l),
        })
        report(devServer.localUrl)
        return devServer.localUrl
      },
      { verbose },
    )
    const url = devServer.localUrl
    const port = devServer.port

    if (!webOnly) {
      // point the native projects at the dev server, and remember how to undo it.
      cleanups.push(patchServerUrl(appRoot, url))
      if (ready.includes("ios")) {
        const revert = patchIosAts(appRoot)
        if (revert) cleanups.push(revert)
      }
      if (ready.includes("android")) {
        cleanups.push(androidReverse(port, envFor("android")))
      }

      // sync (copies the patched config) + launch each platform against the server.
      const launchOne = async (platform, report) => {
        report("sync")
        await capSync(appRoot, platform, envFor(platform), { report })
        const target = targets[platform]
        const tag = target.source === "latest" ? " · latest" : ""
        report(`launch → ${target.name}${tag}`)
        await capRun(appRoot, platform, target.id, envFor(platform), {
          report,
        })
        return `${target.name}${tag} · live`
      }
      if (single) {
        try {
          await runLine(platforms[0], (r) => launchOne(platforms[0], r), {
            verbose,
          })
        } catch (err) {
          reportError(platforms[0], err)
        }
      } else {
        const res = await runLanes(
          ready.map((p) => ({ label: p, run: (r) => launchOne(p, r) })),
          { verbose },
        )
        res.forEach((r, i) => {
          if (!r.ok) reportError(ready[i], r.error)
        })
      }
    }

    // watch: a single live line (spinner on HMR), not a stream of raw vite logs.
    line("")
    line(
      `  ${c.green("✓ live")}  ${c.dim(`ready in ${since(t0)} · ${url}`)}`,
    )
    watcher = liveWatcher()
    onDevLine = (l) => {
      if (verbose) {
        line(c.dim(`  vite │ ${l}`))
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
    reportError("run", err)
    teardown()
    process.exit(1)
  }
}

/** Shared orchestration for `build` (static artifacts). */
async function pipeline(kind, appRoot, platforms, opts) {
  const verb = kind === "run" ? "run" : "build"
  const single = platforms.length === 1
  header(`${verb} ${single ? platforms[0] : "all"}`)

  const t0 = Date.now()
  const config = await loadConfig(appRoot)
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

  // print any collected warnings, then clear them (so they surface once, near the
  // step that produced them — not dumped at the very end).
  const flushWarnings = () => {
    for (const w of warnings) log.warn(w)
    warnings.length = 0
  }

  const finish = (hint) => {
    flushWarnings()
    // per-platform outcome is on the step/lane lines; footer is just the total.
    footer(`${hint}  ${c.dim(`· ${since(t0)} total`)}`)
    if (!platforms.every((p) => p in done)) process.exitCode = 1
  }

  // build fingerprint cache — skip the web build + sync when nothing that affects the
  // bundle changed. `--force` (or a missing dist) always rebuilds.
  const buildCache = readBuildCache(appRoot)
  const distReady = existsSync(
    path.join(appRoot, CAP_WEB_DIR, "index.html"),
  )
  let fp = fingerprint(appRoot)

  // 1. barrier: build the SPA once (shared by every platform). If it fails, abort —
  //    never fall through and ship a stale bundle.
  if (!opts.force && distReady && buildCache.web === fp) {
    skip("web build")
  } else {
    try {
      await runLine("web build", (r) => buildWeb(appRoot, { report: r }), {
        verbose,
      })
    } catch (err) {
      reportError("web build", err)
      return finish(
        c.red("✖ web build failed — nothing was rebuilt or launched"),
      )
    }
    // re-fingerprint after the build (it stamps a few files) and remember it.
    fp = fingerprint(appRoot)
    buildCache.web = fp
    buildCache.sync = {} // a new bundle invalidates every platform's sync
    writeBuildCache(appRoot, buildCache)
  }

  // 2. prepare native projects — must precede device listing (`cap run --list`
  //    refuses until the platform exists) and sync.
  const prepared = new Set()
  const prepareOne = async (platform, report) => {
    await capAddIfMissing(appRoot, platform, envFor(platform), { report })
    const res = await generateAssets(appRoot, config, [platform], {
      report,
    })
    warnings.push(...res.warnings.map((w) => `${platform}: ${w}`))
    prepared.add(platform)
  }
  if (single) {
    try {
      await runLine(
        `prepare ${platforms[0]}`,
        (r) => prepareOne(platforms[0], r),
        { verbose },
      )
    } catch (err) {
      reportError(`prepare ${platforms[0]}`, err)
    }
  } else {
    const res = await runLanes(
      platforms.map((p) => ({
        label: `prepare ${p}`,
        run: (r) => prepareOne(p, r),
      })),
      { verbose },
    )
    res.forEach((r, i) => {
      if (!r.ok) reportError(`prepare ${platforms[i]}`, r.error)
    })
  }
  // surface asset/config warnings right after prepare (where they arise), not at the end.
  flushWarnings()

  const ready = platforms.filter((p) => prepared.has(p))
  if (ready.length === 0)
    return finish(c.red("✖ could not prepare any platform"))

  // 3. resolve device targets (run only) — sequential prompts, up front, so the
  //    parallel launch phase never has two pickers competing for the terminal.
  if (kind === "run") {
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
  const syncNeeded = (p) => opts.force || buildCache.sync[p] !== fp
  // the device's "· latest" tag rides on the launch label rather than its own line.
  const launchLabel = (t) =>
    `launch → ${t.name}${t.source === "latest" ? c.dim(" · latest") : ""}`

  const tailOne = async (platform, report) => {
    if (syncNeeded(platform)) {
      report("sync")
      await capSync(appRoot, platform, envFor(platform), { report })
      buildCache.sync[platform] = fp
    } else {
      report("sync · cached")
    }
    if (kind === "run") {
      const target = ctx.targets[platform]
      const tag = target.source === "latest" ? " · latest" : ""
      report(`launch → ${target.name}${tag}`)
      await capRun(appRoot, platform, target.id, envFor(platform), {
        report,
      })
      done[platform] = `launched on ${target.name}${tag}`
      return done[platform]
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

  if (single) {
    const p = ready[0]
    try {
      if (syncNeeded(p)) {
        await runLine(
          "sync",
          (r) => capSync(appRoot, p, envFor(p), { report: r }),
          { verbose },
        )
        buildCache.sync[p] = fp
      } else {
        skip("sync")
      }
      if (kind === "run") {
        const target = ctx.targets[p]
        await runLine(
          launchLabel(target),
          (r) => capRun(appRoot, p, target.id, envFor(p), { report: r }),
          { verbose },
        )
        done[p] = `launched on ${target.name}`
      } else {
        done[p] = await runLine(
          "package",
          (r) =>
            packageArtifact(appRoot, config, p, envFor(p), ctx.output, r),
          { verbose },
        )
      }
    } catch (err) {
      reportError(p, err)
    }
  } else {
    const res = await runLanes(
      ready.map((p) => ({ label: p, run: (r) => tailOne(p, r) })),
      { verbose },
    )
    res.forEach((r, i) => {
      if (!r.ok) reportError(ready[i], r.error)
    })
  }
  writeBuildCache(appRoot, buildCache)

  const ok = platforms.every((p) => p in done)
  finish(
    ok
      ? kind === "run"
        ? c.green("✓ launched")
        : c.green("✓ artifacts ready")
      : c.red("✖ one or more platforms failed"),
  )
}

/* =============================================================================
 * doctor
 * ============================================================================= */

const NATIV_BASE_PLUGINS = [
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

const line = (s = "") => process.stdout.write(`${s}\n`)

function checkTool(label, argv, { optional = false } = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: "utf8" })
  const found = r.status === 0
  const detail = found
    ? (r.stdout || r.stderr || "").trim().split("\n")[0]
    : ""
  line(
    `  ${found ? c.green("✔") : optional ? c.yellow("○") : c.red("✖")} ${label}${
      detail ? c.dim(`  ${detail}`) : ""
    }`,
  )
  return found
}

function firstExisting(paths) {
  return paths.find((p) => p && existsSync(p)) ?? null
}

function readIf(p) {
  return existsSync(p) ? readFileSync(p, "utf8") : undefined
}

function checkAppPlugins(appRoot) {
  const pkgPath = path.join(appRoot, "package.json")
  if (!existsSync(pkgPath)) {
    line(`  ${c.red("✖")} package.json not found`)
    return
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const missing = []
  for (const name of NATIV_BASE_PLUGINS) {
    const present = name in deps
    line(`  ${present ? c.green("✔") : c.red("✖")} ${name}`)
    if (!present) missing.push(name)
  }
  if (missing.length) {
    line(
      c.yellow(
        `\n  install the missing plugins so the native hooks work:`,
      ),
    )
    line(c.dim(`    pnpm --filter ${pkg.name} add ${missing.join(" ")}`))
  }
}

/** Project-level checks (the silent failures), from src/native/doctor.ts. */
async function runProjectChecks(appRoot) {
  line("\nProject checks")
  const { runDoctor, formatDiagnostics } =
    await loadNativModule("native/doctor.ts")
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
    capacitorConfig: readIf(path.join(appRoot, "capacitor.config.json")),
    androidBuildGradle: readIf(path.join(android, "app/build.gradle")),
    hasPrivacyManifest: existsSync(
      path.join(ios, "App/App/PrivacyInfo.xcprivacy"),
    ),
    dependencies: deps,
  })
  if (diagnostics.length === 0) {
    line(`  ${c.green("✔")} no issues found`)
  } else {
    for (const l of formatDiagnostics(diagnostics).split("\n"))
      line(`  ${l}`)
  }
}

async function doctor(appRoot) {
  line(`\n${c.bold(c.magenta(" nativ "))} ${c.bold("doctor")}`)
  line(
    c.dim("  toolchain for building native iOS / Android from this app\n"),
  )

  line("Core")
  checkTool("node", ["node", "--version"])
  const { cmd, pre } = capCmd(appRoot)
  checkTool("capacitor cli", [cmd, ...pre, "--version"])

  line("\nAndroid")
  const aEnv = { ...process.env }
  const androidHome =
    aEnv.ANDROID_HOME ??
    aEnv.ANDROID_SDK_ROOT ??
    path.join(homedir(), "Library/Android/sdk")
  line(
    `  ${existsSync(androidHome) ? c.green("✔") : c.red("✖")} Android SDK${c.dim(`  ${androidHome}`)}`,
  )
  const jbr = "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  const jdk = firstExisting([
    aEnv.JAVA_HOME && path.join(aEnv.JAVA_HOME, "bin/java"),
    path.join(jbr, "bin/java"),
  ])
  line(
    `  ${jdk ? c.green("✔") : c.red("✖")} JDK${jdk ? c.dim(`  ${path.dirname(path.dirname(jdk))}`) : c.dim("  install Android Studio or set JAVA_HOME")}`,
  )
  checkTool(
    "adb",
    [path.join(androidHome, "platform-tools/adb"), "version"],
    {
      optional: true,
    },
  )

  line("\niOS (macOS only)")
  checkTool("xcodebuild", ["xcodebuild", "-version"], { optional: true })
  const ie = iosEnv()
  checkTool("cocoapods (pod)", ["pod", "--version"], { optional: true }) ||
    checkTool(
      "cocoapods (pod, resolved)",
      ["bash", "-lc", `PATH="${ie.PATH}" pod --version`],
      { optional: true },
    )

  line("\nPlugins (installed in this app — Capacitor auto-discovers them)")
  checkAppPlugins(appRoot)

  line("\nProject")
  line(
    `  ${existsSync(nativeDir(appRoot, "android")) ? c.green("✔") : c.yellow("○")} ${NATIV_DIR}/android project`,
  )
  line(
    `  ${existsSync(nativeDir(appRoot, "ios")) ? c.green("✔") : c.yellow("○")} ${NATIV_DIR}/ios project`,
  )
  line(
    `  ${existsSync(path.join(appRoot, "assets/logo.png")) ? c.green("✔") : c.yellow("○")} assets/logo.png (launcher-icon source)`,
  )
  await runProjectChecks(appRoot)
  line(`\n${c.green("✔ doctor complete")}\n`)
}

/* =============================================================================
 * dispatch
 * ============================================================================= */

function usage() {
  line(`${c.bold("nativ")} — native (Capacitor) lifecycle for a nativ app

${c.bold("Usage")}
  nativ doctor
  nativ run   <web|ios|android|all>  [--target <id>] [--latest] [--verbose] [-- <vite args>]
  nativ build <ios|android|all>      [--output <path>] [--verbose] [--force]

${c.dim("run = live-reload dev: one Vite dev server, web + native WebViews all attached,")}
${c.dim("hot-reloading on every save (Ctrl-C to stop). Args after `--` go to vite, e.g.")}
${c.dim("`nativ run all -- --port 4000`. build = static .ipa/.apk artifacts.")}
${c.dim("--latest reuses the last device you picked. Native projects live in .nativ/")}
${c.dim("(git-ignored). Toolchain env (ANDROID_HOME / JAVA_HOME / pod / LANG) auto-resolved.")}`)
}

function parseFlags(argv) {
  const flags = {}
  const rest = []
  let passthrough = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    // a lone `--` ends nativ's flags; the rest is forwarded to vite (dev server).
    if (a === "--") {
      passthrough = argv.slice(i + 1)
      break
    }
    if (a === "--target") flags.target = argv[++i]
    else if (a === "--output" || a === "-o") flags.output = argv[++i]
    else if (a.startsWith("--")) flags[a.slice(2)] = true
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

async function main() {
  const [command, ...raw] = process.argv.slice(2)
  const { flags, rest } = parseFlags(raw)
  const appRoot = CWD

  switch (command) {
    case "doctor":
      return await doctor(appRoot)

    case "run": {
      // `run` is the live-reload dev command: one Vite dev server, web + native
      // WebViews all pointed at it. `web` = the dev server alone (no native).
      const platforms = rest[0] === "web" ? [] : targetsFor(rest[0])
      if (platforms === null) {
        throw new Error(
          `unknown run target "${rest[0] ?? ""}" — expected web, ios, android, or all.`,
        )
      }
      if (platforms.length > 1 && flags.target) {
        throw new Error(
          "--target can't be used with `run all` (it's per-platform). Use --latest, or run each platform.",
        )
      }
      return runLive(appRoot, platforms, {
        target: flags.target,
        latest: !!flags.latest,
        verbose: !!flags.verbose,
        viteArgs: flags.viteArgs,
      })
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

    case undefined:
    case "help":
    case "--help":
    case "-h":
      return usage()

    default:
      line(c.red(`unknown command: ${command}\n`))
      usage()
      process.exit(1)
  }
}

main().catch((err) => {
  log.error(err?.message ?? String(err))
  if (err?.tail) line(c.dim(err.tail))
  process.exit(1)
})
