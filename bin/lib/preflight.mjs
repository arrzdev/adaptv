// Everything adaptv can know about the app BEFORE it does any work.
//
// A command decides whether it can run — and says everything it already knows the dev may
// need to act on — before it builds, serves or installs anything (R33). Two kinds of answer:
//
//   errors   the run cannot produce what was asked for. A hex colour that isn't one becomes
//            `<color name="ic_launcher_background">midnightblue</color>`, and the dev finds
//            out four minutes later, from aapt, in the middle of a gradle failure. Terse
//            one-liner naming the fix (R7), and the command exits without starting.
//   warnings the run WILL work and the result is worse than it should be — a launcher icon
//            upscaled from 512px. It is about the dev's source art, which the build does not
//            change, so it is known up front and belongs above the run rather than under it.
//
// Everything here reads config values and the icon directory. Nothing writes, nothing
// scaffolds, nothing shells out — that is what makes it safe to run before the first step.
import { resolveLauncherSource } from "./icons.mjs"
import { resolveIconPlan } from "./native.mjs"

/** `#rgb` / `#rrggbb`. The same shape `parseHex` accepts and the native colour resources need. */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

// A Capacitor `appId` is also the Android package and the iOS bundle id: at least two
// dot-separated segments, each starting with a letter. `com.4d.app` and `myapp` both compile
// into a project that fails in the toolchain rather than here.
const APP_ID = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/

const SPLASH_MASK_MODES = ["preferences", "system", "light", "dark"]

/** The colour-valued keys, as the dev wrote them in `adaptv.config.ts`. */
const colorKeys = (config) => [
  ["themeColor.light", config.themeColor?.light],
  ["themeColor.dark", config.themeColor?.dark],
  ["backgroundColor", config.backgroundColor],
  ["splashMaskLightColor", config.splashMaskLightColor],
  ["splashMaskDarkColor", config.splashMaskDarkColor],
]

/**
 * Config values that cannot produce the app that was asked for — each a finished sentence
 * naming the key, the shape, and what was actually there.
 *
 * Only values the NATIVE build consumes are checked here; the vite side owns its own. And
 * only values that fail *silently* — an unparseable colour used to fall back to white, an
 * unknown `splashMaskMode` to `preferences`, so the app shipped with a setting the dev wrote
 * and adaptv ignored. Guessing is the bug; saying so is the fix.
 */
export function configErrors(config) {
  const errors = []
  if (!APP_ID.test(String(config.appId ?? "")))
    errors.push(
      `\`appId\` must be reverse-DNS like com.example.app — got ${JSON.stringify(config.appId)}`,
    )
  if (!config.themeColor?.light && !config.themeColor?.dark)
    errors.push("`themeColor` needs at least one of `light` / `dark`")
  for (const [key, value] of colorKeys(config)) {
    if (value === undefined) continue
    if (typeof value !== "string" || !HEX.test(value.trim()))
      errors.push(
        `\`${key}\` must be a hex colour like #1b1b1b — got ${JSON.stringify(value)}`,
      )
  }
  const mode = config.splashMaskMode
  if (mode !== undefined && !SPLASH_MASK_MODES.includes(mode))
    errors.push(
      `\`splashMaskMode\` must be preferences, system, light or dark — got ${JSON.stringify(mode)}`,
    )
  if (config.icons !== undefined && typeof config.icons !== "string")
    errors.push(
      `\`icons\` must be a path to the app's icon directory — got ${JSON.stringify(config.icons)}`,
    )
  return errors
}

/**
 * What is wrong with the art adaptv will brand the launcher icons from, for the platforms
 * this run is about. Deduped by `flushNotices`, not here: a missing icon directory is one
 * app-level fact (R21) while a source too small for iOS but fine for Android is genuinely
 * per-platform (R7b).
 */
export async function iconWarnings(appRoot, config, platforms) {
  const { dir } = resolveIconPlan(config)
  const warnings = []
  for (const platform of platforms) {
    const { warning } = await resolveLauncherSource(appRoot, dir, platform)
    if (warning) warnings.push(warning)
  }
  return warnings
}

/**
 * The whole pre-run verdict: `{ errors, warnings }`. The caller prints and exits — this
 * stays pure so the ordering rule can be tested without a terminal.
 */
export async function inspect(appRoot, config, platforms) {
  const errors = configErrors(config)
  // A bad config is the answer. Reading the icon set on top would add `!` lines about art
  // for a run that is not going to happen — noise under the one line that matters (R6).
  if (errors.length > 0) return { errors, warnings: [] }
  return {
    errors,
    warnings: await iconWarnings(appRoot, config, platforms),
  }
}
