import type { NativAppConfig } from "#nativ/config/app-config"

export type LoadedAppConfig = {
  config: NativAppConfig
  /** Absolute paths of every module bundled into the config — dev watch set. */
  watchFiles: string[]
}

/**
 * Shared state between the composed nativ plugins. Populated by the app-config
 * plugin's `config` hook, which vite runs before every later hook of the other
 * plugins in the array.
 */
export type NativContext = {
  appRoot: string
  loaded: LoadedAppConfig | null
}

export function createNativContext(appRoot: string): NativContext {
  return { appRoot, loaded: null }
}

export function requireAppConfig(context: NativContext): NativAppConfig {
  if (!context.loaded) {
    throw new Error(
      "[nativ] nativ.config.ts is not loaded yet — the nativ() plugins must run together and in order",
    )
  }
  return context.loaded.config
}
