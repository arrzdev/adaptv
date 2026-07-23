#!/usr/bin/env node
// The adaptv CLI — owns the whole native (Capacitor) lifecycle so a consumer never
// touches Capacitor, the toolchain env, or the asset generator by hand:
//
//   adaptv doctor                     check the local toolchain (JDK, Android SDK, Xcode, pod)
//   adaptv dev  web|ios|android|all   live reload: one Vite dev server, web + native
//                                    WebViews all attached, hot-reloading on save
//   adaptv preview ios|android|all    static build → install → launch on a device (no reload)
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
  nativeFingerprint,
  readCache as readBuildCache,
  writeCache as writeBuildCache,
} from "./lib/cache.mjs"
import { startDevServer, warmDevServer } from "./lib/dev-server.mjs"
import {
  cachedDevice,
  listTargets,
  resolveTarget,
} from "./lib/devices.mjs"
import { exec } from "./lib/exec.mjs"
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
  generateAssets,
  iosEnv,
  isAppInstalled,
  isPhysicalTarget,
  lanIp,
  launchInstalledApp,
  nativeDir,
  platformEnv,
  relaunchAndroidApp,
} from "./lib/native.mjs"
import { installOfflinePage } from "./lib/offline-page.mjs"
import {
  c,
  footer,
  header,
  liveWatcher,
  log,
  onKeys,
  rewindLines,
  runLanes,
  runLine,
  since,
  skip,
  tail,
} from "./lib/render.mjs"

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
    throw new Error("adaptv.config.ts needs an `appId` for native builds.")
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
 * Regenerate `capacitor.config.json` from `adaptv.config.ts`, from scratch, before any
 * command touches it.
 *
 * adaptv OWNS this file (it's stamped from adaptv.config.ts, the consumer never hand-writes
 * it) and it's git-ignored — so the only correct baseline is a fresh one. Regenerating
 * makes every command deterministic and, more importantly, makes stale dev state
 * impossible: `dev` mutates this file in place (`server.url`, `errorPath`,
 * `androidScheme`, splash auto-hide) and a run killed with SIGKILL can't revert. Without
 * this, the next `build` would happily package an app pointing at a dead dev server.
 *
 * The Capacitor CLI hard-requires the file in the directory it runs from — `loadConfig()`
 * reads `capacitor.config.{ts,js,json}` from `process.cwd()` and there is no `--config`
 * flag (`CAPACITOR_CONFIG` is an env var it EXPORTS to platform hooks, not an input) — so
 * it can't live in `.adaptv/` with everything else. Regenerating is the next best thing.
 * → config-artifact PR.
 */
