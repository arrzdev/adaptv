/**
 * The isomorphism ban, enforced at build time.
 *
 * adaptv's central promise is that one codebase runs on six targets. Server
 * functions break that promise silently: `createServerFn` works perfectly in
 * `vite dev`, works in an SSR deploy, and **dies on a Capacitor build**, which has
 * no server at all — the app is a folder of files on the device. The failure lands
 * at the end of the pipeline, on a device, long after the code was written.
 *
 * So the rule is not documentation. It is a build failure. → `docs/design/rendering.md §2` (L3)
 *
 * ## Layering (`docs/decisions/facade-and-opacity.md §2.2`, §2.6b)
 *
 * This module is the **backstop**, not the primary surface. A bundler error gives
 * no editor squiggles — there is no LSP in the picture, and a file the running page
 * never imports is never checked. The linter config adaptv ships is the surface
 * developers should actually feel; this is what catches everyone who doesn't run
 * it, and it is the one layer a consumer cannot disable, misconfigure, or forget,
 * because it lives inside the framework's own plugin array.
 *
 * The decision logic is factored out as pure functions so it is unit-testable
 * without standing up a bundler — the hooks below are thin wrappers.
 */

import type { Plugin } from "vite"

/**
 * Modules banned from application source.
 *
 * Whole subpaths rather than named symbols: everything on them needs a request or
 * a response, so there is no client-safe surface worth threading a per-symbol
 * allowance for. `@tanstack/react-router` is deliberately absent — routing is
 * isomorphic, and `loader`/`beforeLoad` are Router features that adaptv endorses.
 * **Ban server-only calls, not loaders.**
 */
const BANNED_MODULES = new Set([
  "@tanstack/react-start",
  "@tanstack/react-start/server",
])

/** Whether an import specifier is a banned server-only module. */
export function isBannedServerModule(source: string): boolean {
  return BANNED_MODULES.has(source)
}

/**
 * Whether an importer is application source, i.e. code the ban governs.
 *
 * Dependencies are exempt and must stay exempt: TanStack Start's own internals
 * import these constantly, and banning them there would make adaptv unusable
 * rather than safe. The `node_modules` test is a path-segment test so it also
 * catches pnpm's nested `.pnpm/<pkg>/node_modules/<pkg>` layout.
 *
 * ⚠︎ The extension check is an **allowlist**, and it is load-bearing.
 *
 * The first version of this rule was simply "anything outside `node_modules`".
 * That passed every test and every `vite build` — and **broke `vite dev`**:
 * TanStack Start's entry resolution attributes `@tanstack/react-start` to the
 * app's `index.html`, which is outside `node_modules` and so satisfied the rule.
 * The ban fired on the framework's own bootstrap and the dev server died before
 * serving anything.
 *
 * Only code a human wrote in this app can violate the isomorphism rule, and that
 * code is always a JS/TS module. An HTML entry document is Vite plumbing.
 */
export function isApplicationSource(
  importer: string | undefined,
): boolean {
  if (!importer) return false
  //virtual modules (adaptv's own, and other plugins') have no file to blame, and
  //a caret frame pointing into generated code helps nobody
  if (importer.startsWith("\0") || importer.includes("virtual:"))
    return false

  const segments = importer.split(/[/\\]/)
  if (segments.includes("node_modules")) return false

  //strip Vite's query suffixes (`?v=`, `?import`, …) before testing
  const withoutQuery = importer.split("?")[0] ?? importer
  return /\.(m|c)?(j|t)sx?$/.test(withoutQuery)
}

/**
 * The whole decision: returns the diagnostic message, or `null` to allow.
 *
 * The message states the *reason* rather than just the prohibition. "Banned" sends
 * someone searching the codebase for a policy; naming the target that breaks tells
 * them immediately whether they care — and they usually haven't built that target
 * yet, which is exactly why they wrote the import.
 *
 * The target is "the native app", never the engine it is built with. This text reaches
 * the dev's terminal, the dev overlay and (via `biome-shared.json`) their editor, and
 * every one of those is a surface the consumer must not learn the machinery from
 * (`docs/decisions/register.md` L20; `bin/lib/opacity.mjs`). The one engine word it
 * carries is `source` — the import the dev wrote, in their own file. `opacity.test.mjs`
 * holds both messages to this.
 */
export function describeServerApiBan(
  source: string,
  importer: string | undefined,
): string | null {
  if (!isBannedServerModule(source)) return null
  if (!isApplicationSource(importer)) return null

  return (
    `"${source}" is server-only and cannot be imported from application source.\n` +
    `It needs a server to run, and the native app has none — the app is a folder ` +
    `of files on the device, so this would work in dev and in an SSR deploy, then ` +
    `fail on iOS and Android.\n` +
    `Move the logic to your API and call it over the network, or use a route ` +
    `\`loader\`, which is isomorphic and fully supported.\n` +
    `See docs/design/rendering.md §2.`
  )
}

