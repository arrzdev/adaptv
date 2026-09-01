// Everything adaptv can know about the app BEFORE it does any work.
//
// A command decides whether it can run — and says everything it already knows the dev may
// need to act on — before it builds, serves or installs anything (R33). Two kinds of answer:
//
//   errors   the run cannot produce what was asked for. A hex colour that isn't one becomes
//            `<color name="ic_launcher_background">midnightblue</color>`, and the dev finds
//            out four minutes later, from aapt, in the middle of a gradle failure. A plugin
//            named in `plugins` that is not installed is declared into nothing, and the app
//            rejects the call it was listed for on a device. Terse one-liner naming the fix
//            (R7), and the command exits without starting.
//   warnings the run WILL work and the result is worse than it should be — a launcher icon
//            upscaled from 512px. It is about the dev's source art, which the build does not
//            change, so it is known up front and belongs above the run rather than under it.
//
// Everything here reads config values, the icon directory, and `node_modules` through Node's
// own resolver. Nothing writes, nothing scaffolds, nothing shells out — that is what makes it
// safe to run before the first step.
import {
  iconSetModule,
  loadIconSet,
  resolveLauncherSource,
} from "./icons.mjs"
import { pkgDirResolver } from "./native.mjs"

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
      `'appId' must be reverse-DNS like com.example.app, got ${JSON.stringify(config.appId)}`,
    )
  if (!config.themeColor?.light && !config.themeColor?.dark)
    errors.push("'themeColor' needs at least one of 'light' / 'dark'")
  for (const [key, value] of colorKeys(config)) {
    if (value === undefined) continue
    if (typeof value !== "string" || !HEX.test(value.trim()))
      errors.push(
        `'${key}' must be a hex colour like #1b1b1b, got ${JSON.stringify(value)}`,
      )
  }
  const mode = config.splashMaskMode
  if (mode !== undefined && !SPLASH_MASK_MODES.includes(mode))
    errors.push(
      `'splashMaskMode' must be preferences, system, light or dark, got ${JSON.stringify(mode)}`,
    )
  if (config.icons !== undefined && typeof config.icons !== "string")
    errors.push(
      `'icons' must be a path to the app's icon directory, got ${JSON.stringify(config.icons)}`,
    )
  return errors
}

/**
 * Names in `plugins` that do not resolve to an installed package.
 *
 * **Why this is an `✖` and not a `!`.** `plugins` is the dev listing native capabilities the
 * app is going to call. A name that resolves to nothing is declared into no Podfile, no
 * `capacitor.settings.gradle` and no plugin registry, so the build succeeds and the app
 * rejects the very call the entry was written for — at runtime, on a device, as "plugin is
 * not implemented". That is the exact family R33 names: a value the dev wrote and adaptv
 * silently ignored, where guessing is the bug and saying so is the fix. R39 then decides the
 * severity — there is ONE answer to "is this config usable", and a run that cannot use the
 * value ends rather than carrying on with a softer version of it. A `!` would be precisely
 * the softer answer R39 threw out for the `b` key: work that continues, one yellow line
 * above it, and a result that does not match the file on disk.
 *
 * **Why it is silent on a web-only run.** `platforms` is the native platforms this command
 * was asked for, and `[]` for `dev web` / `build web` / `preview web`. `plugins` is consumed
 * by nothing else — it reaches the native injectors and no web code path — so on a web-only
 * run there is no value being ignored and nothing for the dev to act on. Refusing there
 * would stop runs with no stake in the plugin; a `!` there would be a native-only sentence
 * printed on every `dev web`, true and unactionable (R6). This is not a second answer to
 * R39's question, it is the same answer with the question scoped: every run that would
 * consume the value refuses, every run that would not says nothing. `iconWarnings` already
 * splits the same way — its launcher half is per-platform, its manifest half is not.
 *
 * **No platform prefix.** The two injectors each pushed their own `ios:` / `android:`
 * sentence, so `build all` said one app-level fact twice (R21) with a label carrying no
 * information: they share one resolver, which takes no platform, so they could never
 * disagree about a name in `plugins`. One sentence.
 *
 * `pkgDirResolver` is imported rather than reimplemented for the same reason: it is the
 * predicate the injectors skip on, so what preflight refuses and what a build would drop are
 * the same set by construction, not by two implementations agreeing today.
 */
export function missingPluginErrors(appRoot, config, platforms) {
  if (platforms.length === 0) return []
  const resolve = pkgDirResolver(appRoot)
  const errors = []
  const seen = new Set()
  //`plugins` is the dev's own array; a name listed twice is one fact, and an empty entry is
  //what `resolvePluginPackages` already drops rather than something to refuse over.
  for (const name of Array.isArray(config.plugins) ? config.plugins : []) {
    if (!name || seen.has(name)) continue
    seen.add(name)
    if (!resolve(name))
      errors.push(
        `'plugins' names '${name}', which is not installed. Install it, or remove the entry.`,
      )
  }
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
  //
  // Just the fact. Both used to carry `— shipping adaptv's default mark`, which is adaptv
  // narrating its own fallback: the dev acts on the missing art, not on what adaptv does
  // meanwhile, and the clause doubled the length of a row that has to survive a narrow
  // terminal (R42).
  if (set.source === "default")
    return [
      set.configured
        ? `no icons in ${set.dirRel}`
        : "no 'icons' in adaptv.config.ts",
    ]

  const { manifestIcons, installabilityIssue } = await iconSetModule()
  const warnings = []
  for (const platform of platforms) {
    //`measure: false` — the warning is `iconIssue`, which reads width, transparency and
    //family. The artwork scan behind the other three fields costs ~45ms per platform and
    //nothing here reads them; the writers ask for it themselves later.
    const { warning } = await resolveLauncherSource(set, platform, {
      measure: false,
    })
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
  //One list, not two passes: a config with a bad colour AND an uninstalled plugin names both
  //on the same run. Fixing a config one line per run is worse than reading the list (R33).
  const errors = [
    ...configErrors(config),
    ...missingPluginErrors(appRoot, config, platforms),
  ]
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
