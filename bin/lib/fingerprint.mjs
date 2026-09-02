// Build fingerprints — let `run`/`build` skip the web build + sync when nothing that
// affects the bundle has changed, so a re-launch goes (almost) straight to the native
// build. → user ask: "if the web build didn't change, bypass steps, launch faster".
//
// The fingerprint is a hash of every app file's path + size + mtime (a superset of the
// SPA inputs). Over-inclusive on purpose: an unrelated edit just triggers a rebuild
// (safe), whereas a missed edit would launch stale code (never acceptable). `--force`
// bypasses it. This module only COMPUTES the hashes; what was last seen is remembered in
// the `build` section of `.adaptv/state.json` (see `state.mjs`).
import { createHash } from "node:crypto"
import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { ADAPTV_DIR } from "./adaptv-dir.mjs"

// Directories that never affect the built bundle (deps, outputs, VCS, caches, the
// native projects themselves). Skipped wholesale while walking.
const SKIP_DIRS = new Set([
  "node_modules",
  ADAPTV_DIR,
  "dist",
  //`.output/` is the SSR lineage's build, and the capacitor lineage never reads it (register
  //L14: two lineages that never cross) — so `build web` rewriting it must not rebuild native.
  ".output",
  "ios",
  "android",
  ".git",
  ".turbo",
  ".vite",
  ".tsbuild",
  "coverage",
  "DerivedData",
  "Pods",
  "build",
  ".idea",
  ".gradle",
])
// Generated files (not inputs) — excluding them keeps the fingerprint stable across
// builds that regenerate them.
const SKIP_FILES = new Set(["capacitor.config.json", ".DS_Store"])

/**
 * A hash of the app's source tree — path + size + **mtime** of every non-skipped file.
 *
 * Deliberately mtime-based, NOT content-based like `nativeFingerprint()`, and the two are
 * intentionally different for a reason: the native tree is re-stamped by `generateAssets`
 * every run (byte-identical files, fresh mtimes) so mtime there false-positives forever —
 * hence content. The web SOURCE tree has no such re-stamping: a file's mtime only moves
 * when it's genuinely edited, so mtime is both correct AND cheap here. Measured 2026-09-02
 * on the playground app (182 files / 3.5 MB): 1.7 ms median per walk, against ~4× that for
 * content over the same files — a cost that grows with the asset tree, for zero correctness
 * gain. So this stays mtime; the divergence is by design, not an oversight. Over-inclusive
 * either way: a false rebuild is free, a missed edit shipping stale code is not.
 */
export function fingerprint(appRoot) {
  const h = createHash("sha1")
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name))
      } else if (e.isFile() && !SKIP_FILES.has(e.name)) {
        try {
          const s = statSync(path.join(dir, e.name))
          h.update(
            `${path.relative(appRoot, path.join(dir, e.name))}:${s.size}:${Math.round(s.mtimeMs)}\n`,
          )
        } catch {}
      }
    }
  }
  walk(appRoot)
  return h.digest("hex")
}

/**
 * A fingerprint of what the app DECLARES — `adaptv.config.ts` and the icon art it points at.
 *
 * Neither is visible to `nativeFingerprint`, and that is not an oversight there but a gap
 * here. It folds in `ADAPTV_CAPACITOR_CONFIG`, but that env var is only re-stamped when
 * something calls `setCapacitorConfigEnv`, so editing the config FILE moves nothing it
 * hashes; and the icon art is read at `generateAssets` time, from a directory that lives
 * outside the native tree. Both are inputs a `dev` session baked into the app already
 * installed on the device, so editing either makes that install stale with nothing on screen
 * to say so — which is why commenting `icons` out mid-session produced no notice at all.
 *
 * Deliberately SHALLOW: the config file itself, not the modules it imports. A splash-screen
 * component reached through `import()` is app JS and hot-reloads on its own; following the
 * import graph would cost an esbuild bundle on every poll to catch changes that mostly are
 * not native ones.
 *
 * mtime + size for the art, like `fingerprint()` and for the same reason: nothing re-stamps
 * the dev's SOURCE icons, so an mtime only moves when they genuinely edit one. (The native
 * tree needs content hashing precisely because `generateAssets` rewrites it every run.)
 */
export function appConfigFingerprint(appRoot, config) {
  const h = createHash("sha1")
  try {
    h.update(readFileSync(path.join(appRoot, "adaptv.config.ts")))
  } catch {
    h.update("config:absent")
  }
  // `icons` is the ONLY thing that points at the launcher art and there is no fallback
  // directory (see `resolveIconSet`), so an unset key genuinely has nothing to watch — and
  // unsetting it is itself a change, caught by the config file's own hash above.
  if (typeof config?.icons === "string") {
    const dir = path.resolve(appRoot, config.icons)
    let entries = []
    try {
      entries = readdirSync(dir, { withFileTypes: true })
      entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    } catch {}
    for (const e of entries) {
      if (!e.isFile() || SKIP_FILES.has(e.name)) continue
      try {
        const s = statSync(path.join(dir, e.name))
        h.update(`${e.name}:${s.size}:${Math.round(s.mtimeMs)}\n`)
      } catch {}
    }
  }
  return h.digest("hex")
}

