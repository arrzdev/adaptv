// The app's `adaptv.config.ts`, as the CLI reads it. Every command reads its config through
// here — `preflight` for the run, `doctor` for the report, `icons` for where the set goes —
// so there is one definition of what a usable config is, and it lives outside the entry that
// dispatches them.
//
// The file itself is read by the build's own reader (`src/vite/app-config-loader.ts`): one
// bundler configuration, one way the component thunks stay inert, reached through
// `loadAdaptvModule` like every other idea the CLI shares with the framework. What the CLI
// says about a file it cannot read is its own — terse, naming the fix (R7).
import { existsSync } from "node:fs"
import path from "node:path"
import { loadAdaptvModule } from "./load-ts.mjs"

export async function loadConfig(appRoot) {
  if (!existsSync(path.join(appRoot, "adaptv.config.ts"))) {
    throw new Error(
      `no adaptv.config.ts in ${appRoot}. Run from an app root.`,
    )
  }
  const { readAppConfig } = await loadAdaptvModule(
    "vite/app-config-loader.ts",
  )
  const { loaded } = await readAppConfig(appRoot)
  // `appId` is optional to the build — a web app has none — and required by every command
  // here: the native project, the OTA channel and the doctor report are all keyed on it.
  if (!loaded?.appId) {
    throw new Error("missing 'appId' in adaptv.config.ts")
  }
  return loaded
}
