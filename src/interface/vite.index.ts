import type { adaptv as plugin } from "../vite/adaptv-plugin.ts"
import { installEngineEdits } from "../vite/engine-hooks.ts"

export type { AdaptvOptions } from "../vite/adaptv-plugin.ts"

//before the plugin, which loads the route engine: Node loads a static import graph
//whole before it runs any of it, so the plugin is imported only once the hook is in
//place. → src/vite/engine-hooks.ts
installEngineEdits()

/**
 * The adaptv framework plugin — one call in an app's `vite.config.ts`:
 * `plugins: [adaptv()]`. → `src/vite/adaptv-plugin.ts`
 */
export const adaptv: typeof plugin = async (options) =>
  (await import("../vite/adaptv-plugin.ts")).adaptv(options)