/**
 * Directories under a native project that don't describe the app BINARY — build output,
 * tool caches, and `public/` (the synced web bundle). `public/` matters most: during
 * live-reload the WebView loads from the dev server and never reads it, yet `cap sync`
 * rewrites it on every run — hashing it would break the cache on every JS edit, which is
 * exactly what this fingerprint exists to avoid.
 */
const NATIVE_SKIP_DIRS = new Set([
  "public",
  "build",
  ".gradle",
  "Pods",
  "DerivedData",
  "captures",
  "xcuserdata",
  ".idea",
  "node_modules",
  ".git",
])
const NATIVE_SKIP_FILES = new Set([".DS_Store", "local.properties"])

/**
 * A fingerprint of everything baked into the INSTALLED native app — deliberately NOT the
 * app's own JS/TS/CSS.
 *
 * This is the whole point of a separate fingerprint from `fingerprint()`: in live-reload
 * the installed binary is just a shell pointing at the dev server, so app code changes
 * cannot invalidate it (the web fingerprint hashes the source tree and would miss on
 * every keystroke, making the cache useless). What DOES invalidate it: the Capacitor
 * config — including `server.url`, so a `--port` change is caught — the declared
 * dependencies (adding/removing a native plugin), and the native project's own sources
 * (Info.plist, AndroidManifest, gradle, pbxproj, generated icons/splash).
 *
 * Hashes CONTENT, not size+mtime like `fingerprint()` does. That difference is load-
 * bearing: `generateAssets` re-stamps icons, colours and the launch storyboard into the
 * native project on every single run, writing byte-identical files with fresh mtimes. An
 * mtime-based hash therefore changed every run and the cache never hit once (measured).
 * Content hashing is also just the honest question — what the project CONTAINS, not when
 * it was last touched — and it costs nothing: measured 2026-09-02 on the playground app,
 * 1.1 ms for iOS (28 files / 0.8 MB) and 2.1 ms for Android (74 files / 0.5 MB).
 *
 * Compute it AFTER a sync/build, never before: `cap sync` rewrites files in the native
 * project, so a pre-sync fingerprint would never match the post-sync state.
 */
export function nativeFingerprint(appRoot, platform) {
  const h = createHash("sha1")
  // The config carries appId, plugin settings, and the dev server URL/port. It lives in the
  // env now (no file) — fold the raw JSON straight in.
  h.update(
    `capacitor:${process.env.ADAPTV_CAPACITOR_CONFIG ?? "absent"}\n`,
  )
  // Declared deps = the native plugin set. Content, not mtime: an install can rewrite
  // package.json without changing what it declares.
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(appRoot, "package.json"), "utf8"),
    )
    h.update(
      `deps:${JSON.stringify({
        d: pkg.dependencies ?? {},
        dd: pkg.devDependencies ?? {},
      })}\n`,
    )
  } catch {
    h.update("deps:absent\n")
  }

  const nativeRoot = path.join(appRoot, ADAPTV_DIR, platform)
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!NATIVE_SKIP_DIRS.has(e.name)) walk(full)
      } else if (e.isFile() && !NATIVE_SKIP_FILES.has(e.name)) {
        try {
          h.update(`${path.relative(nativeRoot, full)}:`)
          h.update(readFileSync(full))
          h.update("\n")
        } catch {}
      }
    }
  }
  walk(nativeRoot)
  return h.digest("hex")
}

/**
 * A fingerprint of the adaptv CLI's OWN source — the `bin/` tree that runs IN this process.
 *
 * Everything else `dev` watches is the APP: its `src/` (Vite hot-reloads it) and its config + icon
 * art (polled via `appConfigFingerprint`). adaptv's own generators and orchestration are different:
 * a running `adaptv dev` loaded these modules once, at startup, so editing one takes effect only on
 * a FRESH process. That never matters for an installed adaptv — `bin/` can't change mid-session —
 * but it is the whole framework-dev story: with a `link:`ed adaptv (the playground), editing a
 * generator mid-session changes nothing on screen and the next in-session rebuild silently reuses
 * the old logic. That is exactly how a merged edge-to-edge fix (#35) looked broken until the CLI
 * was restarted. `dev` polls this so it can SAY "restart to apply" instead of leaving the dev to
 * wonder why their framework edit did nothing.
 *
 * mtime + size, like `fingerprint()`: nothing re-stamps these sources, so an mtime only moves on a
 * genuine edit. `.test.mjs` is skipped — a test edit changes no runtime behaviour, so it must not
 * nag for a restart. Zero false notices for a real (installed) consumer; the whole signal for a
 * framework dev.
 */
export function cliSourceFingerprint(
  binDir = path.resolve(fileURLToPath(import.meta.url), "..", ".."),
) {
  const h = createHash("sha1")
  const walk = (dir) => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : 1))
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full)
      } else if (e.isFile() && !e.name.endsWith(".test.mjs")) {
        try {
          const s = statSync(full)
          h.update(
            `${path.relative(binDir, full)}:${s.size}:${Math.round(s.mtimeMs)}\n`,
          )
        } catch {}
      }
    }
  }
  walk(binDir)
  return h.digest("hex")
}
