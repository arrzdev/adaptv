/**
 * Fail loudly when adaptv's dependency patches are not applied.
 * → `docs/decisions/register.md §2.6a` (L19), `§2.6b`
 *
 * ## Why this exists
 *
 * adaptv's TanStack opacity rests on two `pnpm patch`es. They are declared in
 * `pnpm-workspace.yaml` under `patchedDependencies` — and pnpm honours that key
 * **only in the root manifest of the project being installed**. A library cannot
 * carry its own patches into a consumer's install.
 *
 * So in a real consumer app, without the same declaration, both patches are
 * simply absent. And the failure is **silent**: the generator goes back to
 * writing `@tanstack/react-router` imports into route files, the facade quietly
 * reverts, and the app still builds. Someone would eventually notice their
 * "opaque" framework leaking TanStack everywhere and have no idea why.
 *
 * A silent revert is much worse than a hard failure, so this turns it into one.
 */

import { readdirSync, readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

export type PatchStatus = {
  ok: boolean
  /** Human-readable names of the patches that are missing. */
  missing: string[]
}

/**
 * Detect whether the patches took, by inspecting the *behaviour* they enable
 * rather than by reading pnpm's metadata.
 *
 * Checking the installed source is the honest test: it is true exactly when the
 * feature works, and it cannot be fooled by a stale lockfile, a partial install,
 * or a hoisting layout that resolved a different copy of the package than the
 * one that was patched.
 */
export function checkPatches(sources: {
  /** Contents of `start-plugin-core/dist/esm/start-router-plugin/route-tree-footer.js`. */
  startFooter?: string
  /** Contents of `router-generator/dist/esm/template.js`. */
  generatorTemplate?: string
}): PatchStatus {
  const missing: string[] = []

  //patched => the generated route tree's `declare module` reads adaptv's Start
  //barrel via the env override, instead of hardcoding `@tanstack/*-start`
  if (
    sources.startFooter !== undefined &&
    !sources.startFooter.includes("ADAPTV_START_PKG")
  ) {
    missing.push("@tanstack/start-plugin-core")
  }

  //patched => the target template reads adaptv's env override
  if (
    sources.generatorTemplate !== undefined &&
    !sources.generatorTemplate.includes("ADAPTV_ROUTER_PKG")
  ) {
    missing.push("@tanstack/router-generator")
  }

  return { ok: missing.length === 0, missing }
}

/**
 * The `patchedDependencies` filename convention, decoded.
 *
 * The filename IS the pnpm key: `@scope__name@version.patch` means
 * `'@scope/name@version'` — today `@tanstack__router-generator@1.167.21.patch`
 * decodes to `'@tanstack/router-generator@1.167.21'`. Keeping one encoding is what
 * makes the instructions below trustworthy — they are derived from the patches
 * that actually shipped, so a version bump (which renames the file, per L21)
 * updates the message on its own. They used to be hardcoded, and version-keying
 * the patches left them naming a file that no longer existed.
 */
export function parsePatchFilename(
  file: string,
): { key: string; file: string } | null {
  if (!file.endsWith(".patch")) return null
  const stem = file.slice(0, -".patch".length)
  //`@scope__name@version` → `@scope/name@version`; `name@version` → unchanged.
  //pnpm's own convention already carries the leading `@`, so only the scope
  //separator is decoded — prepending one produced `@@capacitor/cli`.
  const key = stem.replace("__", "/")
  //L21: refuse an unversioned key — it would let a patch written against one
  //release keep applying as upstream drifts underneath it
  if (!/.@\d/.test(key)) return null
  return { key, file }
}

/** The `pnpm-workspace.yaml` block a consumer must copy, built from the shipped patches. */
export function patchInstructions(filenames: string[]): string[] {
  return filenames
    .map(parsePatchFilename)
    .filter((e): e is { key: string; file: string } => e !== null)
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(
      (e) =>
        `    '${e.key}': node_modules/@arrzdev/adaptv/patches/${e.file}`,
    )
}

/**
 * The patches this copy of adaptv ships (`patches/` is in package.json `files`).
 *
 * Resolved from this module first — that is the copy the consumer installed, and
 * the only one whose contents match the code raising the error. The cwd fallback
 * covers loaders that hand out a non-`file:` `import.meta.url` (vitest does), where
 * resolving from the module throws and would otherwise silently advertise nothing.
 */
function shippedPatchFilenames(): string[] {
  const roots: Array<() => string> = [
    () => fileURLToPath(new URL("../../patches", import.meta.url)),
    () => join(process.cwd(), "patches"),
  ]
  for (const root of roots) {
    try {
      return readdirSync(root())
    } catch {}
  }
  return []
}

/**
 * The message shown when a patch is missing. States the fix, not just the fault.
 *
 * `consequence` is the caller's, because the fix is identical for every patch and
 * the reason to care never is. A shared sentence would have to be vague enough to
 * cover all of them, and vague is what makes an error skippable.
 */
export function describeMissingPatches(
  missing: string[],
  consequence: string[],
  filenames: string[] = shippedPatchFilenames(),
): string {
  return [
    `[adaptv] Required dependency patches are not applied: ${missing.join(", ")}.`,
    "",
    ...consequence,
    "",
    "pnpm only applies `patchedDependencies` from the root manifest of the project being",
    "installed, so a library cannot carry its patches to you. Add this to your",
    "`pnpm-workspace.yaml` (or the `pnpm` key of your root `package.json` on pnpm < 11):",
    "",
    "  patchedDependencies:",
    ...patchInstructions(filenames),
    "",
    "then run `pnpm install`. If it still reports missing, delete `node_modules` first —",
    "pnpm does not always re-apply patches on an incremental install.",
  ].join("\n")
}

/**
 * Verify the invariant **on the generated output**, which is the only reliable
 * signal available.
 *
 * Two earlier attempts checked the patched dependency *files* and both failed
 * silently, for the same underlying reason: `@tanstack/start-plugin-core` and
 * `@tanstack/router-generator` are **transitive** dependencies of
 * `@tanstack/react-start`, so under pnpm's strict, non-hoisted layout they are
 * not resolvable by name — not from the app root, and not from adaptv either
 * (`MODULE_NOT_FOUND` for both). A checker that cannot read the thing it checks
 * reports success, which is worse than no checker at all.
 *
 * So this asserts the property we actually care about — *is the generated route
 * tree free of `@tanstack`?* — rather than a proxy for it. It cannot be fooled by
 * a resolution quirk, a stale lockfile, or a future refactor of the patches,
 * because it tests the outcome instead of the mechanism.
 */
export function assertRouteTreeIsOpaque(routeTreePath: string): void {
  let source: string
  try {
    source = readFileSync(routeTreePath, "utf8")
  } catch {
    //not generated yet on this pass — nothing to assert
    return
  }
  //Any mention at all — not just an import. The generator also signs the file's header
  //("automatically generated by TanStack Router"), which named the machinery underneath in
  //a file the consumer reads. Assert the property we actually want — the tree says nothing
  //about TanStack — so a new leak in a comment can't pass a specifier-only check.
  if (!/@tanstack\/|tanstack router/i.test(source)) return

  throw new Error(
    [
      "[adaptv] The generated route tree still imports from `@tanstack/*`.",
      `  ${routeTreePath}`,
      "",
      "That means adaptv's dependency patches are not applied to this install. The build",
      "would otherwise SUCCEED with the framework facade silently disabled — your route",
      "files would carry `@tanstack/react-router` imports again — which is why this is an",
      "error rather than a warning.",
      "",
      describeMissingPatches(
        ["@tanstack/start-plugin-core", "@tanstack/router-generator"],
        [
          "Without them the route generator writes `@tanstack/react-router` imports into your",
          "route files and adaptv's framework facade silently stops working — the build still",
          "succeeds, which is why this is an error rather than a warning.",
        ],
      ),
    ].join("\n"),
  )
}

/**
 * The comment adaptv's native patch leaves behind in every file it edits.
 *
 * A marker rather than a diff comparison: the check has to survive the upstream
 * moving around it, and what it needs to know is only "did adaptv's edits land".
 */
export const NATIVE_PATCH_MARKER = "ADAPTV PATCH"

/** The rented update core, and the two files adaptv edits inside it. */
export const UPDATE_PLUGIN = "@capawesome/capacitor-live-update"
const UPDATE_PLUGIN_SOURCES = [
  "ios/Plugin/LiveUpdate.swift",
  "android/src/main/java/io/capawesome/capacitorjs/plugins/liveupdate/LiveUpdate.java",
]

/**
 * Which of the native sources are missing adaptv's edits.
 *
 * A source read as `null` (the file is not there) counts as missing: an update
 * core whose layout moved is exactly the case the version-pinned patch key exists
 * to catch, and "cannot read it" must never be quieter than "read it and it was
 * unpatched".
 */
export function checkNativePatch(
  sources: Array<{ path: string; source: string | null }>,
): PatchStatus {
  const missing = sources
    .filter((s) => !s.source?.includes(NATIVE_PATCH_MARKER))
    .map((s) => s.path)
  return { ok: missing.length === 0, missing }
}

/**
 * 🔴 The native patch, verified where its absence would otherwise be silent.
 *
 * Unpatched, the app still builds and updates still install. What changes is the
 * failure path: a bad bundle rolls back to whatever the **store** shipped rather
 * than to the newest bundle this device is known to boot. That is a launch of damage
 * in a situation the user is already unhappy in, it does not show up in a passing
 * build, and nothing but this check would say so.
 *
 * Returns the message to print, or `null` when everything is in place. Reading the
 * files rather than pnpm's metadata, for the reason {@link checkPatches} gives:
 * a lockfile can claim a patch that a partial install never applied.
 */
export function missingNativePatchMessage(
  adaptvRoot: string = defaultAdaptvRoot(),
): string | null {
  const pluginRoot = resolveUpdatePluginRoot(adaptvRoot)
  const sources = UPDATE_PLUGIN_SOURCES.map((rel) => ({
    path: rel,
    //An unresolvable core reads as an unpatched one, and the message is still the
    //right one: whatever went wrong, this build would ship the unpatched behaviour.
    source: pluginRoot ? readIfPresent(join(pluginRoot, rel)) : null,
  }))
  const { ok, missing } = checkNativePatch(sources)
  if (ok) return null

  return [
    `[adaptv] The update core is not patched (${missing.join(", ")}).`,
    "",
    describeMissingPatches(
      [UPDATE_PLUGIN],
      [
        "Native builds still succeed and updates still install, so this cannot be caught later.",
        "What it costs is the failure path: a bundle that will not start rolls the app back to",
        "whatever the store shipped, rather than to the newest bundle this device is known to",
        "boot. On a phone that has been updating over the air since its last store release that",
        "is a very old app, restored at the worst possible moment.",
      ],
    ),
  ].join("\n")
}

function readIfPresent(file: string): string | null {
  try {
    return readFileSync(file, "utf8")
  } catch {
    return null
  }
}

/**
 * Where the rented update core is installed, or `null` if it cannot be found.
 *
 * Resolved **from adaptv's own directory**, never from the app: the core is
 * adaptv's dependency, so under pnpm's strict layout the consumer's root cannot
 * see it by name at all.
 *
 * 🔴 Seeded with a real file path rather than `import.meta.url`. The CLI loads
 * this module by transpiling it to a `data:` URL, and `createRequire` rejects
 * anything that is not a file — which turned this check into a crash on the first
 * native build after it was written. Same hazard `shippedPatchFilenames` guards.
 */
function resolveUpdatePluginRoot(adaptvRoot: string): string | null {
  try {
    const require = createRequire(join(adaptvRoot, "package.json"))
    return dirname(require.resolve(`${UPDATE_PLUGIN}/package.json`))
  } catch {
    return null
  }
}

/** adaptv's own package root, when the caller has no better answer. */
function defaultAdaptvRoot(): string {
  try {
    return fileURLToPath(new URL("../..", import.meta.url))
  } catch {
    return process.cwd()
  }
}
