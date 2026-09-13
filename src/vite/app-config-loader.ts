import { existsSync } from "node:fs"
import path from "node:path"
import type { Plugin as EsbuildPlugin } from "esbuild"
import { build as esbuild } from "esbuild"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import type { LoadedAppConfig } from "#adaptv/vite/adaptv-context"
import { appConfigErrors } from "#adaptv/vite/app-config-errors.ts"

export const APP_CONFIG_BASENAME = "adaptv.config.ts"

/**
 * Read `adaptv.config.ts` in Node as data: the module's default export, untyped
 * and unchecked, plus the files it was bundled from. We bundle it with esbuild
 * so `defineApp` inlines, but mark every dynamic import (`() => import(...)`)
 * external — the component thunks must NOT be resolved or executed here. The
 * bundle therefore has zero static imports and evaluates cleanly from a
 * `data:` URL, leaving each thunk as an inert closure whose specifier we later
 * read with `.toString()`.
 *
 * The CLI reads the file through here too (`bin/lib/load-config.mjs`), so
 * there is one bundler configuration for it and one way the thunks stay inert.
 * What each face refuses on top is its own: the build validates through
 * `loadAppConfig` below, the CLI through its preflight.
 */
export async function readAppConfig(
  appRoot: string,
): Promise<{ loaded: unknown; watchFiles: string[] }> {
  const configPath = path.resolve(appRoot, APP_CONFIG_BASENAME)
  if (!existsSync(configPath)) {
    throw new Error(
      `[adaptv] ${APP_CONFIG_BASENAME} not found at ${appRoot}. Create it with defineApp({ ... }).`,
    )
  }

  const result = await esbuild({
    entryPoints: [configPath],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "es2022",
    minify: false,
    metafile: true,
    //The metafile's input paths, and the paths in a syntax error, are relative to
    //this directory, which defaults to `process.cwd()`. They are resolved against
    //`appRoot` below, so they have to be written against it too: with an `appRoot`
    //that is not the cwd, a module the config imports was watched at a path that
    //does not exist, and its edits never reloaded anything.
    absWorkingDir: path.resolve(appRoot),
    plugins: [externalizeDynamicImports],
  })

  const output = result.outputFiles?.[0]
  if (!output) {
    throw new Error(`[adaptv] failed to bundle ${APP_CONFIG_BASENAME}`)
  }

  const module = await importFromSource(output.text)

  const watchFiles = Object.keys(result.metafile?.inputs ?? {}).map(
    (input) => path.resolve(appRoot, input),
  )
  if (!watchFiles.includes(configPath)) watchFiles.push(configPath)

  return { loaded: module.default, watchFiles }
}

/** The config the build runs from — read, then refused if it cannot be built. */
export async function loadAppConfig(
  appRoot: string,
): Promise<LoadedAppConfig> {
  const { loaded, watchFiles } = await readAppConfig(appRoot)
  if (!loaded || typeof loaded !== "object") {
    throw new Error(
      `[adaptv] ${APP_CONFIG_BASENAME} must \`export default defineApp({ ... })\``,
    )
  }
  //The boundary. Nothing type-checks the config before it is evaluated, so a
  //value the type forbids arrives here anyway — and every consumer past this
  //line reads it as if it were right. Refuse it here, naming the key, or the
  //first consumer to touch it names nothing (`styles` missing used to die as
  //`Cannot read properties of undefined (reading 'replace')`, and
  //`orientation: "sideways"` built green). All of them at once: fixing a
  //config one line per build is a worse experience than reading the list.
  const problems = appConfigErrors(loaded)
  if (problems.length > 0) {
    throw new Error(
      problems
        .map((problem) => `[adaptv] ${APP_CONFIG_BASENAME}: ${problem}`)
        .join("\n"),
    )
  }
  return { config: loaded as AdaptvAppConfig, watchFiles }
}

/**
 * esbuild plugin: leave dynamic imports unresolved so the component thunks stay
 * inert. Static imports (i.e. `defineApp`) still bundle normally.
 */
const externalizeDynamicImports: EsbuildPlugin = {
  name: "adaptv-externalize-dynamic-imports",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === "dynamic-import") return { external: true }
      return null
    })
  },
}

/** Evaluate an ESM source string without touching disk. */
async function importFromSource(
  source: string,
): Promise<{ default?: unknown }> {
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
  return import(url)
}
