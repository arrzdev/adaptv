/**
 * `.adaptv/` — the hidden generated directory. → `docs/design/architecture.md §3.2` (D1)
 *
 * ## Why hide them rather than eliminate them
 *
 * Fully removing generated files is out of scope and would be a mistake: TanStack
 * Router's typesafety **rests on** a generated route tree, and killing it means
 * forking the type layer — which violates the "rent the stable core, own the
 * seams" doctrine (§0.6). So the goal is not absence, it is **opacity**: the files
 * still exist, they are just not the consumer's problem.
 *
 * Before this, the plugin stamped into the app's own source tree —
 * `src/router.gen.tsx`, `src/routing/layouts/__root.gen.tsx`, `routeTree.gen.ts`
 * beside the routes. Three framework artifacts interleaved with application code,
 * each needing its own `.gitignore` line, each showing up in search results and
 * file trees forever.
 *
 * One dot-prefixed directory, regenerated on every `dev`/`build`, gitignored, and
 * treated exactly like `dist/`. The consumer wires none of it: adaptv emits the
 * tsconfig `paths` mapping, the Vite alias, and the ignore entry itself.
 */
import path from "node:path"

/** The generated directory, relative to the app root. */
export const ADAPTV_DIR = ".adaptv"

/**
 * The alias generated code uses to reach into `.adaptv/`.
 *
 * A distinct namespace from `#adaptv/*` (which is the framework's own internal
 * self-alias) so the two can never be confused when reading a stack trace.
 */
export const ADAPTV_GEN_ALIAS = "#adaptv-gen"

export type GeneratedPaths = {
  /** The stamped router entry (`createRouter` + the Register declaration). */
  routerGen: string
  /** The generated service worker, when the app does not author its own. */
  swGen: string
  /** TanStack's generated route tree. */
  routeTree: string
  /** The `declare module` augmentation that lights up typed routing. */
  registerDts: string
}

/**
 * ⚠︎ The root route is deliberately NOT here.
 *
 * It is a real module shipped in the package (`src/routes/root-route.tsx`); the
 * virtual-route DSL points at it via `ADAPTV_ROOT_ROUTE_FILE`, and its
 * app-specific half arrives through the `virtual:adaptv/root-route` module. It was
 * generated per-app until an audit showed almost all of it was framework code.
 */

/** Absolute paths of everything adaptv generates, for an app at `appRoot`. */
export function resolveGeneratedPaths(appRoot: string): GeneratedPaths {
  const dir = path.join(appRoot, ADAPTV_DIR)
  return {
    routerGen: path.join(dir, "router.gen.tsx"),
    swGen: path.join(dir, "sw.gen.ts"),
    routeTree: path.join(dir, "routeTree.gen.ts"),
    registerDts: path.join(dir, "register.d.ts"),
  }
}

/**
 * Scratch space for the code generators, one sub-directory per producer.
 *
 * `tmp/` rather than a bare `.adaptv/router-tmp`: the point of a single hidden dir
 * is that everything inside it is *organised*, so transient files are namespaced
 * away from the outputs anything imports (`routeTree.gen.ts` and friends live at
 * the top level). `router/` names the producer, so the next generator that wants
 * scratch space gets a sibling instead of sharing a bucket.
 *
 * ```
 * .adaptv/
 *   routeTree.gen.ts   output — imported
 *   tmp/router/        scratch — write-then-rename, never imported
 * ```
 *
 * ABSOLUTE, always: the generator resolves a relative `tmpDir` against
 * `process.cwd()`, not the app root, so a relative value would scatter scratch
 * dirs around whenever Vite is invoked from somewhere other than the app.
 */
export function resolveGeneratedTmpDir(appRoot: string): string {
  return path.join(appRoot, ADAPTV_DIR, "tmp", "router")
}

/**
 * The `compilerOptions.paths` entry an app's tsconfig needs.
 *
 * Emitted by adaptv rather than documented for the consumer to copy: a path
 * mapping that must stay in sync with a framework internal is precisely the kind
 * of per-project wiring that rots silently.
 */
export function adaptvDirTsconfigPaths(): Record<string, string[]> {
  return { [`${ADAPTV_GEN_ALIAS}/*`]: [`./${ADAPTV_DIR}/*`] }
}

/**
 * Everything adaptv GENERATES into the app root, and therefore keeps out of git.
 *
 * `capacitor.config.json` belongs here even though it sits at the app root rather than
 * inside `.adaptv/`: adaptv stamps it from `adaptv.config.ts` (the consumer never hand-
 * writes it), and the Capacitor CLI hard-requires it in the directory it runs from, so
 * it can't be moved. Committing it is what makes it dangerous — `adaptv dev` mutates it
 * in place (`server.url`, `errorPath`, `androidScheme`), so a run killed with SIGKILL
 * leaves dev-only fields in a tracked file, one `git commit -a` away from shipping an
 * app that points at someone's laptop. Ignored + regenerated every command, that whole
 * class of bug disappears. → config-artifact PR.
 */
export const ADAPTV_GITIGNORED: readonly string[] = [
  `${ADAPTV_DIR}/`,
  "capacitor.config.json",
]

/** The `.gitignore` stanza for everything adaptv generates. */
export function adaptvDirGitignoreEntry(): string {
  return [
    "# Generated by adaptv on every dev/build. Build artifacts, like dist/.",
    ...ADAPTV_GITIGNORED,
  ].join("\n")
}

/**
 * The `.gitignore` content after ensuring every generated path is covered, or `null`
 * when nothing needs adding.
 *
 * Pure so the append logic is testable without touching a working tree. Two rules that
 * matter: entries are checked INDIVIDUALLY (an app already ignoring `.adaptv/` must still
 * pick up a later addition), and existing content is only ever appended to — never
 * reordered or reformatted, because this file belongs to the consumer.
 */
export function nextGitignore(current: string): string | null {
  const lines = new Set(current.split(/\r?\n/).map((l) => l.trim()))
  const missing = ADAPTV_GITIGNORED.filter((e) => !lines.has(e))
  if (missing.length === 0) return null

  // First time: the full stanza (comment + entries). Topping up an existing stanza:
  // only what's missing, so the comment isn't repeated.
  const block =
    missing.length === ADAPTV_GITIGNORED.length
      ? adaptvDirGitignoreEntry()
      : missing.join("\n")
  const prefix = current.length > 0 && !current.endsWith("\n") ? "\n" : ""
  return `${current}${prefix}\n${block}\n`
}