/* ============================================================================
 * The gap no import rule can reach
 * ========================================================================== */

/** Blank out comments and string/template literals so a scan can't match prose. */
function stripNonCode(code: string): string {
  //replace with same-length spaces so every offset stays exact — the whole point
  //of the scan is to report a position the editor can put a caret on
  const blank = (m: string) => " ".repeat(m.length)
  return code
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank)
    .replace(/"(?:[^"\\\n]|\\.)*"/g, blank)
    .replace(/'(?:[^'\\\n]|\\.)*'/g, blank)
    .replace(/`(?:[^`\\]|\\.)*`/g, blank)
}

/**
 * Find a `server: { … }` property on a `createFileRoute(…)({ … })` options object.
 * Returns the character offset of the property, or `null`.
 *
 * ## Why this is not an import check
 *
 * `createServerFileRoute` **does not exist** in the pinned
 * `@tanstack/react-start@1.167.13` — that API generation replaced it with a
 * `server` property on `createFileRoute`'s options object. (`docs/design/rendering.md §2` still
 * lists the old symbol and is stale on this point.)
 *
 * A config-object property is not an importable symbol, so *no* import-restriction
 * technique — TypeScript, Biome `noRestrictedImports`, or the `resolveId` hook
 * above — can ever see it. It needs to be found in the syntax.
 *
 * ## Scope, stated honestly
 *
 * This is a brace-depth scan over comment- and string-stripped source, not a
 * parser. It deliberately matches only the **options-object level** `server` key,
 * because an app is entitled to its own data named `server` inside a loader
 * result or component props. It will miss a route assembled indirectly
 * (`const opts = {...}; createFileRoute("/x")(opts)`), which is the accepted cost
 * of not paying for a full parse on every module. The `resolveId` ban above is the
 * layer that must be airtight; this one raises the floor on a shape that would
 * otherwise be invisible.
 */
export function findServerRouteHandlers(code: string): number | null {
  //string prefilter first: parsing/scanning is orders of magnitude more expensive
  //than a substring test, and the overwhelming majority of modules are not routes
  if (!code.includes("createFileRoute")) return null
  if (!code.includes("server")) return null

  const source = stripNonCode(code)
  const callIndex = source.indexOf("createFileRoute")
  if (callIndex === -1) return null

  //walk to the options object: createFileRoute(<path>)( <options> )
  const optionsStart = source.indexOf("{", callIndex)
  if (optionsStart === -1) return null

  let depth = 0
  for (let i = optionsStart; i < source.length; i++) {
    const ch = source[i]
    if (ch === "{") {
      depth++
      continue
    }
    if (ch === "}") {
      depth--
      if (depth === 0) return null //options object closed without a hit
      continue
    }
    //only depth 1 is the options object itself; anything deeper is app data
    if (depth !== 1) continue

    if (source.startsWith("server", i)) {
      const after = source.slice(i + "server".length)
      //must be a property key: `server:` (allowing whitespace before the colon)
      if (/^\s*:/.test(after)) return i
    }
  }
  return null
}

/**
 * The diagnostic for the config-shape gap. Same rule as {@link describeServerApiBan}:
 * the target that breaks is named as what it is to the dev, not as what it is built with.
 */
export const SERVER_ROUTE_HANDLERS_MESSAGE =
  "`server: { handlers }` on a route is server-only and cannot be used in an adaptv app.\n" +
  "It needs a server to run, and the native app has none.\n" +
  "Move the handler to your API and call it over the network, or use the " +
  "route's `loader`, which is isomorphic and fully supported.\n" +
  "See docs/design/rendering.md §2."

/**
 * The unbypassable backstop. Baked into the array `adaptv()` returns, so it is not
 * a devDependency a consumer opts into — it is inside the framework's own plugin.
 *
 * `enforce: "pre"` puts it ahead of `tanstackStart()`, so the ban is decided
 * before Start's own resolution can claim the specifier.
 *
 * Uses `this.error()` rather than `throw`: a bare throw dumps a dozen lines of
 * irrelevant bundler stack trace for what is a *lint* error, not a crash.
 * `this.error()` takes a character offset, derives line/column itself, and renders
 * a caret frame. Dev returns a structured 500 the overlay renders; build exits 1.
 */
export function adaptvBanServerApisPlugin(): Plugin {
  return {
    name: "adaptv:ban-server-apis",
    enforce: "pre",

    resolveId(source, importer) {
      const message = describeServerApiBan(source, importer)
      if (message === null) return null
      //`importer` is non-null whenever describeServerApiBan returned a message —
      //isApplicationSource() rejects undefined
      this.error({ message, id: importer })
    },

    transform(code, id) {
      if (!isApplicationSource(id)) return null
      const at = findServerRouteHandlers(code)
      if (at === null) return null

      this.error({ message: SERVER_ROUTE_HANDLERS_MESSAGE, id }, at)
    },
  }
}
