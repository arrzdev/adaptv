import { existsSync } from "node:fs"
import path from "node:path"
import type { Plugin as EsbuildPlugin } from "esbuild"
import { build as esbuild } from "esbuild"
import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import type { LoadedAppConfig } from "#adaptv/vite/adaptv-context"
import { assertNoRemovedConfigKeys } from "#adaptv/vite/removed-config-keys.ts"

export const APP_CONFIG_BASENAME = "adaptv.config.ts"

/**
 * Load `adaptv.config.ts` in Node as data. We bundle it with esbuild so
 * `defineApp` inlines, but mark every dynamic import (`() => import(...)`)
 * external — the component thunks must NOT be resolved or executed here. The
 * bundle therefore has zero static imports and evaluates cleanly from a
 * `data:` URL, leaving each thunk as an inert closure whose specifier we later
 * read with `.toString()`.
 */
export async function loadAppConfig(
  appRoot: string,
): Promise<LoadedAppConfig> {
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
    plugins: [externalizeDynamicImports],
  })

  const output = result.outputFiles?.[0]
  if (!output) {
    throw new Error(`[adaptv] failed to bundle ${APP_CONFIG_BASENAME}`)
  }

  const module = await importFromSource(output.text)
  const config = module.default as AdaptvAppConfig | undefined
  if (!config || typeof config !== "object") {
    throw new Error(
      `[adaptv] ${APP_CONFIG_BASENAME} must \`export default defineApp({ ... })\``,
    )
  }

  //`defineApp`'s generic signature suppresses TypeScript's excess-property
  //check, so a key adaptv dropped typechecks clean and then silently does
  //nothing. Catch it here — this is the only layer that can.
  assertNoRemovedConfigKeys(config)

  const watchFiles = Object.keys(result.metafile?.inputs ?? {}).map(
    (input) => path.resolve(appRoot, input),
  )
  if (!watchFiles.includes(configPath)) watchFiles.push(configPath)

  return { config, watchFiles }
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
