import type { AdaptvAppConfig } from "#adaptv/config/app-config"
import type { ResolvedWebConfig } from "#adaptv/config/web-config"

export type LoadedAppConfig = {
  config: AdaptvAppConfig
  /** Absolute paths of every module bundled into the config — dev watch set. */
  watchFiles: string[]
}

/**
 * Shared state between the composed adaptv plugins. Populated by the app-config
 * plugin's `config` hook, which vite runs before every later hook of the other
 * plugins in the array.
 */
export type AdaptvContext = {
  appRoot: string
  loaded: LoadedAppConfig | null
  /**
   * The resolved `web` block. Set once by `adaptv()` and read by every downstream
   * plugin, so `render`/`host`/SW settings cannot drift between the router
   * wiring, the manifest and the service-worker build.
   */
  web?: ResolvedWebConfig
}

export function createAdaptvContext(appRoot: string): AdaptvContext {
  return { appRoot, loaded: null }
}

export function requireAppConfig(context: AdaptvContext): AdaptvAppConfig {
  if (!context.loaded) {
    throw new Error(
      "[adaptv] adaptv.config.ts is not loaded yet — the adaptv() plugins must run together and in order",
    )
  }
  return context.loaded.config
}
