/**
 * adaptv's edits to the route engine, applied as Node loads it. → `docs/decisions/facade-and-opacity.md`
 * (L20, L21)
 *
 * ## Why this exists
 *
 * Two lines of the engine name it in the consumer's app: the route generator writes
 * `import { createFileRoute } from "@tanstack/react-router"` into every route file, and
 * Start's entry ids (`virtual:tanstack-start-client-entry`, …) land in the HTML the app
 * serves. These used to be `pnpm patch`es, and pnpm applies `patchedDependencies` only
 * from the root of the project it installs, so every app had to carry adaptv's patches
 * in its own `patches/` and `pnpm-workspace.yaml`. L20 says the consumer is never asked
 * to patch a dependency.
 *
 * So adaptv makes the same edits itself, in memory, with a Node module load hook
 * (`module.registerHooks`). The files on disk stay as published, nothing is written
 * into the app, and it works the same under pnpm, npm and plain `vite`. Same pattern as
 * `bin/lib/cap.mjs`, which re-creates the Capacitor patch in-process.
 *
 * ## Loud on drift (L21)
 *
 * Each edit names the exact version it was written against and the exact text it
 * replaces. A different version of the package, or a file whose text moved, throws an
 * error naming both, the first time Node loads anything from that package. And
 * `assertEngineEdited` throws if the engine was loaded before the hook was installed,
 * so no failure here is a silent revert.
 *
 * ## Ordering
 *
 * A load hook only sees modules loaded after it is registered, and Node loads a static
 * import graph whole before it evaluates any module in it. So nothing that installs the
 * hook may statically reach the engine: `src/interface/vite.index.ts` installs it, then
 * imports the plugin dynamically.
 */

import { readFileSync } from "node:fs"
import * as nodeModule from "node:module"
import { fileURLToPath } from "node:url"

export type EngineEdit = {
  /** The package, by the name it is installed under. */
  pkg: string
  /** The one version the edit is written against. Any other throws. */
  version: string
  /** The file inside the package, as Node loads it. */
  file: string
  /** Each `from` must occur exactly once in the file. */
  replace: ReadonlyArray<readonly [from: string, to: string]>
}

export const ENGINE_EDITS: readonly EngineEdit[] = [
  {
    //the import the generator writes into route files names the framework barrel
    //(ADAPTV_ROUTER_PKG, set by adaptv's vite plugin). → src/vite/router-autoimport.ts
    pkg: "@tanstack/router-generator",
    version: "1.167.22",
    file: "dist/esm/transform/transform.js",
    replace: [
      [
        "const targetModule = `@tanstack/${ctx.target}-router`;",
        "const targetModule = process.env.ADAPTV_ROUTER_PKG || `@tanstack/${ctx.target}-router`;",
      ],
    ],
  },
  {
    //Start's entry ids are emitted into the served HTML. `#tanstack-start-entry` and
    //`#tanstack-router-entry` stay: they are subpath imports declared in
    //start-server-core's own `imports` map, and never reach the HTML.
    pkg: "@tanstack/start-plugin-core",
    version: "1.171.27",
    file: "dist/esm/constants.js",
    replace: [
      [
        'client: "virtual:tanstack-start-client-entry"',
        'client: "virtual:adaptv/client-entry"',
      ],
      [
        'server: "virtual:tanstack-start-server-entry"',
        'server: "virtual:adaptv/server-entry"',
      ],
      [
        'DEV_CLIENT_ENTRY = "virtual:tanstack-start-dev-client-entry"',
        'DEV_CLIENT_ENTRY = "virtual:adaptv/dev-client-entry"',
      ],
    ],
  },
]

/**
 * The edited source of one engine file. Throws, naming the file and the version, when
 * either is not the one the edit was written against.
 */
