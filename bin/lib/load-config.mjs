// The app's `adaptv.config.ts`, as the CLI reads it. Every command reads its config through
// here — `preflight` for the run, `doctor` for the report, `icons` for where the set goes —
// so there is one definition of what a usable config is, and it lives outside the entry that
// dispatches them.
//
// The file itself is read by the build's own reader (`src/vite/app-config-loader.ts`): one
// bundler configuration, one way the component thunks stay inert, reached through
// `loadAdaptvModule` like every other idea the CLI shares with the framework, and so is the
// guard for a default export that is not a config at all. What the CLI says about a missing
// file or a missing 'appId' is its own, terse and naming the fix (R7).
import { existsSync } from "node:fs"
import path from "node:path"
import { loadAdaptvModule } from "./load-ts.mjs"

export async function loadConfig(appRoot) {
  // "here", never the folder: the app root is where the dev ran the command, and printed in
  // full it is their home directory and everything under it (R9).
  if (!existsSync(path.join(appRoot, "adaptv.config.ts"))) {
    throw new Error("no adaptv.config.ts here. Run from an app root.")
  }
  const [{ readAppConfig }, { defaultExportError }] = await Promise.all([
    loadAdaptvModule("vite/app-config-loader.ts"),
    loadAdaptvModule("vite/app-config-errors.ts"),
  ])
  const { loaded } = await readAppConfig(appRoot)
  // A file with no default export reads as `undefined`, and an array is an object to `typeof`:
  // both used to be told "missing 'appId'", even while plainly holding one. The rule and its
  // sentence are the build's own guard, asked rather than copied, so the two faces refuse the
  // same file in the same words.
  const notAConfig = defaultExportError(loaded)
  if (notAConfig) throw new Error(notAConfig)
  // `appId` is optional to the build — a web app has none — and required by every command
  // here: the native project, the OTA channel and the doctor report are all keyed on it.
  if (!loaded?.appId) {
    throw new Error("missing 'appId' in adaptv.config.ts")
  }
  return loaded
}
