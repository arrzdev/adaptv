import { createHash } from "node:crypto"
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import type { Plugin } from "vite"
import { appShellFile } from "#adaptv/config/sw-helpers.ts"
import type { AdaptvContext } from "#adaptv/vite/adaptv-context.ts"
import {
  captureClientOutDir,
  requireClientOutDir,
} from "#adaptv/vite/adaptv-context.ts"
import { ADAPTV_DIR } from "#adaptv/vite/adaptv-dir.ts"

/**
 * What a build WROTE, written down by the build itself.
 *
 * Two questions had no answer before this file, and both were answered by guessing
 * `.adaptv/web` — the one directory a web build never touches:
 *
 *   **where did it write?** The client output directory is not adaptv's to choose. A
 *   `render: "ssr"` build is assembled into `.output/public` by the server builder; a
 *   `render: "spa"` one lands in `dist/client`; only the native lineage is `.adaptv/web`.
 *   The CLI cannot derive that — the plugins that relocate it run inside the build — so
 *   it printed `✓ web  .adaptv/web` after an SSR build that had written neither byte
 *   there, and `writeChannel` put the update channel in the same wrong place, where no
 *   deploy would ever upload it.
 *
 *   **what was it built from?** `adaptv.config.ts` is baked into the bundle — the
 *   pre-paint theme script, the critical CSS, the manifest's `theme_color`, the head
 *   metas. The native project bakes the SAME config into files of its own (the iOS
 *   splash colourset, Android's `colors.xml`), and those are re-derived whenever
 *   `appConfigFingerprint` moves. The bundle had no such signal on the `dev` path, so
 *   the two halves of one app could — and did — ship different colours: a native splash
 *   in the new colour handing off to a web shell still painting the old one.
 *
 * The stamp closes both by writing the answers down where the CLI can read them, in
 * `.adaptv/build/<target>.json`. One file per lineage, because both can exist at once
 * (a `preview all` builds the web surface and the native bundle from one command) and a
 * single file would leave whichever ran last describing both.
 *
 * `configId` is NOT computed here. It is handed in by the CLI through
 * {@link BUILD_ID_ENV} — the one place that already owns that fingerprint, and the same
 * value that gates the native assets. Two producers of one identity is how the two
 * halves drift apart again, which is the bug this exists to end. A build run outside the
 * CLI (a bare `vite build`) therefore stamps `null`, and the CLI reads that as "not mine,
 * rebuild" — the safe direction.
 */
export type AdaptvBuildStamp = {
  /** Which lineage this build is — the bundle a WebView reads, or the one a host serves. */
  target: "web" | "capacitor"
  render: "ssr" | "spa"
  /** Where the client build actually wrote, app-root-relative. */
  outDir: string
  /** The emitted app shell, relative to `outDir` — `null` if the build emitted none. */
  shell: string | null
  /**
   * A content hash of that shell. The OUTPUTS half of the guard, and the reason this is
   * not merely a cache key: it asks whether the document on disk is still the one this
   * build wrote, so a hand-edited, half-written or externally-replaced bundle answers
   * "no" and gets rebuilt. Same two-halves shape as `generateAssets`.
   */
  shellHash: string | null
  /** The config identity this build was run under. See the note above. */
  configId: string | null
}

/**
 * The env var the CLI stamps its config fingerprint into before running vite.
 *
 * Deliberately an env var rather than a plugin option: `vite build` is spawned as a child
 * process by the CLI, and the app's `vite.config.ts` calls `adaptv()` with no arguments —
 * that bare call is the whole point of the config surface, so nothing may be required to
 * pass through it.
 */
export const BUILD_ID_ENV = "ADAPTV_BUILD_ID"

/** Where the stamp for `target` lives, for an app at `appRoot`. */
export function buildStampPath(
  appRoot: string,
  target: "web" | "capacitor",
): string {
  return path.join(appRoot, ADAPTV_DIR, "build", `${target}.json`)
}

/** A content hash of one file, or `null` when it isn't there / can't be read. */
export function fileHash(file: string): string | null {
  try {
    return createHash("sha1").update(readFileSync(file)).digest("hex")
  } catch {
    return null
  }
}

/** The stamp `target`'s last build left, or `null` — absent, unreadable or not JSON. */
export function readBuildStamp(
  appRoot: string,
  target: "web" | "capacitor",
): AdaptvBuildStamp | null {
  try {
    const raw = JSON.parse(
      readFileSync(buildStampPath(appRoot, target), "utf8"),
    ) as AdaptvBuildStamp
    return typeof raw?.outDir === "string" ? raw : null
  } catch {
    return null
  }
}

/**
 * Is the bundle `target` last built still the one the current config would produce?
 *
 * `configId` is the caller's current fingerprint. Every uncertainty answers **stale** —
 * no stamp, a stamp from another config, a stamp with no id (a build the CLI did not
 * run), a shell that is gone or whose bytes moved since. A false stale costs one build;
 * a false fresh ships an app whose native chrome and web shell disagree.
 */
export function bundleIsStale(
  appRoot: string,
  target: "web" | "capacitor",
  configId: string,
): boolean {
  const stamp = readBuildStamp(appRoot, target)
  if (!stamp || !stamp.configId || !stamp.shell || !stamp.shellHash)
    return true
  if (stamp.configId !== configId) return true
  const shell = path.resolve(appRoot, stamp.outDir, stamp.shell)
  return fileHash(shell) !== stamp.shellHash
}

/**
 * Write the stamp once the output directory is final.
 *
 * Registered LAST in the plugin array so it runs after every emitter and after the two
 * lineage pruners — the hash then describes the bytes that actually ship, not an
 * intermediate state that a later hook still edits.
 */
export function adaptvBuildStampPlugin(context: AdaptvContext): Plugin {
  return {
    name: "adaptv:build-stamp",
    apply: "build",
    configResolved(resolved) {
      captureClientOutDir(context, resolved)
    },
    buildApp: {
      order: "post",
      async handler() {
        writeBuildStamp(context)
      },
    },
  }
}

function writeBuildStamp(context: AdaptvContext): void {
  const clientDir = requireClientOutDir(context)
  const render = context.web?.render ?? "ssr"
  const shellFile = appShellFile(render)
  const shell = path.join(clientDir, shellFile)
  const emitted = existsSync(shell)

  const stamp: AdaptvBuildStamp = {
    target: context.target,
    render,
    //App-root-relative, like every other path adaptv reports. It is read back by the
    //CLI to name what the build produced, and an absolute path there is both noise and
    //the developer's home directory in a log they may paste. → `adaptv-context.ts`
    outDir: path.relative(context.appRoot, clientDir),
    shell: emitted ? shellFile : null,
    shellHash: emitted ? fileHash(shell) : null,
    configId: process.env[BUILD_ID_ENV] ?? null,
  }

  const file = buildStampPath(context.appRoot, context.target)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(stamp, null, 2)}\n`)
}
