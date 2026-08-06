/**
 * Fail loudly when adaptv's dependency patches are not applied.
 * → `DECISIONS.md §2.6a` (L19), `§2.6b`
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
import { join } from "node:path"
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
 * The filename IS the pnpm key: `@tanstack__router-generator@1.166.22.patch`
 * means `'@tanstack/router-generator@1.166.22'`. Keeping one encoding is what
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
  //L21: an unversioned key would let a drifting upstream patch changed code
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

/** The message shown when a patch is missing. States the fix, not just the fault. */
export function describeMissingPatches(
  missing: string[],
  filenames: string[] = shippedPatchFilenames(),
): string {
  return [
    `[adaptv] Required dependency patches are not applied: ${missing.join(", ")}.`,
    "",
    "Without them the route generator writes `@tanstack/react-router` imports into your",
    "route files and adaptv's framework facade silently stops working — the build still",
    "succeeds, which is why this is an error rather than a warning.",
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

/* ============================================================================
 * Wiring
 * ========================================================================== */

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
      describeMissingPatches([
        "@tanstack/start-plugin-core",
        "@tanstack/router-generator",
      ]),
    ].join("\n"),
  )
}
