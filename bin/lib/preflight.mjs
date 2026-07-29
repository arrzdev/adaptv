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
import {
  iconSetModule,
  loadIconSet,
  resolveLauncherSource,
} from "./icons.mjs"

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
 * What is wrong with the app's icons — the art the launcher icons are branded from, and the
 * set the web manifest is built out of. Deduped by `flushNotices`, not here: a missing icon
 * directory is one app-level fact (R21) while a source too small for iOS but fine for Android
 * is genuinely per-platform (R7b).
 *
 * The manifest half runs for EVERY command, native platforms or not: `dev web` and
 * `preview web` serve a manifest too, and an app that can't be installed should hear about it
 * from adaptv rather than from a Lighthouse report weeks later.
 */
export async function iconWarnings(set, platforms) {
  // The app has no art of its own, so it is wearing adaptv's mark — on the home screen, in
  // the install prompt, in the browser tab. ONE app-level sentence (R21), stated on every
  // command including a `dev web` run with no platforms in it, and it still carries the `!`:
  // an app shipping someone else's logo is not something adaptv "handled" (R5).
  //
  // Nothing else is worth saying about a default set. Every per-platform warning below is
  // about a deficiency in the dev's own art, and adaptv's is correct by construction — piling
  // "upscaled from…" on top would be adaptv reporting its own files as a problem.
  //
  // Two ways to get here and they need different sentences, because they have different
  // fixes: a directory that is empty is filled, a key that is absent is set. The message
  // used to name `./public/favicons` in both cases — a path the unconfigured dev never
  // wrote, and one adaptv no longer reads unless they do (R7: name the fix).
  if (set.source === "default")
    return [
      set.configured
        ? `no icons in ${set.dirRel} — shipping adaptv's default mark`
        : "no `icons` in adaptv.config.ts — shipping adaptv's default mark",
    ]

  const { manifestIcons, installabilityIssue } = await iconSetModule()
  const warnings = []
  for (const platform of platforms) {
    const { warning } = await resolveLauncherSource(set, platform)
    if (warning) warnings.push(warning)
  }
  const issue = installabilityIssue(manifestIcons(set))
  if (issue) warnings.push(issue)
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

  const set = await loadIconSet(appRoot, config)
  // An icon directory outside `public/` is a config value adaptv cannot use: nothing in it is
  // served, so every manifest `src` and every head `href` would 404. It is an `✖` for the same
  // reason a colour that isn't hex is — the alternative is a silently iconless web app.
  if (set.error) return { errors: [set.error], warnings: [] }

  return { errors, warnings: await iconWarnings(set, platforms), set }
}