async function regenerateCapacitorConfig(appRoot, config) {
  const { stampCapacitorConfig } = await loadAdaptvModule(
    "vite/capacitor-config.ts",
  )
  stampCapacitorConfig(config, appRoot)
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

/** Log a failed step's message + captured tail (visible even without --verbose). */
function reportError(label, err) {
  log.error(`${label} failed — ${err?.message ?? String(err)}`)
  tail(err?.tail)
}

/**
 * Explain a launch failure UNDER the `✖ <platform>` line that runLine already printed —
 * so there's exactly one ✖, no raw xcodebuild/gradle dump (that's what --verbose is for),
 * and a recognised cause (iOS signing, an unavailable device, Developer Mode off, …) reads
 * as an actionable hint. Unknown failures show just their first line.
 */
function reportLaunchError(platform, err) {
  const e = explainLaunchFailure(
    platform,
    `${err?.message ?? ""}\n${err?.tail ?? ""}`,
  )
  if (e) {
    line(`      ${e.msg}`)
    for (const step of e.fix) line(c.dim(`      ${step}`))
  } else {
    line(c.dim(`      ${(err?.message ?? String(err)).split("\n")[0]}`))
  }
}

/** Assemble the platform artifact (.apk / .ipa) and place it at `output` or `.adaptv/`. */
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

/** Find the most recently produced `.ipa` under the app (best-effort). */
function newestIpa(appRoot) {
  const roots = [
    appRoot,
    path.join(appRoot, ADAPTV_DIR),
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
 * `dev` — the live-reload command. Starts ONE Vite dev server and points the web
 * + native WebViews at it, so an edit hot-reloads every surface. `platforms` is empty
 * for `dev web` (dev server only). Runs until Ctrl-C, then reverts every change
 * (capacitor.config server block, the iOS ATS exception, the adb reverse) and stops
 * Vite. Static installs stay on `adaptv preview`; artifacts on `adaptv build`.
 */
async function runLive(appRoot, platforms, opts) {
  const webOnly = platforms.length === 0
  const single = platforms.length === 1
  const t0 = Date.now()
  header(
    `dev ${webOnly ? "web" : single ? platforms[0] : "all"}  ${c.dim("· live reload")}`,
  )

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
    line("")
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

  try {
    const config = webOnly ? null : await loadConfig(appRoot)
    const warnings = []
    const prepared = new Set()

    if (!webOnly) {
      // Fresh capacitor.config.json before anything reads or patches it, so a run
      // killed without teardown can never leave dev fields behind for the next command.
      await regenerateCapacitorConfig(appRoot, config)
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
      // Show a per-platform prepare step ONLY on a first run — when the native project
      // doesn't exist yet (`cap add` + CocoaPods is slow and worth watching). On later runs
      // prepare is a sub-10ms no-op, so do the work silently rather than print a
      // "✓ prepare 5ms" line that says nothing. (First-run prepares are rare, so doing them
      // sequentially instead of concurrently costs nothing in practice.)
      for (const platform of platforms) {
        const fresh = !existsSync(nativeDir(appRoot, platform))
        try {
          if (fresh) {
            await runLine(
              `prepare ${platform}`,
              (r) => prepareOne(platform, r),
              { verbose },
            )
          } else {
            await prepareOne(platform, () => {})
          }
        } catch (err) {
          reportError(`prepare ${platform}`, err)
        }
      }
      for (const w of warnings) log.warn(w)
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
      "dev server",
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
        return devServer.localUrl
      },
      { verbose },
    )

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
      // sync (copies the patched config) + launch each platform against the server.
      //
      // …unless nothing NATIVE changed. In live-reload the installed app is only a shell
      // pointing at the dev server, so when the native inputs and the dev URL are
      // unchanged AND the device confirms it's still installed, there is nothing to
      // rebuild: launch it and let it reconnect. That turns a ~15s build+install into a
      // ~1s launch, and drops Android from two relaunches to one (no `cap run` to reset
      // `adb reverse`). Every uncertainty falls through to the full path.
      const runCache = readBuildCache(appRoot)
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
            report("linking dev server")
            cleanups.push(androidReverse(port, env))
          }
          report(`launch → ${target.name} · cached`)
          if (launchInstalledApp(appRoot, platform, target.id, env)) {
            launched.add(platform)
            return `${target.name} · cached`
          }
          // couldn't launch it after all — fall through and rebuild.
        }

        report("sync")
        await capSync(appRoot, platform, env, { report })
        report(`launch → ${target.name}`)
        await capRun(appRoot, platform, target.id, env, { report })
        if (platform === "android" && !external) {
          // `cap run` resets the emulator's `adb reverse` while installing/launching,
          // so the app it just launched has no route to the dev server (black WebView,
          // no JS to recover). Re-assert the reverse AFTER cap run, then relaunch the
          // app so its WebView loads with a working route. Must be post-launch — doing
          // it before cap run is wiped by cap run itself. External mode reaches the LAN IP
          // directly (no reverse), so none of this applies.
          report("linking dev server")
          cleanups.push(androidReverse(port, env))
          relaunchAndroidApp(appRoot, env, target.id)
        }
        // Record AFTER the build: `cap sync` rewrites files in the native project, so a
        // fingerprint taken before it would never match on the next run.
        runCache.run[key] = {
          url,
          fp: nativeFingerprint(appRoot, platform),
        }
        writeBuildCache(appRoot, runCache)
        launched.add(platform)
        return `${target.name}`
      }
      // Hoisted so the `r` key can replay exactly the same launch lines mid-run.
      launchAll = async ({ force } = {}) => {
        if (single) {
          try {
            await runLine(
              platforms[0],
              (r) => launchOne(platforms[0], r, { force }),
              { verbose },
            )
          } catch (err) {
            reportLaunchError(platforms[0], err)
          }
          return
        }
        const res = await runLanes(
          ready.map((p) => ({
            label: p,
            run: (r) => launchOne(p, r, { force }),
          })),
          { verbose },
        )
        res.forEach((r, i) => {
          if (!r.ok) reportLaunchError(ready[i], r.error)
        })
      }
      await launchAll({ force: opts.force })
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
    line("")
    watcher = liveWatcher()

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
      if (!rewindLines(1 + ready.length)) line("")
      await launchAll({ force: true })
      nativeFp = snapshotNativeFp(appRoot, ready)
      line("")
      watcher = liveWatcher() // fresh line, which also clears any pending notice
      rebuilding = false
    }

    // `r` = reload: relaunch the installed app so its WebView reconnects to the dev
    // server. Instant next to a native rebuild (no sync/gradle/xcode), and the fix for a
    // wedged JS bundle — a fresh document from the dev server, no reinstall. Distinct from
    // `R`, which reinstalls the binary for a genuine native change.
    const reloadOne = (platform, report) => {
      const target = targets[platform]
      report(`reload → ${target.name}`)
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
      return `${target.name} · reloaded`
    }
    const reload = async () => {
      if (reloading || rebuilding || webOnly || ready.length === 0) return
      reloading = true
      watcher.stop()
      if (!rewindLines(1 + ready.length)) line("")
      if (single) {
        try {
          await runLine(ready[0], (r) => reloadOne(ready[0], r), {
            verbose,
          })
        } catch (err) {
          reportError(ready[0], err)
        }
      } else {
        const res = await runLanes(
          ready.map((p) => ({ label: p, run: (r) => reloadOne(p, r) })),
          { verbose },
        )
        res.forEach((r, i) => {
          if (!r.ok) reportError(ready[i], r.error)
        })
      }
      line("")
      watcher = liveWatcher()
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
  // kind is "preview" (static build → install → launch) or "build" (produce artifacts).
  const verb = kind
  const single = platforms.length === 1
  header(`${verb} ${single ? platforms[0] : "all"}`)

  // A live `dev` run owns capacitor.config.json (its server.url etc.); regenerating it
  // here would break that run. Refuse until it's stopped.
  assertNoActiveDevLock(appRoot, kind)

  const t0 = Date.now()
  const config = await loadConfig(appRoot)
  // Fresh capacitor.config.json FIRST — a release build must never inherit dev fields
  // (`server.url` etc.) left by a `dev` run that was killed before it could revert.
  await regenerateCapacitorConfig(appRoot, config)
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
    // The iOS Info.plist is patched in place by `dev` and never regenerated, so a run
    // killed without teardown can leave an ATS exception in it. Strip ours before it
    // gets packaged; only warn about one we didn't add.
    if (platform === "ios") {
      const ats = healDevAtsLeftover(appRoot)
      if (ats.healed) {
        warnings.push(
          "ios: removed a leftover dev ATS exception (NSAllowsArbitraryLoads) from Info.plist — a `adaptv dev` run must have been killed before it could revert.",
        )
      } else if (ats.warn) {
        warnings.push(
          "ios: Info.plist declares NSAppTransportSecurity and adaptv did not add it — leaving it alone. If that's an NSAllowsArbitraryLoads left over from an older dev run, remove it before submitting to App Review.",
        )
      }
    }
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
    if (kind === "preview") {
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
      if (kind === "preview") {
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
      ? kind === "preview"
        ? c.green("✓ launched")
        : c.green("✓ artifacts ready")
      : c.red("✖ one or more platforms failed"),
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
  for (const name of ADAPTV_BASE_PLUGINS) {
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
  line(`\n${c.bold(c.magenta(" adaptv "))} ${c.bold("doctor")}`)
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
    `  ${existsSync(nativeDir(appRoot, "android")) ? c.green("✔") : c.yellow("○")} ${ADAPTV_DIR}/android project`,
  )
  line(
    `  ${existsSync(nativeDir(appRoot, "ios")) ? c.green("✔") : c.yellow("○")} ${ADAPTV_DIR}/ios project`,
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
  line(`${c.bold("adaptv")} — native (Capacitor) lifecycle for a adaptv app

${c.bold("Usage")}
  adaptv dev     <web|ios|android|all>  [--target <id>] [--latest] [--host [ip]] [--force] [--verbose] [-- <vite args>]
  adaptv preview <ios|android|all>      [--target <id>] [--latest] [--force] [--verbose]
  adaptv build   <ios|android|all>      [--output <path>] [--verbose] [--force]
  adaptv doctor

${c.dim("dev = live reload: one Vite dev server, web + native WebViews all attached,")}
${c.dim("hot-reloading on every save (Ctrl-C to stop). Args after `--` go to vite, e.g.")}
${c.dim("`adaptv dev all -- --port 4000`.")}
${c.dim("preview = static build installed & launched on a device/simulator (no live reload).")}
${c.dim("build = static .ipa/.apk artifacts.")}
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
      // `preview` = static build → install → launch on a device (no live reload).
      // Native only; there's no `preview web` (that's plain `vite preview`, unwrapped).
      const platforms = targetsFor(rest[0])
      if (!platforms) {
        throw new Error(
          `unknown preview target "${rest[0] ?? ""}" — expected ios, android, or all.`,
        )
      }
      if (platforms.length > 1 && flags.target) {
        throw new Error(
          "--target can't be used with `preview all` (it's per-platform). Use --latest, or preview each platform.",
        )
      }
      return pipeline("preview", appRoot, platforms, {
        target: flags.target,
        latest: !!flags.latest,
        verbose: !!flags.verbose,
        force: !!flags.force,
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
