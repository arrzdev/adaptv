import path from "node:path"
import type {
  PwaServiceWorkerBuildConfig,
  PwaServiceWorkerRuntimeConfig,
  ResolvedSwBuildConfig,
  SwConfig,
} from "#nativ/config/types.ts"

export const DEFAULT_SW_ENTRY = "./src/sw.ts"

export const DEFAULT_SW_GLOB_PATTERNS = [
  "**/*.{js,css,html,ico,png,svg,woff2,json,txt}",
] as const

export const DEFAULT_SW_GLOB_IGNORES = ["sw.js"] as const
export const DEFAULT_SW_MAX_FILE_BYTES = 5 * 1024 * 1024

/** Typed helper for app-owned SW config — import in `vite.config` and `_root`. */
export function defineSwConfig<const T extends SwConfig>(config: T): T {
  return config
}

/** Runtime slice for `createRootRoute({ serviceWorker })`. */
export function serviceWorkerRuntime(
  config: SwConfig,
): PwaServiceWorkerRuntimeConfig {
  const { register, unregisterForeign } = config

  return {
    register,
    ...(unregisterForeign !== undefined ? { unregisterForeign } : {}),
  }
}

/** Build slice for Vite plugins. */
export function resolveSwBuildConfig(
  config: PwaServiceWorkerBuildConfig,
  appRoot: string = process.cwd(),
): ResolvedSwBuildConfig {
  const entry = config.entry ?? DEFAULT_SW_ENTRY
  const swEntryAbs = path.resolve(appRoot, entry)
  const swDir = path.dirname(swEntryAbs)

  return {
    appRoot,
    entry,
    swEntryAbs,
    srcDir: path.relative(appRoot, swDir) || ".",
    filename: path.basename(swEntryAbs),
    clientDir: path.resolve(appRoot, config.clientDir ?? "dist/client"),
    globPatterns: config.globPatterns ?? [...DEFAULT_SW_GLOB_PATTERNS],
    globIgnores: config.globIgnores ?? [...DEFAULT_SW_GLOB_IGNORES],
    maximumFileSizeToCacheInBytes:
      config.maximumFileSizeToCacheInBytes ?? DEFAULT_SW_MAX_FILE_BYTES,
  }
}