export function editEngineSource(
  edit: EngineEdit,
  version: string,
  source: string,
): string {
  const where = `${edit.pkg}@${version} ${edit.file}`
  if (version !== edit.version)
    throw new Error(
      `[adaptv] ${where}: adaptv edits ${edit.pkg}@${edit.version} only. Reinstall adaptv so it resolves the version it pins.`,
    )
  let out = source
  for (const [from, to] of edit.replace) {
    //an app that still declares the `pnpm patch` this replaced: same edit, already made
    if (!out.includes(from) && out.includes(to))
      throw new Error(
        `[adaptv] ${where} is already patched. Remove its line from \`patchedDependencies\` and its file from \`patches/\`, then reinstall: adaptv makes this change itself.`,
      )
    if (out.split(from).length !== 2)
      throw new Error(
        `[adaptv] ${where} no longer contains, exactly once, the text adaptv replaces: ${from}`,
      )
    out = out.replace(from, () => to)
  }
  return out
}

/**
 * The edit a module URL belongs to, with the package root it was loaded from, or `null`
 * for a module of any other package.
 */
export function engineModule(
  url: string,
): { edit: EngineEdit; root: string; file: string } | null {
  if (!url.startsWith("file:")) return null
  const filePath = fileURLToPath(url).replaceAll("\\", "/")
  for (const edit of ENGINE_EDITS) {
    const marker = `/node_modules/${edit.pkg}/`
    const at = filePath.lastIndexOf(marker)
    if (at === -1) continue
    return {
      edit,
      root: filePath.slice(0, at + marker.length),
      file: filePath.slice(at + marker.length),
    }
  }
  return null
}

//on globalThis rather than in this module: a checkout can load this file twice (from
//`src/` and from `dist/`), and two hooks would each try to edit already-edited text
const STATE = Symbol.for("adaptv.engine-edits")
type State = { applied: Set<string> }
const globals = globalThis as { [STATE]?: State }

/** Register the load hook once per thread. */
export function installEngineEdits(): void {
  if (globals[STATE]) return
  const registerHooks = (
    nodeModule as Partial<Pick<typeof nodeModule, "registerHooks">>
  ).registerHooks
  if (typeof registerHooks !== "function")
    throw new Error(
      `[adaptv] adaptv needs Node 22.15 or later; this is ${process.version}.`,
    )
  const state: State = { applied: new Set() }
  globals[STATE] = state
  const versions = new Map<string, string>()

  registerHooks({
    load(url, context, nextLoad) {
      const found = engineModule(url)
      if (!found) return nextLoad(url, context)
      const { edit, root, file } = found
      let version = versions.get(root)
      if (version === undefined) {
        version = (
          JSON.parse(readFileSync(`${root}package.json`, "utf8")) as {
            version: string
          }
        ).version
        versions.set(root, version)
      }
      //every file of the package, not only the edited one: a release that moved the
      //edited file would otherwise never reach the text check below
      if (version !== edit.version) editEngineSource(edit, version, "")
      const loaded = nextLoad(url, context)
      if (file !== edit.file) return loaded
      const source =
        loaded.source == null
          ? readFileSync(fileURLToPath(url), "utf8")
          : typeof loaded.source === "string"
            ? loaded.source
            : Buffer.from(loaded.source as Uint8Array).toString("utf8")
      state.applied.add(edit.pkg)
      return {
        ...loaded,
        source: editEngineSource(edit, version, source),
      }
    },
  })
}

/**
 * Throw unless every engine file adaptv edits went through the hook. Called once the
 * engine is loaded: an engine loaded before `installEngineEdits` would otherwise run
 * unedited, and the app would carry engine names again with nothing to say why.
 */
export function assertEngineEdited(): void {
  const applied = globals[STATE]?.applied ?? new Set()
  const missing = ENGINE_EDITS.filter((e) => !applied.has(e.pkg))
  if (missing.length === 0) return
  throw new Error(
    [
      `[adaptv] ${missing.map((e) => `${e.pkg}/${e.file}`).join(", ")} loaded without adaptv's edits.`,
      "Something loaded the route engine before `adaptv/vite`. Import adaptv's",
      "plugin from `adaptv/vite`, and do not import the engine in vite.config.ts.",
    ].join("\n"),
  )
}
