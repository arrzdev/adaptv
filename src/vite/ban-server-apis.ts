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
 * What the dev wrote is all this module reads. A server function made with a factory
 * some package re-exports, or a server route whose options live in another module,
 * imports nothing it can see: `server-boundary.ts` refuses those from what the
 * compiler and the server's router decided.
 *
 * The decision logic is factored out as pure functions so it is unit-testable
 * without standing up a bundler — the hooks below are thin wrappers.
 */

import type { Plugin } from "vite"

/**
 * Every Start package and its subpaths: `@tanstack/react-start` and every other
 * `@tanstack/*-start` (`solid-start`, `vue-start`, `react-form-start`), the old
 * `@tanstack/start`, and the `@tanstack/*-start-*` and `@tanstack/start-*` packages
 * behind them.
 *
 * ## Why a package family, not a list of specifiers
 *
 * The Start compiler does not recognise a server function by the specifier it was
 * imported from. It seeds its known roots per package — `@tanstack/start-client-core`
 * and `@tanstack/start-fn-stubs` beside `@tanstack/react-start` (start-plugin-core
 * `start-compiler/compiler.js`, `init()`, and `start-compiler/config.ts`) — and then
 * follows `export *` chains and compares the resolved binding
 * (`resolveKnownImportKind()`), so any module that reaches one of those exports is a
 * server function to it. The ban used to hold two exact specifiers, which left
 * `import { createServerFn } from "@tanstack/start-client-core"` building clean
 * under any install that resolves the package (npm, yarn, bun, a hoisted pnpm, or
 * an app that adds it), and every server subpath (`/client-rpc`, `/server-rpc`,
 * `/ssr-rpc`, `/rsc`) open. A binding-level rule would need the compiler's own
 * resolver; the family is the closest thing a `resolveId` hook can see, and it is
 * deny-by-default, so a subpath an upstream release adds stays shut until someone
 * reads what is behind it. The siblings are in it because the compiler names its
 * root `@tanstack/${framework}-start` (`start-compiler/config.ts`): an app that adds
 * one gets the same server functions under another name. `@tanstack/react-router`
 * and the rest of the router packages are deliberately outside it — routing is
 * isomorphic, and `loader`/`beforeLoad` are Router features that adaptv endorses.
 * **Ban server-only calls, not loaders.**
 *
 * The name part is the regex form of `biome-shared.json`'s globs, `start`,
 * `start-*`, `*-start` and `*-start-*`, with `*` as "anything but `/`", so the two
 * layers give every package name the same verdict (a parity test holds them to
 * it). Any number of words may come before `-start`: `@tanstack/react-form-start` is a
 * framework package whose `getFormData` is a `createServerFn().handler()`, and
 * start-plugin-core compiles it into the app (`vite/plugin.js`, the framework-package
 * crawl), so a one-word prefix let it build clean.
 *
 * Matched as a bare specifier, or as a path segment after `node_modules/`, because a
 * file path into the install reaches the same binding and the compiler treats it
 * the same.
 */
const START_PACKAGE =
  /(?:^|\/node_modules\/)@tanstack\/(?:[^/]*-)?start(?:-[^/]*)?(?:\/|$)/

/**
 * The Start specifiers application source may import. Deny by default means each is
 * here because a real importer in the app's module graph needs it, and neither
 * carries a server function:
 *
 * - `@tanstack/react-start/client` — imported by `src/routes/client-entry.tsx`
 *   (`StartClient`, the hydration entry), and by an app that ejects
 *   `src/client.tsx` with the same code.
 * - `@tanstack/react-start/server-entry` — imported by
 *   `src/interface/server-entry.ts`, the SSR server entry adaptv re-exports for
 *   `router.serverEntry` and a Worker's `main`. It holds no server function.
 *
 * Both importers are adaptv's own modules, and under a linked install (the
 * playground's `link:`) they are not under `node_modules`, so the ban governs them
 * like app code. `@tanstack/react-start/plugin/vite` is NOT here: its one importer,
 * `src/vite/adaptv-plugin.ts`, is loaded with the Vite config, before and outside
 * the plugin chain this hook runs in.
 *
 * `biome-shared.json` re-allows exactly this set; `ban-server-apis.test.ts` holds the
 * two in step.
 */
export const ALLOWED_START_SPECIFIERS: ReadonlySet<string> = new Set([
  "@tanstack/react-start/client",
  "@tanstack/react-start/server-entry",
])

/** Whether an import specifier is a banned server-only module. */
export function isBannedServerModule(source: string): boolean {
  //Vite resolves `pkg?x` like `pkg`, so a query must not dodge the rule
  const specifier = (source.split("?")[0] ?? source).replaceAll("\\", "/")
  if (ALLOWED_START_SPECIFIERS.has(specifier)) return false
  return START_PACKAGE.test(specifier)
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

/**
 * The imports the compiler writes into a server function, in any environment. They are
 * its output, not the dev's input: `server-boundary.ts` reads them and names the server
 * function, where this ban would name an import the dev never wrote.
 */
export function isCompilerRpcImport(source: string): boolean {
  return /^@tanstack\/[^/]+-start\/(?:client|server|ssr)-rpc$/.test(source)
}

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
      if (isCompilerRpcImport(source)) return null
      const message = describeServerApiBan(source, importer)
      if (message === null) return null
      //`importer` is non-null whenever describeServerApiBan returned a message —
      //isApplicationSource() rejects undefined
      this.error({ message, id: importer })
    },
  }
}
